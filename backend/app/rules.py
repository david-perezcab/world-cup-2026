from __future__ import annotations

from dataclasses import dataclass
from functools import cmp_to_key


@dataclass(frozen=True)
class PlayedResult:
    match_id: int
    home_team: str
    away_team: str
    home_score: int
    away_score: int
    factual: bool = False


def empty_row(team: str) -> dict[str, int | str]:
    return {
        "team": team,
        "played": 0,
        "wins": 0,
        "draws": 0,
        "losses": 0,
        "goals_for": 0,
        "goals_against": 0,
        "goal_difference": 0,
        "points": 0,
    }


def build_table(teams: list[str], results: list[PlayedResult]) -> list[dict[str, int | str]]:
    table = {team: empty_row(team) for team in teams}
    for result in results:
        if result.home_team not in table or result.away_team not in table:
            continue

        home = table[result.home_team]
        away = table[result.away_team]
        home["played"] += 1
        away["played"] += 1
        home["goals_for"] += result.home_score
        home["goals_against"] += result.away_score
        away["goals_for"] += result.away_score
        away["goals_against"] += result.home_score

        if result.home_score > result.away_score:
            home["wins"] += 1
            away["losses"] += 1
            home["points"] += 3
        elif result.home_score < result.away_score:
            away["wins"] += 1
            home["losses"] += 1
            away["points"] += 3
        else:
            home["draws"] += 1
            away["draws"] += 1
            home["points"] += 1
            away["points"] += 1

    for row in table.values():
        row["goal_difference"] = int(row["goals_for"]) - int(row["goals_against"])
    return list(table.values())


def _head_to_head_metrics(team: str, opponent: str, results: list[PlayedResult]) -> tuple[int, int, int]:
    points = 0
    goals_for = 0
    goals_against = 0
    for result in results:
        if {result.home_team, result.away_team} != {team, opponent}:
            continue
        if result.home_team == team:
            team_goals = result.home_score
            opponent_goals = result.away_score
        else:
            team_goals = result.away_score
            opponent_goals = result.home_score

        goals_for += team_goals
        goals_against += opponent_goals
        if team_goals > opponent_goals:
            points += 3
        elif team_goals == opponent_goals:
            points += 1

    return points, goals_for - goals_against, goals_for


def rank_table(
    teams: list[str],
    results: list[PlayedResult],
    ratings: dict[str, float],
) -> list[dict[str, int | str]]:
    rows = build_table(teams, results)
    by_team = {str(row["team"]): row for row in rows}

    def compare(left_team: str, right_team: str) -> int:
        left = by_team[left_team]
        right = by_team[right_team]
        for key in ("points", "goal_difference", "goals_for"):
            delta = int(right[key]) - int(left[key])
            if delta:
                return delta

        left_h2h = _head_to_head_metrics(left_team, right_team, results)
        right_h2h = _head_to_head_metrics(right_team, left_team, results)
        for left_value, right_value in zip(left_h2h, right_h2h):
            delta = right_value - left_value
            if delta:
                return delta

        rating_delta = ratings.get(right_team, 1500.0) - ratings.get(left_team, 1500.0)
        if rating_delta:
            return 1 if rating_delta > 0 else -1
        return -1 if left_team < right_team else 1 if left_team > right_team else 0

    ranked_teams = sorted(teams, key=cmp_to_key(compare))
    return [by_team[team] for team in ranked_teams]


def third_place_sort_key(row: dict[str, int | str], ratings: dict[str, float]) -> tuple[int, int, int, float, str]:
    team = str(row["team"])
    return (
        int(row["points"]),
        int(row["goal_difference"]),
        int(row["goals_for"]),
        ratings.get(team, 1500.0),
        team,
    )
