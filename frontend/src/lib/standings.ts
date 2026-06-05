import type { FactDraft, Match, StandingRow } from "../types";

export function computeStandings(
  teams: string[],
  matches: Match[],
  facts: Record<number, FactDraft>
): StandingRow[] {
  const table = new Map<string, StandingRow>();
  for (const team of teams) {
    table.set(team, {
      team,
      played: 0,
      wins: 0,
      draws: 0,
      losses: 0,
      goals_for: 0,
      goals_against: 0,
      goal_difference: 0,
      points: 0
    });
  }

  for (const match of matches) {
    const fact = facts[match.match_id];
    if (!fact || fact.home_score === undefined || fact.away_score === undefined) {
      continue;
    }
    const home = table.get(match.home_team);
    const away = table.get(match.away_team);
    if (!home || !away) {
      continue;
    }
    applyResult(home, away, fact.home_score, fact.away_score);
  }

  return Array.from(table.values()).sort((left, right) => {
    return (
      right.points - left.points ||
      right.goal_difference - left.goal_difference ||
      right.goals_for - left.goals_for ||
      left.team.localeCompare(right.team)
    );
  });
}

function applyResult(home: StandingRow, away: StandingRow, homeScore: number, awayScore: number) {
  home.played += 1;
  away.played += 1;
  home.goals_for += homeScore;
  home.goals_against += awayScore;
  away.goals_for += awayScore;
  away.goals_against += homeScore;
  home.goal_difference = home.goals_for - home.goals_against;
  away.goal_difference = away.goals_for - away.goals_against;

  if (homeScore > awayScore) {
    home.wins += 1;
    away.losses += 1;
    home.points += 3;
  } else if (homeScore < awayScore) {
    away.wins += 1;
    home.losses += 1;
    away.points += 3;
  } else {
    home.draws += 1;
    away.draws += 1;
    home.points += 1;
    away.points += 1;
  }
}
