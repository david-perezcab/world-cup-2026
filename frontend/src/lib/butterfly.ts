import type { BaselinePrediction, Prediction } from "../types";

const ROUND_KEYS = ["round_of_32", "round_of_16", "quarter_final", "semi_final", "final", "champion"] as const;

type RoundKey = (typeof ROUND_KEYS)[number];

export type ChampionDelta = {
  team: string;
  baseline: number;
  current: number;
  delta: number;
};

export type RoundMover = {
  team: string;
  delta: number;
  strongestRound: RoundKey;
  strongestDelta: number;
};

export type ButterflyEffect = {
  chaosScore: number;
  headline: string;
  narrative: string;
  pressurePoint: string;
  winners: ChampionDelta[];
  losers: ChampionDelta[];
  roundMovers: RoundMover[];
  biggestWinner?: ChampionDelta;
  biggestLoser?: ChampionDelta;
  championFavorite?: {
    team: string;
    probability: number;
  };
};

export function buildButterflyEffect(prediction: Prediction, baseline: BaselinePrediction): ButterflyEffect {
  const championDeltas = buildChampionDeltas(prediction, baseline);
  const winners = championDeltas.filter((row) => row.delta > 0).slice(0, 5);
  const losers = [...championDeltas]
    .filter((row) => row.delta < 0)
    .sort((left, right) => left.delta - right.delta || left.team.localeCompare(right.team))
    .slice(0, 5);
  const roundMovers = buildRoundMovers(prediction, baseline).slice(0, 5);
  const pressurePoint = strongestGroupShift(prediction, baseline);
  const chaosScore = calculateChaosScore(championDeltas, roundMovers);
  const biggestWinner = winners[0];
  const biggestLoser = losers[0];
  const championFavorite = prediction.champion_probabilities[0];

  return {
    chaosScore,
    headline: headlineForChaos(chaosScore),
    narrative: narrativeForEffect(biggestWinner, biggestLoser, pressurePoint, chaosScore),
    pressurePoint,
    winners,
    losers,
    roundMovers,
    biggestWinner,
    biggestLoser,
    championFavorite
  };
}

export function formatSignedPercentPoints(value: number) {
  const sign = value >= 0 ? "+" : "";
  return `${sign}${(value * 100).toFixed(1)} pp`;
}

function buildChampionDeltas(prediction: Prediction, baseline: BaselinePrediction): ChampionDelta[] {
  const current = new Map(prediction.champion_probabilities.map((row) => [row.team, row.probability]));
  const base = new Map(baseline.champion_probabilities.map((row) => [row.team, row.probability]));
  const teams = new Set([...current.keys(), ...base.keys()]);

  return [...teams]
    .map((team) => {
      const currentProbability = current.get(team) ?? 0;
      const baselineProbability = base.get(team) ?? 0;
      return {
        team,
        baseline: baselineProbability,
        current: currentProbability,
        delta: currentProbability - baselineProbability
      };
    })
    .sort((left, right) => Math.abs(right.delta) - Math.abs(left.delta) || left.team.localeCompare(right.team));
}

function buildRoundMovers(prediction: Prediction, baseline: BaselinePrediction): RoundMover[] {
  const current = new Map(prediction.round_probabilities.map((row) => [row.team, row]));
  const base = new Map(baseline.round_probabilities.map((row) => [row.team, row]));
  const teams = new Set([...current.keys(), ...base.keys()]);

  return [...teams]
    .map((team) => {
      const currentRow = current.get(team);
      const baselineRow = base.get(team);
      let strongestRound: RoundKey = "champion";
      let strongestDelta = 0;
      let totalDelta = 0;

      for (const round of ROUND_KEYS) {
        const delta = (currentRow?.[round] ?? 0) - (baselineRow?.[round] ?? 0);
        totalDelta += delta;
        if (Math.abs(delta) > Math.abs(strongestDelta)) {
          strongestRound = round;
          strongestDelta = delta;
        }
      }

      return { team, delta: totalDelta, strongestRound, strongestDelta };
    })
    .sort((left, right) => Math.abs(right.delta) - Math.abs(left.delta) || left.team.localeCompare(right.team));
}

function strongestGroupShift(prediction: Prediction, baseline: BaselinePrediction) {
  let strongest = { group: "", shift: 0 };
  for (const [group, rows] of Object.entries(prediction.group_probabilities)) {
    const baselineRows = new Map((baseline.group_probabilities[group] ?? []).map((row) => [row.team, row.qualify]));
    const groupShift = rows.reduce((sum, row) => sum + Math.abs(row.qualify - (baselineRows.get(row.team) ?? 0)), 0);
    if (groupShift > strongest.shift) {
      strongest = { group, shift: groupShift };
    }
  }
  return strongest.group ? `Group ${strongest.group}` : "the bracket path";
}

function calculateChaosScore(championDeltas: ChampionDelta[], roundMovers: RoundMover[]) {
  const championSwing = championDeltas
    .slice(0, 10)
    .reduce((sum, row) => sum + Math.abs(row.delta), 0);
  const pathSwing = roundMovers
    .slice(0, 10)
    .reduce((sum, row) => sum + Math.abs(row.delta), 0);
  return clampInteger(championSwing * 420 + pathSwing * 18, 0, 100);
}

function headlineForChaos(score: number) {
  if (score >= 75) return "A tournament-shaking alternate reality";
  if (score >= 45) return "A bracket with serious butterfly effects";
  if (score >= 20) return "A quiet scenario with a few sharp twists";
  return "A steady scenario with small ripples";
}

function narrativeForEffect(
  biggestWinner: ChampionDelta | undefined,
  biggestLoser: ChampionDelta | undefined,
  pressurePoint: string,
  chaosScore: number
) {
  if (!biggestWinner && !biggestLoser) {
    return "This stays close to the baseline. The model sees your locked results as interesting, but not bracket-breaking.";
  }

  const winnerText = biggestWinner
    ? `${biggestWinner.team} gets the biggest lift (${formatSignedPercentPoints(biggestWinner.delta)})`
    : "No team gets a clear title boost";
  const loserText = biggestLoser
    ? `${biggestLoser.team} catches the heartbreak (${formatSignedPercentPoints(biggestLoser.delta)})`
    : "nobody takes a major hit";
  const mood = chaosScore >= 55 ? "That is enough to redraw the tournament mood." : "It is a ripple, not a full reset.";
  return `${winnerText}, while ${loserText}. Most of the swing starts around ${pressurePoint} and rolls into the knockout path. ${mood}`;
}

function clampInteger(value: number, min: number, max: number) {
  return Math.round(Math.min(max, Math.max(min, value)));
}
