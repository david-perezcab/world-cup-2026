import { describe, expect, it } from "vitest";
import { computeStandings } from "./standings";
import type { Match } from "../types";

describe("computeStandings", () => {
  it("updates points and goal difference from completed facts", () => {
    const matches: Match[] = [
      {
        match_id: 1,
        round: "Matchday 1",
        date: "2026-06-11",
        time: "13:00 UTC-6",
        spain_date: "2026-06-11",
        spain_time: "21:00",
        home_team: "Mexico",
        away_team: "South Africa",
        group: "Group A",
        ground: "Mexico City",
        is_knockout: false
      }
    ];

    const standings = computeStandings(["Mexico", "South Africa"], matches, {
      1: { match_id: 1, home_score: 3, away_score: 1, source: "manual" }
    });

    expect(standings[0]).toMatchObject({
      team: "Mexico",
      points: 3,
      goal_difference: 2
    });
  });
});
