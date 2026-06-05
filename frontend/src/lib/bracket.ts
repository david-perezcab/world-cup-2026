import type { FactDraft, Match, StandingRow } from "../types";
import { computeStandings } from "./standings";

export type DisplayTeams = {
  homeTeam: string;
  awayTeam: string;
};

type GroupRanking = Record<string, StandingRow[]>;

export function buildKnockoutDisplayTeams(
  allMatches: Match[],
  groups: Record<string, string[]>,
  facts: Record<number, FactDraft>
): Record<number, DisplayTeams> {
  const groupRankings = completedGroupRankings(allMatches, groups, facts);
  const knockoutMatches = allMatches.filter((match) => match.is_knockout).sort((left, right) => left.match_id - right.match_id);
  const thirdSlots = assignThirdPlaceSlots(knockoutMatches, groupRankings);
  const winners = new Map<number, string>();
  const losers = new Map<number, string>();
  const displayTeams: Record<number, DisplayTeams> = {};

  for (const match of knockoutMatches) {
    const homeTeam = resolveToken(match.home_team, match.match_id, groupRankings, thirdSlots, winners, losers);
    const awayTeam = resolveToken(match.away_team, match.match_id, groupRankings, thirdSlots, winners, losers);
    displayTeams[match.match_id] = {
      homeTeam: homeTeam ?? match.home_team,
      awayTeam: awayTeam ?? match.away_team
    };

    const fact = facts[match.match_id];
    const winnerSide = factWinnerSide(fact);
    if (!winnerSide) {
      continue;
    }
    const winner = winnerSide === "home" ? displayTeams[match.match_id].homeTeam : displayTeams[match.match_id].awayTeam;
    const loser = winnerSide === "home" ? displayTeams[match.match_id].awayTeam : displayTeams[match.match_id].homeTeam;
    winners.set(match.match_id, winner);
    losers.set(match.match_id, loser);
  }

  return displayTeams;
}

export type BracketPosition = {
  round: string;
  column: number;
  slot: number;
  childMatchIds: number[];
};

export function bracketLayout(matches: Match[]): Record<number, BracketPosition> {
  const byId = new Map(matches.map((match) => [match.match_id, match]));
  const final = byId.get(104);
  if (!final) {
    return {};
  }

  const leafOrder: number[] = [];
  const positions = new Map<number, number>();

  function walk(token: string) {
    const matchId = winnerTokenId(token);
    if (!matchId) {
      return;
    }
    const match = byId.get(matchId);
    if (!match) {
      return;
    }
    const children = [winnerTokenId(match.home_team), winnerTokenId(match.away_team)].filter((id): id is number => id !== null);
    if (children.length === 0) {
      leafOrder.push(match.match_id);
      positions.set(match.match_id, leafOrder.length * 2 - 1);
      return;
    }
    walk(match.home_team);
    walk(match.away_team);
    const childPositions = children.map((id) => positions.get(id)).filter((value): value is number => value !== undefined);
    if (childPositions.length > 0) {
      positions.set(match.match_id, childPositions.reduce((sum, value) => sum + value, 0) / childPositions.length);
    }
  }

  walk("W104");

  const roundIndex: Record<string, number> = {
    "Round of 32": 1,
    "Round of 16": 2,
    "Quarter-final": 3,
    "Semi-final": 4,
    Final: 5
  };

  return Object.fromEntries(
    matches
      .filter((match) => match.round !== "Match for third place")
      .map((match) => [
        match.match_id,
        {
          round: match.round,
          column: roundIndex[match.round] ?? 1,
          slot: Math.max(1, Math.round(positions.get(match.match_id) ?? 1)),
          childMatchIds: [winnerTokenId(match.home_team), winnerTokenId(match.away_team)].filter(
            (id): id is number => id !== null && byId.has(id)
          )
        }
      ])
  );
}

function completedGroupRankings(
  allMatches: Match[],
  groups: Record<string, string[]>,
  facts: Record<number, FactDraft>
): GroupRanking {
  const rankings: GroupRanking = {};
  for (const [group, teams] of Object.entries(groups)) {
    const matches = allMatches.filter((match) => match.group === `Group ${group}`);
    if (matches.length === 0 || matches.some((match) => !hasCompleteFact(facts[match.match_id]))) {
      continue;
    }
    rankings[group] = computeStandings(teams, matches, facts);
  }
  return rankings;
}

function assignThirdPlaceSlots(matches: Match[], rankings: GroupRanking): Record<number, string> {
  const groupLetters = Object.keys(rankings);
  if (groupLetters.length < 12) {
    return {};
  }

  const thirdRows = groupLetters
    .map((group) => ({ group, row: rankings[group][2] }))
    .sort((left, right) => {
      return (
        right.row.points - left.row.points ||
        right.row.goal_difference - left.row.goal_difference ||
        right.row.goals_for - left.row.goals_for ||
        left.row.team.localeCompare(right.row.team)
      );
    })
    .slice(0, 8);
  const qualifiedGroups = new Set(thirdRows.map((item) => item.group));
  const slots = matches
    .filter((match) => match.round === "Round of 32")
    .map((match) => {
      const token = match.home_team.startsWith("3") ? match.home_team : match.away_team;
      return token.startsWith("3") ? { matchId: match.match_id, candidates: token.slice(1).split("/") } : null;
    })
    .filter((slot): slot is { matchId: number; candidates: string[] } => slot !== null)
    .map((slot) => ({
      matchId: slot.matchId,
      candidates: slot.candidates.filter((group) => qualifiedGroups.has(group))
    }))
    .sort((left, right) => left.candidates.length - right.candidates.length || left.matchId - right.matchId);

  function search(index: number, used: Set<string>, assignments: Record<number, string>): Record<number, string> | null {
    if (index === slots.length) {
      return assignments;
    }
    const slot = slots[index];
    for (const group of slot.candidates) {
      if (used.has(group)) {
        continue;
      }
      const next = search(index + 1, new Set([...used, group]), { ...assignments, [slot.matchId]: group });
      if (next) {
        return next;
      }
    }
    return null;
  }

  return search(0, new Set(), {}) ?? {};
}

function resolveToken(
  token: string,
  matchId: number,
  rankings: GroupRanking,
  thirdSlots: Record<number, string>,
  winners: Map<number, string>,
  losers: Map<number, string>
): string | null {
  const winnerId = winnerTokenId(token);
  if (winnerId) {
    return winners.get(winnerId) ?? null;
  }
  const loserId = loserTokenId(token);
  if (loserId) {
    return losers.get(loserId) ?? null;
  }
  if (/^[12][A-L]$/.test(token)) {
    const group = token[1];
    const rank = Number(token[0]) - 1;
    return rankings[group]?.[rank]?.team ?? null;
  }
  if (token.startsWith("3")) {
    const group = thirdSlots[matchId];
    return group ? rankings[group]?.[2]?.team ?? null : null;
  }
  return token;
}

function factWinnerSide(fact?: FactDraft): "home" | "away" | null {
  if (!hasCompleteFact(fact)) {
    return null;
  }
  if (fact.home_score > fact.away_score) {
    return "home";
  }
  if (fact.away_score > fact.home_score) {
    return "away";
  }
  return fact.knockout_winner ?? null;
}

function hasCompleteFact(fact?: FactDraft): fact is FactDraft & { home_score: number; away_score: number } {
  return fact?.home_score !== undefined && fact.away_score !== undefined;
}

function winnerTokenId(token: string): number | null {
  return /^W\d+$/.test(token) ? Number(token.slice(1)) : null;
}

function loserTokenId(token: string): number | null {
  return /^L\d+$/.test(token) ? Number(token.slice(1)) : null;
}
