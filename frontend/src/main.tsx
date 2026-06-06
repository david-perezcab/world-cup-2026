import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { buildButterflyEffect, formatSignedPercentPoints, type ButterflyEffect } from "./lib/butterfly";
import { bracketLayout, buildKnockoutDisplayTeams, type BracketPosition, type DisplayTeams } from "./lib/bracket";
import { flagLabelFor, flagUrlFor, isPlaceholderTeam, teamCodeFor } from "./lib/flags";
import { completeFacts, encodeScenario, scenarioFromHash } from "./lib/scenario";
import { computeStandings } from "./lib/standings";
import type { BaselinePrediction, FactDraft, Match, Prediction, Tournament } from "./types";
import "./styles.css";

type Tab = "groups" | "knockout" | "predictions";
type RatingContext = {
  ratings: Record<string, number>;
  groupRatings: Record<string, number[]>;
  averageRating: number;
};
type SimulatorProfile = {
  surprise: number;
};

const NAV_ITEMS: Array<{ tab: Tab; label: string }> = [
  { tab: "groups", label: "Groups" },
  { tab: "knockout", label: "Knockout" },
  { tab: "predictions", label: "Predictions" }
];

const BRACKET_ROUNDS = ["Round of 32", "Round of 16", "Quarter-final", "Semi-final", "Final"];
const WORLD_CUP_26_LOGO = "https://www.edigitalagency.com.au/wp-content/uploads/new-FIFA-World-Cup-2026-logo-white-PNG-large-size.png";
const BRACKET_CARD_WIDTH = 156;
const BRACKET_COLUMN_GAP = 60;
const BRACKET_ROW_HEIGHT = 90;
const BRACKET_PENALTY_ROW_HEIGHT = 90;
const BRACKET_ROWS = 33;
const BRACKET_CARD_ROW_SPAN = 2;
const BRACKET_WIDTH = BRACKET_ROUNDS.length * BRACKET_CARD_WIDTH + (BRACKET_ROUNDS.length - 1) * BRACKET_COLUMN_GAP;
const BRACKET_HEADER_STYLE: React.CSSProperties = {
  gridTemplateColumns: `repeat(${BRACKET_ROUNDS.length}, ${BRACKET_CARD_WIDTH}px)`,
  columnGap: BRACKET_COLUMN_GAP,
  minWidth: BRACKET_WIDTH
};

function App() {
  const [tournament, setTournament] = useState<Tournament | null>(null);
  const [facts, setFacts] = useState<Record<number, FactDraft>>({});
  const [activeTab, setActiveTab] = useState<Tab>(() => tabFromSearch(window.location.search) ?? "groups");
  const [prediction, setPrediction] = useState<Prediction | null>(null);
  const [baseline, setBaseline] = useState<BaselinePrediction | null>(null);
  const [baselineError, setBaselineError] = useState<string | null>(null);
  const [simulations, setSimulations] = useState(20000);
  const [simulatorSurprise, setSimulatorSurprise] = useState(35);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shareStatus, setShareStatus] = useState<string | null>(null);

  useEffect(() => {
    const scenario = scenarioFromHash(window.location.hash);
    if (scenario) {
      setFacts(scenario);
    }
  }, []);

  useEffect(() => {
    fetch("/api/tournament")
      .then((response) => {
        if (!response.ok) {
          throw new Error("Could not load tournament data.");
        }
        return response.json();
      })
      .then(setTournament)
      .catch((err: Error) => setError(err.message));
  }, []);

  useEffect(() => {
    let active = true;

    async function loadBaseline() {
      try {
        const response = await fetch("/api/baseline", { headers: { Accept: "application/json" } });
        const contentType = response.headers.get("content-type") ?? "";
        if (!response.ok || !contentType.includes("application/json")) {
          throw new Error("Butterfly Effect baseline is unavailable. Restart the FastAPI server to enable /api/baseline.");
        }
        const payload = (await response.json()) as BaselinePrediction;
        if (active) {
          setBaseline(payload);
          setBaselineError(null);
        }
      } catch (err) {
        if (active) {
          setBaselineError(err instanceof Error ? err.message : "Butterfly Effect baseline is unavailable.");
        }
      }
    }

    loadBaseline();
    return () => {
      active = false;
    };
  }, []);

  const groupMatches = useMemo(() => {
    if (!tournament) return {};
    return Object.fromEntries(
      Object.keys(tournament.groups).map((group) => [
        group,
        tournament.matches.filter((match) => match.group === `Group ${group}`)
      ])
    ) as Record<string, Match[]>;
  }, [tournament]);

  const knockoutDisplayTeams = useMemo(() => {
    if (!tournament) return {};
    return buildKnockoutDisplayTeams(tournament.matches, tournament.groups, facts);
  }, [facts, tournament]);

  const knockoutLayout = useMemo(() => {
    if (!tournament) return {};
    return bracketLayout(tournament.matches.filter((match) => match.is_knockout));
  }, [tournament]);

  const ratingContext = useMemo(() => {
    if (!tournament) return null;
    return buildRatingContext(tournament);
  }, [tournament]);

  function updateScore(match: Match, side: "home_score" | "away_score", rawValue: string) {
    setFacts((current) => {
      const next = { ...current };
      const existing = next[match.match_id] ?? { match_id: match.match_id, source: "manual" as const };
      const value = rawValue === "" ? undefined : Number(rawValue);
      next[match.match_id] = { ...existing, [side]: value };
      if (next[match.match_id].home_score === undefined && next[match.match_id].away_score === undefined) {
        delete next[match.match_id];
      }
      return next;
    });
  }

  function updateKnockoutWinner(match: Match, winner: "home" | "away") {
    setFacts((current) => {
      const existing = current[match.match_id] ?? { match_id: match.match_id, source: "manual" as const };
      return { ...current, [match.match_id]: { ...existing, knockout_winner: winner } };
    });
  }

  function resetMatch(matchId: number) {
    setFacts((current) => {
      const next = { ...current };
      delete next[matchId];
      return next;
    });
  }

  function simulateMatches(matches: Match[], displayTeamsByMatch: Record<number, DisplayTeams> = {}) {
    if (!ratingContext) return;
    setFacts((current) => {
      const next = { ...current };
      for (const match of matches) {
        next[match.match_id] = createSimulatedFact(
          match,
          ratingContext,
          { surprise: simulatorSurprise },
          displayTeamsByMatch[match.match_id],
          current[match.match_id]
        );
      }
      return next;
    });
  }

  function simulateMatch(match: Match, displayTeams?: DisplayTeams) {
    simulateMatches([match], displayTeams ? { [match.match_id]: displayTeams } : {});
  }

  function simulateGroup(matches: Match[]) {
    simulateMatches(matches);
  }

  function simulateAllGroups() {
    simulateMatches(Object.values(groupMatches).flat());
  }

  function clearScenario() {
    setFacts({});
    setPrediction(null);
    window.history.replaceState(null, "", window.location.pathname);
    setShareStatus(null);
  }

  async function copyShareLink() {
    const encoded = encodeScenario(facts);
    const url = `${window.location.origin}${window.location.pathname}#scenario=${encoded}`;
    await navigator.clipboard.writeText(url);
    window.history.replaceState(null, "", `#scenario=${encoded}`);
  }

  function validateFacts(): string | null {
    if (!tournament) return "Tournament data is not loaded.";
    for (const match of tournament.matches) {
      const fact = facts[match.match_id];
      if (!fact) continue;
      const hasHome = fact.home_score !== undefined;
      const hasAway = fact.away_score !== undefined;
      if (hasHome !== hasAway) {
        return `Match ${match.match_id} has an incomplete score.`;
      }
      if (
        match.is_knockout &&
        fact.home_score !== undefined &&
        fact.away_score !== undefined &&
        fact.home_score === fact.away_score &&
        !fact.knockout_winner
      ) {
        return `Match ${match.match_id} is tied and needs an advancing side.`;
      }
    }
    return null;
  }

  async function runPrediction() {
    const validationError = validateFacts();
    if (validationError) {
      setError(validationError);
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const response = await fetch("/api/predict", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          facts: completeFacts(facts),
          settings: { simulations }
        })
      });
      if (!response.ok) {
        const detail = await response.json();
        throw new Error(detail.detail ?? "Prediction failed.");
      }
      const payload = (await response.json()) as Prediction;
      setPrediction(payload);
      setActiveTab("predictions");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Prediction failed.");
    } finally {
      setLoading(false);
    }
  }

  if (!tournament) {
    return (
      <main className="loading-shell">
        <section className="loading-panel">{error ?? "Loading tournament data..."}</section>
      </main>
    );
  }

  const knockoutMatches = tournament.matches.filter((match) => match.is_knockout);
  const factCount = completeFacts(facts).length;

  return (
    <main className="app-frame">
      <Sidebar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        factCount={factCount}
        simulations={simulations}
        setSimulations={setSimulations}
        loading={loading}
        runPrediction={runPrediction}
        copyShareLink={copyShareLink}
        clearScenario={clearScenario}
        shareStatus={shareStatus}
      />

      <section className="content-shell">
        <header className="topbar">
          <div>
            <p className="eyebrow">FIFA World Cup 2026</p>
            <h1>Prediction Lab</h1>
          </div>
        </header>

        {error && <section className="error-panel">{error}</section>}

        {activeTab === "groups" && (
          <GroupsView
            groups={tournament.groups}
            groupMatches={groupMatches}
            facts={facts}
            updateScore={updateScore}
            resetMatch={resetMatch}
            simulateMatch={simulateMatch}
            simulateGroup={simulateGroup}
            simulateAllGroups={simulateAllGroups}
            simulatorSurprise={simulatorSurprise}
            setSimulatorSurprise={setSimulatorSurprise}
          />
        )}

        {activeTab === "knockout" && (
          <KnockoutView
            matches={knockoutMatches}
            displayTeams={knockoutDisplayTeams}
            layout={knockoutLayout}
            facts={facts}
            updateScore={updateScore}
            updateKnockoutWinner={updateKnockoutWinner}
            resetMatch={resetMatch}
            simulateMatch={simulateMatch}
          />
        )}

        {activeTab === "predictions" && (
          <PredictionsView prediction={prediction} baseline={baseline} baselineError={baselineError} />
        )}
      </section>
    </main>
  );
}

function Sidebar({
  activeTab,
  setActiveTab,
  factCount,
  simulations,
  setSimulations,
  loading,
  runPrediction,
  copyShareLink,
  clearScenario,
  shareStatus
}: {
  activeTab: Tab;
  setActiveTab: (tab: Tab) => void;
  factCount: number;
  simulations: number;
  setSimulations: (value: number) => void;
  loading: boolean;
  runPrediction: () => void;
  copyShareLink: () => void;
  clearScenario: () => void;
  shareStatus: string | null;
}) {
  return (
    <aside className="side-menu">
      <div className="side-header">
        <div className="brand-mark">
          <img src={WORLD_CUP_26_LOGO} alt="FIFA World Cup 26 logo" />
        </div>
        <div className="side-title">
          <strong>World Cup</strong>
          <span>Scenario Lab</span>
        </div>
      </div>

      <nav className="side-nav" aria-label="Prediction views">
        {NAV_ITEMS.map((item) => (
          <button
            key={item.tab}
            className={activeTab === item.tab ? "active" : ""}
            onClick={() => setActiveTab(item.tab)}
          >
            <span className="nav-label">{item.label}</span>
          </button>
        ))}
      </nav>

      <div className="side-card scenario-card">
        <span className="card-label">Scenario</span>
        <strong>{factCount}</strong>
        <span>result{factCount === 1 ? "" : "s"} locked</span>
      </div>

      <div className="side-card controls-card">
        <label>
          Simulations
          <input
            type="number"
            min={100}
            max={50000}
            step={100}
            value={simulations}
            onChange={(event) => setSimulations(Number(event.target.value))}
          />
        </label>
        <button className="primary" onClick={runPrediction} disabled={loading}>
          {loading ? "Running..." : "Generate"}
        </button>
      </div>

      <div className="side-actions">
        <button onClick={copyShareLink}>Copy Share Link</button>
        <button onClick={clearScenario}>Clear Edits</button>
        {shareStatus && <span className="status-note">{shareStatus}</span>}
      </div>
    </aside>
  );
}

function GroupsView({
  groups,
  groupMatches,
  facts,
  updateScore,
  resetMatch,
  simulateMatch,
  simulateGroup,
  simulateAllGroups,
  simulatorSurprise,
  setSimulatorSurprise
}: {
  groups: Record<string, string[]>;
  groupMatches: Record<string, Match[]>;
  facts: Record<number, FactDraft>;
  updateScore: (match: Match, side: "home_score" | "away_score", value: string) => void;
  resetMatch: (matchId: number) => void;
  simulateMatch: (match: Match, displayTeams?: DisplayTeams) => void;
  simulateGroup: (matches: Match[]) => void;
  simulateAllGroups: () => void;
  simulatorSurprise: number;
  setSimulatorSurprise: (value: number) => void;
}) {
  return (
    <section className="view-stack">
      <ViewIntro
        title="Group Stage"
        detail="Enter confirmed scores and watch the live table recalculate instantly."
        actions={
          <>
            <label className="surprise-slider">
              <span>Favorites</span>
              <input
                aria-label="Match simulator surprise level"
                type="range"
                min={0}
                max={100}
                value={simulatorSurprise}
                onChange={(event) => setSimulatorSurprise(Number(event.target.value))}
              />
              <span>Surprises</span>
            </label>
            <button className="simulate-button intro-action" type="button" onClick={simulateAllGroups}>
              <span aria-hidden="true">{"\u{1F3B2}"}</span>
              All Groups
            </button>
          </>
        }
      />
      <div className="groups-grid">
        {Object.entries(groups).map(([group, teams]) => {
          const matches = groupMatches[group] ?? [];
          const standings = computeStandings(teams, matches, facts);
          return (
            <article className="group-panel" key={group}>
              <header className="panel-header">
                <div>
                  <p className="panel-kicker">Group</p>
                  <h2>{group}</h2>
                </div>
                <div className="panel-actions">
                  <span>{matches.length} matches</span>
                  <button className="simulate-button group-sim-button" type="button" onClick={() => simulateGroup(matches)}>
                    <span aria-hidden="true">{"\u{1F3B2}"}</span>
                    Group
                  </button>
                </div>
              </header>
              <StandingsTable rows={standings} compact />
              <div className="fixture-list">
                {matches.map((match) => (
                  <MatchEditor
                    key={match.match_id}
                    match={match}
                    fact={facts[match.match_id]}
                    updateScore={updateScore}
                    resetMatch={resetMatch}
                    simulateMatch={simulateMatch}
                  />
                ))}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function KnockoutView({
  matches,
  displayTeams,
  layout,
  facts,
  updateScore,
  updateKnockoutWinner,
  resetMatch,
  simulateMatch
}: {
  matches: Match[];
  displayTeams: Record<number, DisplayTeams>;
  layout: Record<number, BracketPosition>;
  facts: Record<number, FactDraft>;
  updateScore: (match: Match, side: "home_score" | "away_score", value: string) => void;
  updateKnockoutWinner: (match: Match, winner: "home" | "away") => void;
  resetMatch: (matchId: number) => void;
  simulateMatch: (match: Match, displayTeams?: DisplayTeams) => void;
}) {
  const rounds = groupBy(matches, (match) => match.round);
  const thirdPlaceMatches = rounds["Match for third place"] ?? [];
  const bracketMatches = matches.filter((match) => match.round !== "Match for third place");
  const rowHeight = hasRoundOf32Penalties(bracketMatches, facts) ? BRACKET_PENALTY_ROW_HEIGHT : BRACKET_ROW_HEIGHT;
  const bracketHeight = BRACKET_ROWS * rowHeight;
  const connectors = buildBracketConnectors(layout, rowHeight);

  return (
    <section className="view-stack">
      <ViewIntro title="Knockout Bracket" detail="Fill tied factual knockouts with the side that advanced." />
      <div className="bracket-shell">
        <div className="bracket-headers" style={BRACKET_HEADER_STYLE}>
          {BRACKET_ROUNDS.map((round) => (
            <h2 key={round}>{round}</h2>
          ))}
        </div>
        <div className="bracket-board" style={bracketBoardStyle(rowHeight, bracketHeight)}>
          <svg
            className="bracket-lines"
            width={BRACKET_WIDTH}
            height={bracketHeight}
            viewBox={`0 0 ${BRACKET_WIDTH} ${bracketHeight}`}
            aria-hidden="true"
          >
            {connectors.map((path, index) => (
              <path className="bracket-line" d={path} key={`${path}-${index}`} />
            ))}
          </svg>
          {bracketMatches.map((match) => {
            const position = layout[match.match_id] ?? { round: match.round, column: 1, slot: 1, childMatchIds: [] };
            return (
              <div
                className={`bracket-card ${match.round === "Final" ? "final-card" : ""}`}
                key={match.match_id}
                style={{ gridColumn: position.column, gridRow: `${position.slot} / span ${BRACKET_CARD_ROW_SPAN}` }}
              >
                <KnockoutMatchCard
                  match={match}
                  displayTeams={displayTeams[match.match_id]}
                  fact={facts[match.match_id]}
                  updateScore={updateScore}
                  updateKnockoutWinner={updateKnockoutWinner}
                  resetMatch={resetMatch}
                  simulateMatch={simulateMatch}
                />
              </div>
            );
          })}
        </div>
      </div>

      {thirdPlaceMatches.length > 0 && (
        <article className="third-place-panel">
          <header className="panel-header">
            <h2>Third Place</h2>
          </header>
          <div className="fixture-list single-column">
            {thirdPlaceMatches.map((match) => (
              <KnockoutMatchCard
                key={match.match_id}
                match={match}
                displayTeams={displayTeams[match.match_id]}
                fact={facts[match.match_id]}
                updateScore={updateScore}
                updateKnockoutWinner={updateKnockoutWinner}
                resetMatch={resetMatch}
                simulateMatch={simulateMatch}
              />
            ))}
          </div>
        </article>
      )}
    </section>
  );
}

function KnockoutMatchCard({
  match,
  displayTeams,
  fact,
  updateScore,
  updateKnockoutWinner,
  resetMatch,
  simulateMatch
}: {
  match: Match;
  displayTeams?: DisplayTeams;
  fact?: FactDraft;
  updateScore: (match: Match, side: "home_score" | "away_score", value: string) => void;
  updateKnockoutWinner: (match: Match, winner: "home" | "away") => void;
  resetMatch: (matchId: number) => void;
  simulateMatch: (match: Match, displayTeams?: DisplayTeams) => void;
}) {
  const tied =
    fact?.home_score !== undefined &&
    fact.away_score !== undefined &&
    fact.home_score === fact.away_score;

  return (
    <div className={`knockout-match ${tied ? "needs-advancer" : ""}`}>
      <MatchEditor
        match={match}
        displayTeams={displayTeams}
        fact={fact}
        updateScore={updateScore}
        resetMatch={resetMatch}
        simulateMatch={simulateMatch}
        compact
      />
      {tied && (
        <label className="winner-select">
          <span>Adv.</span>
          <select
            value={fact.knockout_winner ?? ""}
            onChange={(event) => updateKnockoutWinner(match, event.target.value as "home" | "away")}
          >
            <option value="">Choose side</option>
            <option value="home">{matchOptionLabel(displayTeams?.homeTeam ?? match.home_team)}</option>
            <option value="away">{matchOptionLabel(displayTeams?.awayTeam ?? match.away_team)}</option>
          </select>
        </label>
      )}
    </div>
  );
}

function MatchEditor({
  match,
  displayTeams,
  fact,
  updateScore,
  resetMatch,
  simulateMatch,
  compact = false
}: {
  match: Match;
  displayTeams?: DisplayTeams;
  fact?: FactDraft;
  updateScore: (match: Match, side: "home_score" | "away_score", value: string) => void;
  resetMatch: (matchId: number) => void;
  simulateMatch: (match: Match, displayTeams?: DisplayTeams) => void;
  compact?: boolean;
}) {
  const homeTeam = displayTeams?.homeTeam ?? match.home_team;
  const awayTeam = displayTeams?.awayTeam ?? match.away_team;

  return (
    <div className={`match-editor ${compact ? "compact-match" : ""}`}>
      <div className={`match-actions ${compact ? "compact-actions" : ""}`}>
        <button
          className="simulate-button match-sim-button"
          type="button"
          title="Simulate match"
          aria-label={`Simulate match ${match.match_id}`}
          onClick={() => simulateMatch(match, displayTeams)}
        >
          {"\u{1F3B2}"}
        </button>
        {compact && (
          <button className="ghost-button compact-reset-button" title="Reset match" onClick={() => resetMatch(match.match_id)}>
            Reset
          </button>
        )}
      </div>
      <div className="match-meta">
        <span>M{match.match_id}</span>
        <span>{formatSpainKickoff(match)}</span>
      </div>
      {compact ? (
        <div className="score-stack">
          <TeamScoreRow
            team={homeTeam}
            score={fact?.home_score}
            ariaLabel={`${homeTeam} score`}
            onChange={(value) => updateScore(match, "home_score", value)}
          />
          <TeamScoreRow
            team={awayTeam}
            score={fact?.away_score}
            ariaLabel={`${awayTeam} score`}
            onChange={(value) => updateScore(match, "away_score", value)}
          />
        </div>
      ) : (
        <div className="score-row">
          <TeamName team={homeTeam} matchLabel />
          <input
            aria-label={`${homeTeam} score`}
            type="number"
            min={0}
            max={30}
            value={fact?.home_score ?? ""}
            onChange={(event) => updateScore(match, "home_score", event.target.value)}
          />
          <span className="score-separator">-</span>
          <input
            aria-label={`${awayTeam} score`}
            type="number"
            min={0}
            max={30}
            value={fact?.away_score ?? ""}
            onChange={(event) => updateScore(match, "away_score", event.target.value)}
          />
          <TeamName team={awayTeam} align="right" matchLabel />
          <button className="ghost-button" title="Reset match" onClick={() => resetMatch(match.match_id)}>
            Reset
          </button>
        </div>
      )}
    </div>
  );
}

function TeamScoreRow({
  team,
  score,
  ariaLabel,
  onChange
}: {
  team: string;
  score?: number;
  ariaLabel: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="team-score-row">
      <TeamName team={team} matchLabel />
      <input
        aria-label={ariaLabel}
        type="number"
        min={0}
        max={30}
        value={score ?? ""}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

function PredictionsView({
  prediction,
  baseline,
  baselineError
}: {
  prediction: Prediction | null;
  baseline: BaselinePrediction | null;
  baselineError: string | null;
}) {
  if (!prediction) {
    return (
      <section className="empty-state">
        <h2>No prediction run yet</h2>
        <p>Lock any real scores you want to treat as facts, then run the simulation from the side menu.</p>
      </section>
    );
  }

  const effect =
    baseline && baseline.data_version === prediction.data_version ? buildButterflyEffect(prediction, baseline) : null;
  const baselineNote =
    baseline && baseline.data_version !== prediction.data_version
      ? "Butterfly Effect is hidden because the baseline snapshot is from a different data version."
      : baselineError;

  return (
    <section className="predictions-layout">
      <ViewIntro
        title="Prediction Board"
        detail={`${prediction.settings.simulations.toLocaleString()} simulations with a fresh draw`}
      />

      <article className="wide-panel champion-panel">
        <header className="panel-header">
          <div>
            <p className="panel-kicker">Projected winner</p>
            <h2>Champion Probabilities</h2>
          </div>
        </header>
        <div className="probability-list">
          {prediction.champion_probabilities.slice(0, 16).map((row, index) => (
            <div className="probability-row" key={row.team}>
              <span className="rank">{index + 1}</span>
              <TeamName team={row.team} />
              <div className="bar-track">
                <div className="bar-fill" style={{ width: `${row.probability * 100}%` }} />
              </div>
              <strong>{formatPercent(row.probability)}</strong>
            </div>
          ))}
        </div>
      </article>

      {effect ? (
        <ButterflyEffectPanel effect={effect} prediction={prediction} />
      ) : (
        baselineNote && <p className="butterfly-note">{baselineNote}</p>
      )}

      <article className="wide-panel">
        <h2>Round-by-Round</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Team</th>
                <th>R32</th>
                <th>R16</th>
                <th>QF</th>
                <th>SF</th>
                <th>Final</th>
                <th>Champion</th>
              </tr>
            </thead>
            <tbody>
              {prediction.round_probabilities.slice(0, 24).map((row) => (
                <tr key={row.team}>
                  <td>
                    <TeamName team={row.team} />
                  </td>
                  <td>{formatPercent(row.round_of_32)}</td>
                  <td>{formatPercent(row.round_of_16)}</td>
                  <td>{formatPercent(row.quarter_final)}</td>
                  <td>{formatPercent(row.semi_final)}</td>
                  <td>{formatPercent(row.final)}</td>
                  <td>{formatPercent(row.champion)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </article>

      <article className="wide-panel">
        <h2>Group Qualification</h2>
        <div className="group-prob-grid">
          {Object.entries(prediction.group_probabilities).map(([group, rows]) => (
            <div className="mini-table" key={group}>
              <h3>Group {group}</h3>
              {rows.map((row) => (
                <div className="mini-row" key={row.team}>
                  <TeamName team={row.team} compact />
                  <strong>{formatPercent(row.qualify)}</strong>
                </div>
              ))}
            </div>
          ))}
        </div>
      </article>
    </section>
  );
}

function ButterflyEffectPanel({ effect, prediction }: { effect: ButterflyEffect; prediction: Prediction }) {
  const [imageStatus, setImageStatus] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  async function handleShareImage() {
    setExporting(true);
    setImageStatus(null);
    try {
      const copied = await downloadButterflyShareCard(effect, prediction);
      setImageStatus(copied ? "PNG copied and downloaded." : "PNG downloaded.");
    } catch (err) {
      setImageStatus(err instanceof Error ? err.message : "Could not create the share image.");
    } finally {
      setExporting(false);
    }
  }

  return (
    <article className="wide-panel butterfly-panel">
      <header className="butterfly-hero">
        <div>
          <p className="panel-kicker">Butterfly Effect</p>
          <h2>{effect.headline}</h2>
          <p>{effect.narrative}</p>
        </div>
        <div className="effect-score" aria-label={`Chaos score ${effect.chaosScore} out of 100`}>
          <span>Chaos Score</span>
          <strong>{effect.chaosScore}</strong>
          <small>/100</small>
        </div>
        <div className="share-image-actions">
          <button className="simulate-button share-image-button" type="button" onClick={handleShareImage} disabled={exporting}>
            {exporting ? "Creating..." : "Share Image"}
          </button>
          {imageStatus && <span className="status-note">{imageStatus}</span>}
        </div>
      </header>

      <div className="effect-grid">
        <EffectSummaryCard
          label="Biggest lift"
          team={effect.biggestWinner?.team}
          value={effect.biggestWinner ? formatSignedPercentPoints(effect.biggestWinner.delta) : "Even"}
          tone="positive"
        />
        <EffectSummaryCard
          label="Biggest heartbreak"
          team={effect.biggestLoser?.team}
          value={effect.biggestLoser ? formatSignedPercentPoints(effect.biggestLoser.delta) : "None"}
          tone="negative"
        />
        <EffectSummaryCard
          label="Favorite now"
          team={effect.championFavorite?.team}
          value={effect.championFavorite ? formatPercent(effect.championFavorite.probability) : "Open"}
        />
        <EffectSummaryCard label="Pressure point" team={effect.pressurePoint} value="Path shift" />
      </div>

      <div className="delta-layout">
        <DeltaList title="Winners" rows={effect.winners} tone="positive" />
        <DeltaList title="Heartbreaks" rows={effect.losers} tone="negative" />
        <div className="delta-list round-delta-list">
          <h3>Path Movers</h3>
          {effect.roundMovers.length > 0 ? (
            effect.roundMovers.map((row) => (
              <div className="delta-row" key={row.team}>
                <TeamName team={row.team} compact />
                <span>{roundLabel(row.strongestRound)}</span>
                <strong className={row.strongestDelta >= 0 ? "positive" : "negative"}>
                  {formatSignedPercentPoints(row.strongestDelta)}
                </strong>
              </div>
            ))
          ) : (
            <p className="muted-text">No clear path swing yet.</p>
          )}
        </div>
      </div>
    </article>
  );
}

function EffectSummaryCard({
  label,
  team,
  value,
  tone
}: {
  label: string;
  team?: string;
  value: string;
  tone?: "positive" | "negative";
}) {
  return (
    <div className="effect-card">
      <span>{label}</span>
      <strong>{team && !team.startsWith("Group ") ? <TeamName team={team} compact /> : (team ?? "No swing")}</strong>
      <em className={tone}>{value}</em>
    </div>
  );
}

function DeltaList({ title, rows, tone }: { title: string; rows: Array<{ team: string; delta: number }>; tone: "positive" | "negative" }) {
  return (
    <div className="delta-list">
      <h3>{title}</h3>
      {rows.length > 0 ? (
        rows.map((row) => (
          <div className="delta-row" key={row.team}>
            <TeamName team={row.team} compact />
            <strong className={tone}>{formatSignedPercentPoints(row.delta)}</strong>
          </div>
        ))
      ) : (
        <p className="muted-text">No major movement.</p>
      )}
    </div>
  );
}

async function downloadButterflyShareCard(effect: ButterflyEffect, prediction: Prediction) {
  const svg = buildButterflyShareSvg(effect, prediction);
  const svgBlob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
  const svgUrl = URL.createObjectURL(svgBlob);
  const image = await loadImage(svgUrl);
  URL.revokeObjectURL(svgUrl);

  const canvas = document.createElement("canvas");
  canvas.width = 1200;
  canvas.height = 630;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Canvas is not available.");
  }
  context.drawImage(image, 0, 0);

  const pngBlob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!pngBlob) {
    throw new Error("Could not create PNG.");
  }

  const copied = await copyPngToClipboard(pngBlob);
  const pngUrl = URL.createObjectURL(pngBlob);
  const link = document.createElement("a");
  link.href = pngUrl;
  link.download = "world-cup-2026-butterfly-effect.png";
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(pngUrl), 1000);
  return copied;
}

function buildButterflyShareSvg(effect: ButterflyEffect, prediction: Prediction) {
  const winner = effect.biggestWinner
    ? `${effect.biggestWinner.team} ${formatSignedPercentPoints(effect.biggestWinner.delta)}`
    : "No clear boost";
  const heartbreak = effect.biggestLoser
    ? `${effect.biggestLoser.team} ${formatSignedPercentPoints(effect.biggestLoser.delta)}`
    : "No major heartbreak";
  const favorite = effect.championFavorite
    ? `${effect.championFavorite.team} ${formatPercent(effect.championFavorite.probability)}`
    : "Wide open";
  const headline = svgTextBlock(effect.headline, 72, 154, 48, 58, 34);
  const narrative = svgTextBlock(effect.narrative, 72, 520, 24, 34, 78, 2);

  return `
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="#0b1f17"/>
  <rect x="36" y="36" width="1128" height="558" rx="28" fill="#123724" stroke="#d8ebe1" stroke-opacity="0.18"/>
  <rect x="72" y="72" width="238" height="58" rx="16" fill="#dcefe4" fill-opacity="0.12"/>
  <text x="96" y="109" fill="#ffffff" font-family="Aptos, Segoe UI, Arial, sans-serif" font-size="24" font-weight="900">WORLD CUP 2026</text>
  <text x="72" y="246" fill="#d8ebe1" font-family="Aptos, Segoe UI, Arial, sans-serif" font-size="28" font-weight="800">Butterfly Effect Scenario</text>
  ${headline}
  <g transform="translate(810 92)">
    <rect width="280" height="220" rx="24" fill="#8e7cf6"/>
    <text x="34" y="58" fill="#ffffff" font-family="Aptos, Segoe UI, Arial, sans-serif" font-size="24" font-weight="900">CHAOS SCORE</text>
    <text x="34" y="158" fill="#ffffff" font-family="Aptos, Segoe UI, Arial, sans-serif" font-size="96" font-weight="900">${effect.chaosScore}</text>
    <text x="174" y="158" fill="#ffffff" fill-opacity="0.78" font-family="Aptos, Segoe UI, Arial, sans-serif" font-size="34" font-weight="900">/100</text>
  </g>
  ${shareMetric(72, 330, "Biggest lift", winner, "#dcefe4")}
  ${shareMetric(410, 330, "Biggest heartbreak", heartbreak, "#f0c9d8")}
  ${shareMetric(748, 330, "Favorite now", favorite, "#d8ebe1")}
  ${narrative}
  <text x="72" y="574" fill="#d8ebe1" fill-opacity="0.82" font-family="Aptos, Segoe UI, Arial, sans-serif" font-size="18" font-weight="800">Generated from ${prediction.settings.simulations.toLocaleString()} simulations</text>
</svg>`.trim();
}

function shareMetric(x: number, y: number, label: string, value: string, color: string) {
  const valueLines = splitSvgLines(value, 24)
    .slice(0, 2)
    .map(
      (line, index) =>
        `<text x="24" y="${74 + index * 28}" fill="${color}" font-family="Aptos, Segoe UI, Arial, sans-serif" font-size="24" font-weight="900">${escapeSvg(line)}</text>`
    )
    .join("");
  return `
  <g transform="translate(${x} ${y})">
    <rect width="300" height="118" rx="18" fill="#0c281d" stroke="#d8ebe1" stroke-opacity="0.16"/>
    <text x="24" y="40" fill="#d8ebe1" font-family="Aptos, Segoe UI, Arial, sans-serif" font-size="20" font-weight="900">${escapeSvg(label)}</text>
    ${valueLines}
  </g>`;
}

function svgTextBlock(text: string, x: number, y: number, size: number, lineHeight: number, maxChars: number, maxLines = 3) {
  return splitSvgLines(text, maxChars)
    .slice(0, maxLines)
    .map(
      (line, index) =>
        `<text x="${x}" y="${y + index * lineHeight}" fill="#ffffff" font-family="Aptos, Segoe UI, Arial, sans-serif" font-size="${size}" font-weight="900">${escapeSvg(line)}</text>`
    )
    .join("");
}

function splitSvgLines(text: string, maxChars: number) {
  const lines: string[] = [];
  let current = "";
  for (const word of text.split(" ")) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > maxChars && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function escapeSvg(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Could not render the share image."));
    image.src = src;
  });
}

async function copyPngToClipboard(blob: Blob) {
  const ClipboardItemClass = window.ClipboardItem;
  if (!ClipboardItemClass || !navigator.clipboard?.write) {
    return false;
  }

  try {
    await navigator.clipboard.write([new ClipboardItemClass({ "image/png": blob })]);
    return true;
  } catch {
    return false;
  }
}

function roundLabel(round: string) {
  const labels: Record<string, string> = {
    round_of_32: "R32",
    round_of_16: "R16",
    quarter_final: "QF",
    semi_final: "SF",
    final: "Final",
    champion: "Champion"
  };
  return labels[round] ?? round;
}

function ViewIntro({ title, detail, actions }: { title: string; detail: string; actions?: React.ReactNode }) {
  return (
    <section className="view-intro">
      <div className="view-intro-title">
        <p className="eyebrow">Scenario control</p>
        <h2>{title}</h2>
      </div>
      <div className="view-intro-actions">
        <p>{detail}</p>
        {actions}
      </div>
    </section>
  );
}

function StandingsTable({ rows, compact = false }: { rows: Array<Record<string, string | number>>; compact?: boolean }) {
  return (
    <div className="table-wrap">
      <table className={compact ? "compact-table" : ""}>
        <thead>
          <tr>
            <th>Team</th>
            <th>P</th>
            <th>W</th>
            <th>D</th>
            <th>L</th>
            <th>GD</th>
            <th>Pts</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={String(row.team)}>
              <td>
                <TeamName team={String(row.team)} compact />
              </td>
              <td>{row.played}</td>
              <td>{row.wins}</td>
              <td>{row.draws}</td>
              <td>{row.losses}</td>
              <td>{row.goal_difference}</td>
              <td>{row.points}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TeamName({
  team,
  align = "left",
  compact = false,
  matchLabel = false
}: {
  team: string;
  align?: "left" | "right";
  compact?: boolean;
  matchLabel?: boolean;
}) {
  const flagUrl = flagUrlFor(team);
  const placeholder = isPlaceholderTeam(team);
  const label = matchLabel && !placeholder ? teamCodeFor(team) : team;
  return (
    <span
      className={`team-name ${align === "right" ? "align-right" : ""} ${compact ? "compact-team" : ""} ${
        matchLabel ? "match-team" : ""
      }`}
      title={matchLabel ? team : undefined}
    >
      {flagUrl && <img className="flag" src={flagUrl} alt={flagLabelFor(team)} loading="lazy" />}
      <span className={placeholder ? "placeholder-team" : ""}>{label}</span>
    </span>
  );
}

function groupBy<T>(items: T[], getKey: (item: T) => string): Record<string, T[]> {
  return items.reduce<Record<string, T[]>>((acc, item) => {
    const key = getKey(item);
    acc[key] = acc[key] ?? [];
    acc[key].push(item);
    return acc;
  }, {});
}

function buildRatingContext(tournament: Tournament): RatingContext {
  const ratings = Object.fromEntries(tournament.teams.map((team) => [team.name, team.rating]));
  const knownRatings = Object.values(ratings);
  const averageRating = knownRatings.reduce((sum, rating) => sum + rating, 0) / knownRatings.length;
  const groupRatings = Object.fromEntries(
    Object.entries(tournament.groups).map(([group, teams]) => [
      group,
      teams.map((team) => ratings[team] ?? averageRating).sort((left, right) => right - left)
    ])
  );

  return { ratings, groupRatings, averageRating };
}

function createSimulatedFact(
  match: Match,
  ratingContext: RatingContext,
  profile: SimulatorProfile,
  displayTeams?: DisplayTeams,
  previousFact?: FactDraft
): FactDraft {
  const homeTeam = displayTeams?.homeTeam ?? match.home_team;
  const awayTeam = displayTeams?.awayTeam ?? match.away_team;
  const homeRating = resolveRating(homeTeam, ratingContext);
  const awayRating = resolveRating(awayTeam, ratingContext);

  for (let attempt = 0; attempt < 12; attempt += 1) {
    const fact = scoreToFact(match, sampleProjectedScore(homeRating, awayRating, profile), homeRating, awayRating, profile);
    if (!sameFactResult(fact, previousFact)) {
      return fact;
    }
  }

  return scoreToFact(match, fallbackDifferentScore(homeRating, awayRating, previousFact), homeRating, awayRating, profile);
}

function resolveRating(teamOrToken: string, context: RatingContext) {
  const directRating = context.ratings[teamOrToken];
  if (directRating !== undefined) {
    return directRating;
  }

  const rankedGroup = /^([123])([A-L])$/.exec(teamOrToken);
  if (rankedGroup) {
    const [, rankValue, group] = rankedGroup;
    return context.groupRatings[group]?.[Number(rankValue) - 1] ?? context.averageRating;
  }

  const thirdPlaceSlot = /^3([A-L](?:\/[A-L])*)$/.exec(teamOrToken);
  if (thirdPlaceSlot) {
    const groupRatings = thirdPlaceSlot[1]
      .split("/")
      .map((group) => context.groupRatings[group]?.[2])
      .filter((rating): rating is number => rating !== undefined);
    return average(groupRatings, context.averageRating);
  }

  return context.averageRating;
}

function sampleProjectedScore(homeRating: number, awayRating: number, profile: SimulatorProfile): [number, number] {
  const [homeExpected, awayExpected] = expectedGoals(homeRating, awayRating, profile);
  return [samplePoisson(homeExpected), samplePoisson(awayExpected)];
}

function expectedGoals(homeRating: number, awayRating: number, profile: SimulatorProfile): [number, number] {
  const surprise = clamp(profile.surprise, 0, 100) / 100;
  const diff = homeRating - awayRating;
  const ratingWeight = 1 - surprise * 0.58;
  const diffFactor = clamp((diff / 400) * ratingWeight, -1.15, 1.15);
  const tempo = 1 + surprise * 0.18;
  const underdogLift = surprise * 0.24;
  const homeExpected = clamp((1.24 + diffFactor * 0.82 + (diff < 0 ? underdogLift : 0)) * tempo, 0.28, 3.65);
  const awayExpected = clamp((1.24 - diffFactor * 0.82 + (diff > 0 ? underdogLift : 0)) * tempo, 0.28, 3.65);
  return [homeExpected, awayExpected];
}

function fallbackDifferentScore(homeRating: number, awayRating: number, previousFact?: FactDraft): [number, number] {
  if (previousFact?.home_score === undefined || previousFact.away_score === undefined) {
    return homeRating >= awayRating ? [2, 1] : [1, 2];
  }
  if (homeRating >= awayRating) {
    if (previousFact.home_score >= 7 && previousFact.away_score >= 7) {
      return [7, 6];
    }
    return previousFact.home_score < 7
      ? [previousFact.home_score + 1, previousFact.away_score]
      : [previousFact.home_score, clampInteger(previousFact.away_score + 1, 0, 7)];
  }
  if (previousFact.home_score >= 7 && previousFact.away_score >= 7) {
    return [6, 7];
  }
  return previousFact.away_score < 7
    ? [previousFact.home_score, previousFact.away_score + 1]
    : [clampInteger(previousFact.home_score + 1, 0, 7), previousFact.away_score];
}

function scoreToFact(
  match: Match,
  [home_score, away_score]: [number, number],
  homeRating: number,
  awayRating: number,
  profile: SimulatorProfile
): FactDraft {
  const knockout_winner =
    match.is_knockout && home_score === away_score ? projectedWinner(homeRating, awayRating, profile) : undefined;

  return {
    match_id: match.match_id,
    home_score,
    away_score,
    knockout_winner,
    source: "manual"
  };
}

function projectedWinner(homeRating: number, awayRating: number, profile: SimulatorProfile): "home" | "away" {
  const surprise = clamp(profile.surprise, 0, 100) / 100;
  const favoriteProbability = 1 / (1 + 10 ** ((awayRating - homeRating) / 400));
  const homeProbability = 0.5 + (favoriteProbability - 0.5) * (1 - surprise * 0.55);
  return Math.random() < homeProbability ? "home" : "away";
}

function samplePoisson(lambda: number) {
  const limit = Math.exp(-lambda);
  let product = 1;
  let goals = 0;
  do {
    goals += 1;
    product *= Math.random();
  } while (product > limit && goals < 8);
  return goals - 1;
}

function sameFactResult(nextFact: FactDraft, previousFact?: FactDraft) {
  if (!previousFact) {
    return false;
  }
  return (
    previousFact.home_score === nextFact.home_score &&
    previousFact.away_score === nextFact.away_score &&
    previousFact.knockout_winner === nextFact.knockout_winner
  );
}

function average(values: number[], fallback: number) {
  return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : fallback;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function clampInteger(value: number, min: number, max: number) {
  return Math.round(clamp(value, min, max));
}

function bracketBoardStyle(rowHeight: number, bracketHeight: number): React.CSSProperties {
  return {
    gridTemplateColumns: `repeat(${BRACKET_ROUNDS.length}, ${BRACKET_CARD_WIDTH}px)`,
    gridTemplateRows: `repeat(${BRACKET_ROWS}, ${rowHeight}px)`,
    columnGap: BRACKET_COLUMN_GAP,
    minWidth: BRACKET_WIDTH,
    minHeight: bracketHeight
  };
}

function hasRoundOf32Penalties(matches: Match[], facts: Record<number, FactDraft>) {
  return matches.some((match) => {
    const fact = facts[match.match_id];
    return (
      match.round === "Round of 32" &&
      fact?.home_score !== undefined &&
      fact.away_score !== undefined &&
      fact.home_score === fact.away_score
    );
  });
}

function buildBracketConnectors(layout: Record<number, BracketPosition>, rowHeight: number) {
  return Object.values(layout).flatMap((position) =>
    position.childMatchIds.map((childMatchId) => {
      const child = layout[childMatchId];
      if (!child) return "";
      const startX = bracketX(child.column, "right");
      const startY = bracketY(child.slot, rowHeight);
      const endX = bracketX(position.column, "left");
      const endY = bracketY(position.slot, rowHeight);
      const midX = startX + (endX - startX) / 2;
      return `M ${startX} ${startY} H ${midX} V ${endY} H ${endX}`;
    })
  ).filter(Boolean);
}

function bracketX(column: number, edge: "left" | "right") {
  const left = (column - 1) * (BRACKET_CARD_WIDTH + BRACKET_COLUMN_GAP);
  return edge === "left" ? left : left + BRACKET_CARD_WIDTH;
}

function bracketY(slot: number, rowHeight: number) {
  return slot * rowHeight;
}

function tabFromSearch(search: string): Tab | null {
  const view = new URLSearchParams(search).get("view");
  return view === "groups" || view === "knockout" || view === "predictions" ? view : null;
}

function formatPercent(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}

function formatSpainKickoff(match: Match) {
  if (!match.spain_time) {
    return match.time;
  }
  const date = match.spain_date ?? match.date;
  return `${formatShortDate(date)} - ${match.spain_time}`;
}

function formatShortDate(value: string) {
  const [, month, day] = value.split("-");
  return `${day}/${month}`;
}

function matchOptionLabel(team: string) {
  return isPlaceholderTeam(team) ? team : teamCodeFor(team);
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
