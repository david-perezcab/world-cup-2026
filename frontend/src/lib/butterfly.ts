import type { BaselinePrediction, Prediction } from "../types";
import { displayTeamNameFor } from "./flags";

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
  const story = buildScenarioStory({
    prediction,
    baseline,
    chaosScore,
    pressurePoint,
    biggestWinner,
    biggestLoser,
    roundMovers
  });

  return {
    chaosScore,
    headline: story.headline,
    narrative: story.subtitle,
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
  return `${sign}${(value * 100).toFixed(1)}%`;
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
  return strongest.group ? `Grupo ${strongest.group}` : "el camino del cuadro";
}

function calculateChaosScore(championDeltas: ChampionDelta[], roundMovers: RoundMover[]) {
  const championSwing = championDeltas
    .slice(0, 10)
    .reduce((sum, row) => sum + Math.abs(row.delta), 0);
  const pathSwing = roundMovers
    .slice(0, 10)
    .reduce((sum, row) => sum + Math.abs(row.delta), 0);
  const rawScore = championSwing * 260 + pathSwing * 10;
  const curvedScore = 100 * (1 - Math.exp(-rawScore / 85));
  return clampInteger(curvedScore, 0, 100);
}

function headlineForChaos(score: number) {
  if (score >= 75) return "Una realidad alternativa que sacude el torneo";
  if (score >= 45) return "Un cuadro con efecto mariposa serio";
  if (score >= 20) return "Un escenario tranquilo con giros importantes";
  return "Un escenario estable con pequeños cambios";
}

function narrativeForEffect(
  biggestWinner: ChampionDelta | undefined,
  biggestLoser: ChampionDelta | undefined,
  pressurePoint: string,
  chaosScore: number
) {
  if (!biggestWinner && !biggestLoser) {
    return "El escenario se mantiene cerca de la base. El modelo ve tus resultados fijados como interesantes, pero no rompen el cuadro.";
  }

  const winnerText = biggestWinner
    ? `Ojito con ${displayTeamNameFor(biggestWinner.team)} (${formatSignedPercentPoints(biggestWinner.delta)})`
    : "Ninguna selección recibe un impulso claro hacia el título";
  const loserText = biggestLoser
    ? `${displayTeamNameFor(biggestLoser.team)} firma la mayor pechofriada (${formatSignedPercentPoints(biggestLoser.delta)})`
    : "nadie recibe un golpe fuerte";
  const mood = chaosScore >= 55 ? "Eso basta para cambiar el tono del torneo." : "Es una onda expansiva, no un reinicio completo.";
  return `${winnerText}, mientras ${loserText}. La mayor parte del cambio nace en ${pressurePoint} y se arrastra al camino eliminatorio. ${mood}`;
}

type ScenarioStoryContext = {
  prediction: Prediction;
  baseline: BaselinePrediction;
  chaosScore: number;
  pressurePoint: string;
  biggestWinner?: ChampionDelta;
  biggestLoser?: ChampionDelta;
  roundMovers: RoundMover[];
};

type ScenarioStory = {
  headline: string;
  subtitle: string;
};

function buildScenarioStory({
  prediction,
  baseline,
  chaosScore,
  pressurePoint,
  biggestWinner,
  biggestLoser,
  roundMovers
}: ScenarioStoryContext): ScenarioStory {
  const currentFavorite = prediction.champion_probabilities[0];
  const currentRunnerUp = prediction.champion_probabilities[1];
  const baselineFavorite = baseline.champion_probabilities[0];
  const currentFavoriteName = currentFavorite ? displayTeamNameFor(currentFavorite.team) : "el favorito";
  const baselineFavoriteName = baselineFavorite ? displayTeamNameFor(baselineFavorite.team) : "el favorito original";
  const biggestWinnerName = biggestWinner ? displayTeamNameFor(biggestWinner.team) : "";
  const biggestLoserName = biggestLoser ? displayTeamNameFor(biggestLoser.team) : "";
  const baselineFavoriteDelta = baselineFavorite ? championDeltaFor(baselineFavorite.team, prediction, baseline) : undefined;
  const strongestPathBoost = roundMovers.find((row) => row.strongestDelta >= 0.08);
  const strongestPathDrop = roundMovers.find((row) => row.strongestDelta <= -0.08);
  const surpriseWinner =
    biggestWinner && biggestWinner.baseline <= 0.08 && biggestWinner.current >= 0.06 && biggestWinner.delta >= 0.025
      ? biggestWinner
      : undefined;
  const hostWinner =
    biggestWinner && ["Canada", "Mexico", "USA"].includes(biggestWinner.team) && biggestWinner.delta >= 0.018
      ? biggestWinner
      : undefined;
  const favoriteGap = currentFavorite && currentRunnerUp ? currentFavorite.probability - currentRunnerUp.probability : 0;

  if (currentFavorite && baselineFavorite && currentFavorite.team !== baselineFavorite.team) {
    return {
      headline: `Cambio de mando: ${currentFavoriteName} le arrebata el trono a ${baselineFavoriteName}`,
      subtitle: `${currentFavoriteName} sube hasta el ${formatProbability(currentFavorite.probability)} de título. ${pressurePoint} es el punto donde empieza a torcerse el guion.`
    };
  }

  if (hostWinner) {
    return {
      headline: `El anfitrión se enchufa: ${displayTeamNameFor(hostWinner.team)} empieza a creer`,
      subtitle: `Su opción de campeón mejora ${formatSignedPercentPoints(hostWinner.delta)} y convierte ${pressurePoint} en una zona caliente del torneo.`
    };
  }

  if (chaosScore >= 82 && biggestWinner && biggestLoser) {
    return {
      headline: "Terremoto mundialista: el cuadro salta por los aires",
      subtitle: `${biggestWinnerName} gana ${formatSignedPercentPoints(biggestWinner.delta)} y ${biggestLoserName} cae ${formatSignedPercentPoints(biggestLoser.delta)}. Esto ya no es un ajuste: es otro Mundial.`
    };
  }

  if (baselineFavoriteDelta && baselineFavoriteDelta.delta <= -0.035 && baselineFavorite) {
    return {
      headline: `Alerta roja para ${baselineFavoriteName}: la favorita sangra`,
      subtitle: `Pierde ${formatSignedPercentPoints(baselineFavoriteDelta.delta)} de opciones de título y su ruta queda mucho más incómoda desde ${pressurePoint}.`
    };
  }

  if (surpriseWinner) {
    return {
      headline: `Nadie lo vio venir: ${displayTeamNameFor(surpriseWinner.team)} se mete en la conversación`,
      subtitle: `Partía desde atrás, pero este escenario le suma ${formatSignedPercentPoints(surpriseWinner.delta)} y le abre una ventana real hacia rondas grandes.`
    };
  }

  if (strongestPathBoost && strongestPathBoost.team !== biggestWinner?.team) {
    return {
      headline: `Autopista inesperada para ${displayTeamNameFor(strongestPathBoost.team)}`,
      subtitle: `Su camino hacia ${roundLabelForStory(strongestPathBoost.strongestRound)} mejora ${formatSignedPercentPoints(strongestPathBoost.strongestDelta)}. No gana el titular por campeón, pero sí por ruta.`
    };
  }

  if (biggestLoser && biggestLoser.delta <= -0.03) {
    return {
      headline: `Mayor Pechofriada: ${biggestLoserName} se mete en un lío`,
      subtitle: `Su probabilidad de título cae ${formatSignedPercentPoints(biggestLoser.delta)}. El golpe nace en ${pressurePoint} y se arrastra al cuadro.`
    };
  }

  if (biggestWinner && biggestWinner.delta >= 0.03) {
    return {
      headline: `Ojito con ${biggestWinnerName}: el escenario le abre la puerta`,
      subtitle: `Es quien más sube hacia el título (${formatSignedPercentPoints(biggestWinner.delta)}). No necesita dominar el torneo: necesita que este camino se mantenga.`
    };
  }

  if (strongestPathDrop) {
    return {
      headline: `Ruta de pesadilla para ${displayTeamNameFor(strongestPathDrop.team)}`,
      subtitle: `Su probabilidad de llegar a ${roundLabelForStory(strongestPathDrop.strongestRound)} cae ${formatSignedPercentPoints(strongestPathDrop.strongestDelta)}. El cuadro se le ha puesto cuesta arriba.`
    };
  }

  if (chaosScore >= 55 && biggestWinner && biggestLoser) {
    return {
      headline: "Efecto dominó: un par de resultados cambian medio torneo",
      subtitle: `${biggestWinnerName} respira, ${biggestLoserName} sufre y ${pressurePoint} aparece como el foco principal del movimiento.`
    };
  }

  if (currentFavorite && currentRunnerUp && favoriteGap <= 0.015) {
    return {
      headline: "La pelea por el trono está en un pañuelo",
      subtitle: `${currentFavoriteName} lidera, pero ${displayTeamNameFor(currentRunnerUp.team)} está a solo ${formatProbability(favoriteGap)}. Cualquier cruce puede cambiar el favorito.`
    };
  }

  if (currentFavorite && favoriteGap >= 0.06 && chaosScore < 45) {
    return {
      headline: `${currentFavoriteName} aguanta el trono sin despeinarse`,
      subtitle: `El escenario mueve algunas rutas, pero el favorito sigue con una ventaja cómoda: ${formatProbability(currentFavorite.probability)} de campeón.`
    };
  }

  if (biggestWinner && biggestLoser) {
    return {
      headline: "Hay movimiento, pero no revolución",
      subtitle: `${biggestWinnerName} gana ${formatSignedPercentPoints(biggestWinner.delta)} y ${biggestLoserName} pierde ${formatSignedPercentPoints(biggestLoser.delta)}. El torneo cambia, pero no se rompe.`
    };
  }

  return {
    headline: "Pocos terremotos: el escenario se mantiene estable",
    subtitle: `El modelo apenas se aleja de la base. ${pressurePoint} mueve algo el camino, pero no cambia el relato principal del Mundial.`
  };
}

function championDeltaFor(team: string, prediction: Prediction, baseline: BaselinePrediction): ChampionDelta {
  const current = prediction.champion_probabilities.find((row) => row.team === team)?.probability ?? 0;
  const base = baseline.champion_probabilities.find((row) => row.team === team)?.probability ?? 0;
  return { team, current, baseline: base, delta: current - base };
}

function formatProbability(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}

function roundLabelForStory(round: RoundKey) {
  const labels: Record<RoundKey, string> = {
    round_of_32: "dieciseisavos",
    round_of_16: "octavos",
    quarter_final: "cuartos",
    semi_final: "semifinales",
    final: "la final",
    champion: "el título"
  };
  return labels[round];
}

function clampInteger(value: number, min: number, max: number) {
  return Math.round(Math.min(max, Math.max(min, value)));
}
