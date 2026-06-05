import { describe, expect, it } from "vitest";
import { decodeScenario, encodeScenario } from "./scenario";

describe("scenario encoding", () => {
  it("round-trips completed facts", () => {
    const encoded = encodeScenario({
      1: { match_id: 1, home_score: 2, away_score: 1, source: "manual" },
      2: { match_id: 2, source: "manual" }
    });

    expect(decodeScenario(encoded)).toEqual({
      1: { match_id: 1, home_score: 2, away_score: 1, source: "manual" }
    });
  });
});
