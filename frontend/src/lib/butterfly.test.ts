import { describe, expect, it } from "vitest";
import { buildButterflyEffect, formatSignedPercentPoints } from "./butterfly";
import type { BaselinePrediction, Prediction } from "../types";

const baseline: BaselinePrediction = {
  data_version: "test",
  settings: { simulations: 1000, seed: 2026 },
  champion_probabilities: [
    { team: "Brazil", probability: 0.2 },
    { team: "Argentina", probability: 0.18 },
    { team: "Mexico", probability: 0.04 }
  ],
  round_probabilities: [
    roundRow("Brazil", 0.9, 0.72, 0.54, 0.36, 0.26, 0.2),
    roundRow("Argentina", 0.88, 0.7, 0.5, 0.34, 0.25, 0.18),
    roundRow("Mexico", 0.55, 0.28, 0.14, 0.07, 0.05, 0.04)
  ],
  group_probabilities: {
    A: [
      { team: "Mexico", winner: 0.42, runner_up: 0.32, qualify: 0.74 },
      { team: "Brazil", winner: 0.5, runner_up: 0.28, qualify: 0.78 }
    ]
  }
};

const prediction: Prediction = {
  ...baseline,
  settings: { simulations: 1000, seed: 77 },
  facts_used: [],
  factual_group_standings: {},
  champion_probabilities: [
    { team: "Mexico", probability: 0.12 },
    { team: "Brazil", probability: 0.16 },
    { team: "Argentina", probability: 0.1 }
  ],
  round_probabilities: [
    roundRow("Brazil", 0.84, 0.62, 0.44, 0.3, 0.21, 0.16),
    roundRow("Argentina", 0.82, 0.62, 0.42, 0.28, 0.2, 0.14),
    roundRow("Mexico", 0.8, 0.52, 0.3, 0.18, 0.14, 0.12)
  ],
  group_probabilities: {
    A: [
      { team: "Mexico", winner: 0.62, runner_up: 0.24, qualify: 0.9 },
      { team: "Brazil", winner: 0.34, runner_up: 0.3, qualify: 0.64 }
    ]
  },
  match_probabilities: [],
  model: { active_model: "test", ml_status: "test", notes: [] }
};

describe("buildButterflyEffect", () => {
  it("ranks champion probability winners and losers", () => {
    const effect = buildButterflyEffect(prediction, baseline);

    expect(effect.biggestWinner?.team).toBe("Mexico");
    expect(effect.biggestWinner?.delta).toBeCloseTo(0.08);
    expect(effect.biggestLoser?.team).toBe("Argentina");
    expect(effect.chaosScore).toBeGreaterThan(0);
    expect(effect.pressurePoint).toBe("Group A");
  });

  it("formats probability point deltas", () => {
    expect(formatSignedPercentPoints(0.024)).toBe("+2.4 pp");
    expect(formatSignedPercentPoints(-0.031)).toBe("-3.1 pp");
  });
});

function roundRow(
  team: string,
  round_of_32: number,
  round_of_16: number,
  quarter_final: number,
  semi_final: number,
  final: number,
  champion: number
) {
  return { team, round_of_32, round_of_16, quarter_final, semi_final, final, champion };
}
