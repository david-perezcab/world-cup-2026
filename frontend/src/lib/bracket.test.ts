import { describe, expect, it } from "vitest";
import { bracketLayout, buildKnockoutDisplayTeams } from "./bracket";
import type { FactDraft, Match } from "../types";

describe("buildKnockoutDisplayTeams", () => {
  it("resolves completed group runners-up into the round of 32", () => {
    const matches = [
      ...groupMatches("A", ["A1", "A2", "A3", "A4"], 1),
      ...groupMatches("B", ["B1", "B2", "B3", "B4"], 7),
      knockoutMatch(73, "Round of 32", "2A", "2B")
    ];
    const facts = {
      ...winningGroupFacts(["A1", "A2", "A3", "A4"], 1),
      ...winningGroupFacts(["B1", "B2", "B3", "B4"], 7)
    };

    const displayTeams = buildKnockoutDisplayTeams(
      matches,
      {
        A: ["A1", "A2", "A3", "A4"],
        B: ["B1", "B2", "B3", "B4"]
      },
      facts
    );

    expect(displayTeams[73]).toEqual({ homeTeam: "A2", awayTeam: "B2" });
  });

  it("propagates factual knockout winners into later W-slots", () => {
    const matches = [
      knockoutMatch(73, "Round of 32", "2A", "2B"),
      knockoutMatch(75, "Round of 32", "Team X", "Team Y"),
      knockoutMatch(90, "Round of 16", "W73", "W75")
    ];

    const displayTeams = buildKnockoutDisplayTeams(matches, {}, {
      73: { match_id: 73, home_score: 3, away_score: 1, source: "manual" }
    });

    expect(displayTeams[90].homeTeam).toBe("2A");
    expect(displayTeams[90].awayTeam).toBe("W75");
  });

  it("centers parent bracket positions between child matches", () => {
    const matches = [
      knockoutMatch(73, "Round of 32", "A", "B"),
      knockoutMatch(74, "Round of 32", "C", "D"),
      knockoutMatch(89, "Round of 16", "W73", "W74"),
      knockoutMatch(104, "Final", "W89", "Champion Path")
    ];

    const layout = bracketLayout(matches);

    expect(layout[73].slot).toBe(1);
    expect(layout[74].slot).toBe(3);
    expect(layout[89]).toMatchObject({ column: 2, slot: 2, childMatchIds: [73, 74] });
  });
});

function groupMatches(group: string, teams: string[], startId: number): Match[] {
  const pairings = [
    [0, 1],
    [2, 3],
    [0, 2],
    [1, 3],
    [0, 3],
    [1, 2]
  ];
  return pairings.map(([home, away], index) => ({
    match_id: startId + index,
    round: "Matchday 1",
    date: "2026-06-11",
    time: "13:00 UTC-6",
    spain_date: "2026-06-11",
    spain_time: "21:00",
    home_team: teams[home],
    away_team: teams[away],
    group: `Group ${group}`,
    ground: "Test Ground",
    is_knockout: false
  }));
}

function winningGroupFacts(teams: string[], startId: number): Record<number, FactDraft> {
  const scores = [
    [3, 1],
    [2, 1],
    [2, 0],
    [2, 0],
    [1, 0],
    [1, 0]
  ];
  return Object.fromEntries(
    scores.map(([homeScore, awayScore], index) => [
      startId + index,
      {
        match_id: startId + index,
        home_score: homeScore,
        away_score: awayScore,
        source: "manual"
      }
    ])
  );
}

function knockoutMatch(matchId: number, round: string, homeTeam: string, awayTeam: string): Match {
  return {
    match_id: matchId,
    round,
    date: "2026-06-28",
    time: "12:00 UTC-7",
    spain_date: "2026-06-28",
    spain_time: "21:00",
    home_team: homeTeam,
    away_team: awayTeam,
    group: null,
    ground: "Test Ground",
    is_knockout: true
  };
}
