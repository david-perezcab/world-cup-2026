from __future__ import annotations

from collections import Counter, defaultdict
import json
from pathlib import Path
import secrets
from typing import Any

import numpy as np

from .data_loader import DATA_DIR, Match, all_teams, build_groups, data_version, load_matches, load_ratings
from .modeling import (
    MODEL_CARD,
    advancement_probability,
    simulate_score,
    win_draw_loss_probabilities,
)
from .models import FactResult, PredictRequest, SimulationSettings
from .rules import PlayedResult, rank_table, third_place_sort_key


class ScenarioError(ValueError):
    pass


STAGE_FOR_ROUND = {
    "Round of 32": "round_of_16",
    "Round of 16": "quarter_final",
    "Quarter-final": "semi_final",
    "Semi-final": "final",
    "Final": "champion",
}

BASELINE_SIMULATIONS = 100000
BASELINE_SEED = 2142218442
BASELINE_PATH = DATA_DIR / "baseline_prediction.json"


def tournament_payload() -> dict[str, Any]:
    matches = load_matches()
    ratings = load_ratings()
    groups = build_groups(matches)
    teams = all_teams(matches)
    missing_ratings = [team for team in teams if team not in ratings]
    if missing_ratings:
        raise ScenarioError(f"Faltan ratings Elo para: {', '.join(missing_ratings)}")

    return {
        "name": "Mundial 2026",
        "data_version": data_version(),
        "matches": [match.to_public_dict() for match in matches],
        "groups": groups,
        "teams": [
            {"name": team, "rating": ratings[team], "group": _team_group(team, groups)}
            for team in teams
        ],
        "model": MODEL_CARD,
    }


def predict(request: PredictRequest) -> dict[str, Any]:
    matches = load_matches()
    ratings = load_ratings()
    facts = _normalize_facts(matches, request.facts)
    simulations = request.settings.simulations
    seed = request.settings.seed if request.settings.seed is not None else secrets.randbelow(2_147_483_647)
    rng = np.random.default_rng(seed)

    teams = all_teams(matches)
    stage_counts: dict[str, Counter[str]] = {
        "round_of_32": Counter(),
        "round_of_16": Counter(),
        "quarter_final": Counter(),
        "semi_final": Counter(),
        "final": Counter(),
        "champion": Counter(),
        "third_place": Counter(),
    }
    group_counts: dict[str, Counter[str]] = defaultdict(Counter)

    for _ in range(simulations):
        group_rankings, qualified_thirds = _simulate_group_stage(matches, facts, ratings, rng)
        qualified = _qualified_teams(group_rankings, qualified_thirds)

        for team in qualified:
            stage_counts["round_of_32"][team] += 1
        for letter, ranking in group_rankings.items():
            group_counts[f"{letter}:winner"][str(ranking[0]["team"])] += 1
            group_counts[f"{letter}:runner_up"][str(ranking[1]["team"])] += 1
            for team in [str(row["team"]) for row in ranking[:2]]:
                group_counts[f"{letter}:qualify"][team] += 1
        for third in qualified_thirds:
            group_counts[f"{third['group']}:qualify"][str(third["team"])] += 1

        _simulate_knockout_stage(
            matches=matches,
            facts=facts,
            ratings=ratings,
            rng=rng,
            group_rankings=group_rankings,
            qualified_thirds=qualified_thirds,
            stage_counts=stage_counts,
        )

    return {
        "data_version": data_version(),
        "settings": {"simulations": simulations, "seed": seed},
        "facts_used": [fact.model_dump() for fact in facts.values()],
        "factual_group_standings": _factual_group_standings(matches, facts, ratings),
        "match_probabilities": _match_probabilities(matches, facts, ratings),
        "group_probabilities": _format_group_probabilities(group_counts, build_groups(matches), simulations),
        "round_probabilities": _format_stage_probabilities(stage_counts, teams, simulations),
        "champion_probabilities": _format_champion_probabilities(stage_counts["champion"], simulations),
        "model": MODEL_CARD,
    }


def baseline_prediction_payload() -> dict[str, Any]:
    if BASELINE_PATH.exists():
        payload = json.loads(BASELINE_PATH.read_text(encoding="utf-8"))
        if payload.get("data_version") == data_version():
            return payload
    return generate_baseline_prediction()


def generate_baseline_prediction() -> dict[str, Any]:
    prediction = predict(
        PredictRequest(
            facts=[],
            settings=SimulationSettings(simulations=BASELINE_SIMULATIONS, seed=BASELINE_SEED),
        )
    )
    return {
        "data_version": prediction["data_version"],
        "settings": prediction["settings"],
        "group_probabilities": prediction["group_probabilities"],
        "round_probabilities": prediction["round_probabilities"],
        "champion_probabilities": prediction["champion_probabilities"],
    }


def write_baseline_prediction() -> Path:
    payload = generate_baseline_prediction()
    BASELINE_PATH.parent.mkdir(parents=True, exist_ok=True)
    BASELINE_PATH.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    return BASELINE_PATH


def _team_group(team: str, groups: dict[str, list[str]]) -> str:
    for group, teams in groups.items():
        if team in teams:
            return group
    return ""


def _normalize_facts(matches: list[Match], facts: list[FactResult]) -> dict[int, FactResult]:
    match_ids = {match.match_id for match in matches}
    by_id: dict[int, FactResult] = {}
    for fact in facts:
        if fact.match_id not in match_ids:
            raise ScenarioError(f"ID de partido desconocido: {fact.match_id}")
        if fact.match_id in by_id:
            raise ScenarioError(f"Resultado duplicado para el partido: {fact.match_id}")
        match = next(match for match in matches if match.match_id == fact.match_id)
        if match.is_knockout and fact.home_score == fact.away_score and not fact.knockout_winner:
            raise ScenarioError(f"El partido eliminatorio {fact.match_id} necesita ganador si acaba empatado.")
        by_id[fact.match_id] = fact
    return by_id


def _simulate_group_stage(
    matches: list[Match],
    facts: dict[int, FactResult],
    ratings: dict[str, float],
    rng: np.random.Generator,
) -> tuple[dict[str, list[dict[str, int | str]]], list[dict[str, int | str]]]:
    groups = build_groups(matches)
    group_results: dict[str, list[PlayedResult]] = defaultdict(list)

    for match in matches:
        if match.is_knockout:
            continue
        fact = facts.get(match.match_id)
        if fact:
            home_score, away_score = fact.home_score, fact.away_score
            factual = True
        else:
            home_score, away_score = simulate_score(match.home_token, match.away_token, ratings, rng)
            factual = False
        group_results[match.group_letter or ""].append(
            PlayedResult(
                match_id=match.match_id,
                home_team=match.home_token,
                away_team=match.away_token,
                home_score=home_score,
                away_score=away_score,
                factual=factual,
            )
        )

    rankings = {
        letter: rank_table(teams, group_results[letter], ratings)
        for letter, teams in groups.items()
    }

    third_rows = []
    for letter, ranking in rankings.items():
        third = dict(ranking[2])
        third["group"] = letter
        third_rows.append(third)
    qualified_thirds = sorted(
        third_rows,
        key=lambda row: third_place_sort_key(row, ratings),
        reverse=True,
    )[:8]
    return rankings, qualified_thirds


def _qualified_teams(
    group_rankings: dict[str, list[dict[str, int | str]]],
    qualified_thirds: list[dict[str, int | str]],
) -> list[str]:
    teams = []
    for ranking in group_rankings.values():
        teams.extend([str(ranking[0]["team"]), str(ranking[1]["team"])])
    teams.extend(str(row["team"]) for row in qualified_thirds)
    return teams


def _simulate_knockout_stage(
    matches: list[Match],
    facts: dict[int, FactResult],
    ratings: dict[str, float],
    rng: np.random.Generator,
    group_rankings: dict[str, list[dict[str, int | str]]],
    qualified_thirds: list[dict[str, int | str]],
    stage_counts: dict[str, Counter[str]],
) -> None:
    winners: dict[int, str] = {}
    losers: dict[int, str] = {}
    third_by_group = {str(row["group"]): str(row["team"]) for row in qualified_thirds}
    third_slot_assignments = _assign_third_place_slots(matches, list(third_by_group))

    for match in [match for match in matches if match.is_knockout]:
        home_team = _resolve_token(
            match.home_token,
            match.match_id,
            group_rankings,
            third_by_group,
            third_slot_assignments,
            winners,
            losers,
        )
        away_team = _resolve_token(
            match.away_token,
            match.match_id,
            group_rankings,
            third_by_group,
            third_slot_assignments,
            winners,
            losers,
        )
        if home_team is None or away_team is None:
            raise ScenarioError(f"No se pudo resolver el partido eliminatorio {match.match_id}")

        fact = facts.get(match.match_id)
        if fact:
            winner = _winner_from_fact(match, fact, home_team, away_team)
        else:
            home_score, away_score = simulate_score(home_team, away_team, ratings, rng)
            if home_score > away_score:
                winner = home_team
            elif away_score > home_score:
                winner = away_team
            else:
                home_advances = rng.random() < advancement_probability(home_team, away_team, ratings)
                winner = home_team if home_advances else away_team

        loser = away_team if winner == home_team else home_team
        winners[match.match_id] = winner
        losers[match.match_id] = loser

        next_stage = STAGE_FOR_ROUND.get(match.round)
        if next_stage:
            stage_counts[next_stage][winner] += 1
        elif match.round == "Match for third place":
            stage_counts["third_place"][winner] += 1


def _resolve_token(
    token: str,
    match_id: int,
    group_rankings: dict[str, list[dict[str, int | str]]],
    third_by_group: dict[str, str],
    third_slot_assignments: dict[int, str],
    winners: dict[int, str],
    losers: dict[int, str],
) -> str | None:
    if token.startswith("W") and token[1:].isdigit():
        return winners.get(int(token[1:]))
    if token.startswith("L") and token[1:].isdigit():
        return losers.get(int(token[1:]))
    if len(token) == 2 and token[0] in {"1", "2"} and token[1].isalpha():
        ranking = group_rankings[token[1]]
        return str(ranking[int(token[0]) - 1]["team"])
    if token.startswith("3"):
        selected_group = third_slot_assignments.get(match_id)
        if selected_group is None:
            return None
        return third_by_group[selected_group]
    return token


def _assign_third_place_slots(matches: list[Match], qualified_groups: list[str]) -> dict[int, str]:
    slots = []
    for match in [match for match in matches if match.is_knockout and match.round == "Round of 32"]:
        token = match.home_token if match.home_token.startswith("3") else match.away_token
        if not token.startswith("3"):
            continue
        slots.append((match.match_id, token[1:].split("/")))

    qualified = set(qualified_groups)
    ordered_slots = sorted(
        [(match_id, [group for group in groups if group in qualified]) for match_id, groups in slots],
        key=lambda item: (len(item[1]), item[0]),
    )

    def search(index: int, used: set[str], assignments: dict[int, str]) -> dict[int, str] | None:
        if index == len(ordered_slots):
            return assignments
        match_id, candidates = ordered_slots[index]
        for group in candidates:
            if group in used:
                continue
            result = search(index + 1, used | {group}, {**assignments, match_id: group})
            if result is not None:
                return result
        return None

    assignments = search(0, set(), {})
    if assignments is None:
        raise ScenarioError("No se pudieron asignar los terceros clasificados a la ronda de 32.")
    return assignments


def _winner_from_fact(match: Match, fact: FactResult, home_team: str, away_team: str) -> str:
    if fact.home_score > fact.away_score:
        return home_team
    if fact.away_score > fact.home_score:
        return away_team

    winner = (fact.knockout_winner or "").strip().casefold()
    if winner in {"home", "team1", "1", home_team.casefold()}:
        return home_team
    if winner in {"away", "team2", "2", away_team.casefold()}:
        return away_team
    raise ScenarioError(
        f"El ganador del partido eliminatorio {match.match_id} debe ser home, away, {home_team} o {away_team}."
    )


def _factual_group_standings(
    matches: list[Match],
    facts: dict[int, FactResult],
    ratings: dict[str, float],
) -> dict[str, list[dict[str, int | str]]]:
    groups = build_groups(matches)
    results: dict[str, list[PlayedResult]] = defaultdict(list)
    for match in matches:
        fact = facts.get(match.match_id)
        if match.is_knockout or not fact:
            continue
        results[match.group_letter or ""].append(
            PlayedResult(
                match_id=match.match_id,
                home_team=match.home_token,
                away_team=match.away_token,
                home_score=fact.home_score,
                away_score=fact.away_score,
                factual=True,
            )
        )
    return {
        letter: rank_table(teams, results[letter], ratings)
        for letter, teams in groups.items()
    }


def _match_probabilities(
    matches: list[Match],
    facts: dict[int, FactResult],
    ratings: dict[str, float],
) -> list[dict[str, Any]]:
    output = []
    for match in matches:
        fact = facts.get(match.match_id)
        if fact:
            if fact.home_score > fact.away_score:
                probs = (1.0, 0.0, 0.0)
            elif fact.home_score < fact.away_score:
                probs = (0.0, 0.0, 1.0)
            elif match.is_knockout:
                winner = (fact.knockout_winner or "").casefold()
                probs = (1.0, 0.0, 0.0) if winner in {"home", "team1", "1"} else (0.0, 0.0, 1.0)
            else:
                probs = (0.0, 1.0, 0.0)
        elif match.is_knockout or _is_placeholder(match.home_token) or _is_placeholder(match.away_token):
            continue
        else:
            probs = win_draw_loss_probabilities(match.home_token, match.away_token, ratings)

        output.append(
            {
                "match_id": match.match_id,
                "round": match.round,
                "home_team": match.home_token,
                "away_team": match.away_token,
                "is_fact": fact is not None,
                "home_win": round(probs[0], 4),
                "draw": round(probs[1], 4),
                "away_win": round(probs[2], 4),
            }
        )
    return output


def _is_placeholder(token: str) -> bool:
    return bool(token[:1] in {"W", "L"} and token[1:].isdigit()) or (
        len(token) >= 2 and token[0] in {"1", "2", "3"} and token[1].isalpha()
    )


def _format_stage_probabilities(
    stage_counts: dict[str, Counter[str]],
    teams: list[str],
    simulations: int,
) -> list[dict[str, float | str]]:
    rows = []
    for team in teams:
        rows.append(
            {
                "team": team,
                "round_of_32": _prob(stage_counts["round_of_32"][team], simulations),
                "round_of_16": _prob(stage_counts["round_of_16"][team], simulations),
                "quarter_final": _prob(stage_counts["quarter_final"][team], simulations),
                "semi_final": _prob(stage_counts["semi_final"][team], simulations),
                "final": _prob(stage_counts["final"][team], simulations),
                "champion": _prob(stage_counts["champion"][team], simulations),
            }
        )
    return sorted(rows, key=lambda row: float(row["champion"]), reverse=True)


def _format_champion_probabilities(counter: Counter[str], simulations: int) -> list[dict[str, float | str]]:
    return [
        {"team": team, "probability": _prob(count, simulations)}
        for team, count in counter.most_common()
    ]


def _format_group_probabilities(
    group_counts: dict[str, Counter[str]],
    groups: dict[str, list[str]],
    simulations: int,
) -> dict[str, list[dict[str, float | str]]]:
    output: dict[str, list[dict[str, float | str]]] = {}
    for letter, teams in groups.items():
        rows = []
        for team in teams:
            rows.append(
                {
                    "team": team,
                    "winner": _prob(group_counts[f"{letter}:winner"][team], simulations),
                    "runner_up": _prob(group_counts[f"{letter}:runner_up"][team], simulations),
                    "qualify": _prob(group_counts[f"{letter}:qualify"][team], simulations),
                }
            )
        output[letter] = sorted(rows, key=lambda row: float(row["qualify"]), reverse=True)
    return output


def _prob(count: int, simulations: int) -> float:
    return round(count / simulations, 4)
