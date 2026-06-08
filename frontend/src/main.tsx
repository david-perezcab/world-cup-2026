import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { buildButterflyEffect, formatSignedPercentPoints, type ButterflyEffect } from "./lib/butterfly";
import { bracketLayout, buildKnockoutDisplayTeams, type BracketPosition, type DisplayTeams } from "./lib/bracket";
import { displayTeamNameFor, flagLabelFor, flagUrlFor, isPlaceholderTeam, teamCodeFor } from "./lib/flags";
import { completeFacts, encodeScenario, scenarioFromHash } from "./lib/scenario";
import { computeStandings } from "./lib/standings";
import type {
  BaselinePrediction,
  FactDraft,
  Match,
  Prediction,
  SquadTeam,
  SquadsPayload,
  TeamStoriesPayload,
  TeamStory,
  Tournament
} from "./types";
import "./styles.css";

type Tab = "groups" | "knockout" | "predictions" | "squads";
type RatingContext = {
  ratings: Record<string, number>;
  groupRatings: Record<string, number[]>;
  averageRating: number;
};
type SimulatorProfile = {
  surprise: number;
};

const NAV_ITEMS: Array<{ tab: Tab; label: string }> = [
  { tab: "squads", label: "Selecciones" },
  { tab: "groups", label: "Grupos" },
  { tab: "knockout", label: "Eliminatorias" },
  { tab: "predictions", label: "Predicciones" }
];

const TAB_TITLES: Record<Tab, string> = {
  groups: "Fase de grupos",
  knockout: "",
  predictions: "Panel de predicciones",
  squads: "Selecciones"
};

const BRACKET_ROUNDS = [
  "Round of 32",
  "Round of 16",
  "Quarter-final",
  "Semi-final",
  "Final",
  "Semi-final",
  "Quarter-final",
  "Round of 16",
  "Round of 32"
];
const WORLD_CUP_26_LOGO = "/weare26.png";
const BRACKET_DEFAULT_CARD_WIDTH = 105;
const BRACKET_COLUMN_GAP = 5;
const BRACKET_ROW_HEIGHT = 35;
const BRACKET_ROWS = 17;
const BRACKET_CARD_ROW_SPAN = 2;
const BRACKET_MIN_CARD_WIDTH = 58;

function App() {
  const [tournament, setTournament] = useState<Tournament | null>(null);
  const [facts, setFacts] = useState<Record<number, FactDraft>>({});
  const [activeTab, setActiveTab] = useState<Tab>(() => tabFromSearch(window.location.search) ?? "squads");
  const [prediction, setPrediction] = useState<Prediction | null>(null);
  const [baseline, setBaseline] = useState<BaselinePrediction | null>(null);
  const [baselineError, setBaselineError] = useState<string | null>(null);
  const [squads, setSquads] = useState<SquadsPayload | null>(null);
  const [squadsError, setSquadsError] = useState<string | null>(null);
  const [teamStories, setTeamStories] = useState<TeamStoriesPayload | null>(null);
  const [teamStoriesError, setTeamStoriesError] = useState<string | null>(null);
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
          throw new Error("No se pudieron cargar los datos del torneo.");
        }
        return response.json();
      })
      .then(setTournament)
      .catch((err: Error) => setError(err.message));
  }, []);

  useEffect(() => {
    fetch("/api/squads")
      .then((response) => {
        if (!response.ok) {
          throw new Error("No se pudieron cargar las convocatorias.");
        }
        return response.json();
      })
      .then((payload: SquadsPayload) => {
        setSquads(payload);
        setSquadsError(null);
      })
      .catch((err: Error) => setSquadsError(err.message));
  }, []);

  useEffect(() => {
    fetch("/api/team-stories")
      .then((response) => {
        if (!response.ok) {
          throw new Error("No se pudieron cargar las historias.");
        }
        return response.json();
      })
      .then((payload: TeamStoriesPayload) => {
        setTeamStories(payload);
        setTeamStoriesError(null);
      })
      .catch((err: Error) => setTeamStoriesError(err.message));
  }, []);

  useEffect(() => {
    let active = true;

    async function loadBaseline() {
      try {
        const response = await fetch("/api/baseline", { headers: { Accept: "application/json" } });
        const contentType = response.headers.get("content-type") ?? "";
        if (!response.ok || !contentType.includes("application/json")) {
          throw new Error("La base del Efecto Mariposa no está disponible. Reinicia FastAPI para activar /api/baseline.");
        }
        const payload = (await response.json()) as BaselinePrediction;
        if (active) {
          setBaseline(payload);
          setBaselineError(null);
        }
      } catch (err) {
        if (active) {
          setBaselineError(err instanceof Error ? err.message : "La base del Efecto Mariposa no está disponible.");
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
      const existing = current[match.match_id];
      const next = { ...current };
      if (knockoutWinnerSide(existing) === winner) {
        delete next[match.match_id];
        return next;
      }
      next[match.match_id] = {
        match_id: match.match_id,
        home_score: winner === "home" ? 1 : 0,
        away_score: winner === "away" ? 1 : 0,
        knockout_winner: winner,
        source: "manual"
      };
      return next;
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
    setShareStatus("Enlace copiado.");
  }

  function validateFacts(): string | null {
    if (!tournament) return "Los datos del torneo no están cargados.";
    for (const match of tournament.matches) {
      const fact = facts[match.match_id];
      if (!fact) continue;
      const hasHome = fact.home_score !== undefined;
      const hasAway = fact.away_score !== undefined;
      if (hasHome !== hasAway) {
        return `El partido ${match.match_id} tiene un marcador incompleto.`;
      }
      if (
        match.is_knockout &&
        fact.home_score !== undefined &&
        fact.away_score !== undefined &&
        fact.home_score === fact.away_score &&
        !fact.knockout_winner
      ) {
        return `El partido ${match.match_id} está empatado y necesita una selección clasificada.`;
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
        throw new Error(detail.detail ?? "No se pudo generar la predicción.");
      }
      const payload = (await response.json()) as Prediction;
      setPrediction(payload);
      setActiveTab("predictions");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo generar la predicción.");
    } finally {
      setLoading(false);
    }
  }

  if (!tournament) {
    return (
      <main className="loading-shell">
        <section className="loading-panel">{error ?? "Cargando datos del torneo..."}</section>
      </main>
    );
  }

  const knockoutMatches = tournament.matches.filter((match) => match.is_knockout);
  const activeTitle = TAB_TITLES[activeTab];

  return (
    <main className="app-frame">
      <Sidebar activeTab={activeTab} setActiveTab={setActiveTab} />

      <section className={`content-shell ${activeTab === "knockout" ? "knockout-content" : ""}`}>
        {activeTab !== "knockout" && (
          <header className="topbar">
            <div>
              <p className="eyebrow">Mundial FIFA 2026</p>
              {activeTitle && <h1>{activeTitle}</h1>}
            </div>
          </header>
        )}

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
            updateKnockoutWinner={updateKnockoutWinner}
          />
        )}

        {activeTab === "predictions" && (
          <PredictionsView
            prediction={prediction}
            tournament={tournament}
            baseline={baseline}
            baselineError={baselineError}
            simulations={simulations}
            setSimulations={setSimulations}
            loading={loading}
            runPrediction={runPrediction}
            copyShareLink={copyShareLink}
            clearScenario={clearScenario}
            shareStatus={shareStatus}
          />
        )}

        {activeTab === "squads" && (
          <SquadsView squads={squads} error={squadsError} teamStories={teamStories} storiesError={teamStoriesError} />
        )}
        </section>
    </main>
  );
}

function Sidebar({
  activeTab,
  setActiveTab
}: {
  activeTab: Tab;
  setActiveTab: (tab: Tab) => void;
}) {
  return (
    <aside className="side-menu">
      <div className="side-header">
        <div className="brand-mark">
          <img src={WORLD_CUP_26_LOGO} alt="Logo del Mundial FIFA 26" />
        </div>
      </div>

      <nav className="side-nav" aria-label="Vistas de predicción">
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
    </aside>
  );
}

function SquadsView({
  squads,
  error,
  teamStories,
  storiesError
}: {
  squads: SquadsPayload | null;
  error: string | null;
  teamStories: TeamStoriesPayload | null;
  storiesError: string | null;
}) {
  const [selectedTeam, setSelectedTeam] = useState("");
  const [positionFilter, setPositionFilter] = useState<"ALL" | SquadTeam["players"][number]["position"]>("ALL");

  if (error) {
    return <section className="error-panel">{error}</section>;
  }

  if (!squads) {
    return <section className="loading-panel">Cargando convocatorias oficiales...</section>;
  }

  const teams = squads.teams;
  const currentTeam = selectedTeam ? teams.find((team) => team.team === selectedTeam) ?? null : null;
  const currentStory = currentTeam ? teamStories?.stories.find((story) => story.code === currentTeam.code) ?? null : null;
  const players = currentTeam
    ? sortSquadPlayersByPositionAndNumber(
        positionFilter === "ALL"
          ? currentTeam.players
          : currentTeam.players.filter((player) => player.position === positionFilter)
      )
    : [];
  const positionCounts = currentTeam ? countPositions(currentTeam.players) : { GK: 0, DF: 0, MF: 0, FW: 0 };

  function selectTeam(team: string) {
    setSelectedTeam(team);
    setPositionFilter("ALL");
  }

  return (
    <section className="squads-layout">
      <article className="wide-panel squad-control-panel">
        <div className="squad-control-main">
          <label>
            Selección
            <select value={currentTeam?.team ?? ""} onChange={(event) => selectTeam(event.target.value)}>
              <option value="">Elige una selección</option>
              {teams.map((team) => (
                <option key={team.team} value={team.team}>
                  {displayTeamNameFor(team.team)} ({team.code})
                </option>
              ))}
            </select>
          </label>
          {currentTeam && (
            <label>
              Posición
              <select value={positionFilter} onChange={(event) => setPositionFilter(event.target.value as typeof positionFilter)}>
                <option value="ALL">Todas</option>
                <option value="GK">Porteros</option>
                <option value="DF">Defensas</option>
                <option value="MF">Centrocampistas</option>
                <option value="FW">Delanteros</option>
              </select>
            </label>
          )}
        </div>
        <a href={squads.source.url} target="_blank" rel="noreferrer">
          PDF oficial FIFA
        </a>
      </article>

      {!currentTeam && <SquadsIntro teams={teams} onSelectTeam={selectTeam} />}

      {currentTeam && (
        <>
      <article className="wide-panel squad-hero-panel">
        <div>
          <p className="panel-kicker">Grupo {currentTeam.group ?? "-"}</p>
          <h2>
            <TeamName team={currentTeam.team} />
          </h2>
          <p>
            Convocatoria oficial publicada por FIFA. Datos de club, dorsal, posición, fecha de nacimiento y altura extraídos del PDF oficial.
          </p>
        </div>
        <div className="squad-coach-card">
          <span>Seleccionador</span>
          <strong>{currentTeam.coach?.name ?? "No disponible"}</strong>
          {currentTeam.coach?.nationality && <small>{currentTeam.coach.nationality}</small>}
        </div>
      </article>

      {currentStory ? (
        <TeamStoryPanel story={currentStory} />
      ) : (
        storiesError && <section className="story-note">{storiesError}</section>
      )}

      <div className="squad-summary-grid">
        <SquadSummaryCard
          label="Porteros"
          value={String(positionCounts.GK)}
          active={positionFilter === "GK"}
          onClick={() => setPositionFilter(positionFilter === "GK" ? "ALL" : "GK")}
        />
        <SquadSummaryCard
          label="Defensas"
          value={String(positionCounts.DF)}
          active={positionFilter === "DF"}
          onClick={() => setPositionFilter(positionFilter === "DF" ? "ALL" : "DF")}
        />
        <SquadSummaryCard
          label="Medios"
          value={String(positionCounts.MF)}
          active={positionFilter === "MF"}
          onClick={() => setPositionFilter(positionFilter === "MF" ? "ALL" : "MF")}
        />
        <SquadSummaryCard
          label="Delanteros"
          value={String(positionCounts.FW)}
          active={positionFilter === "FW"}
          onClick={() => setPositionFilter(positionFilter === "FW" ? "ALL" : "FW")}
        />
      </div>

      <article className="wide-panel squad-list-panel">
        <header className="panel-header">
          <div>
            <p className="panel-kicker">Plantilla oficial</p>
            <h2>{positionFilter === "ALL" ? "Plantilla por posición" : positionPluralLabel(positionFilter)}</h2>
          </div>
        </header>
        <div className="squad-player-grid">
          {players.map((player) => (
            <article className="squad-player-card" key={`${currentTeam.team}-${player.number}`}>
              <div className="squad-player-number">{player.number}</div>
              <div className="squad-player-main">
                <div className="squad-player-title">
                  <span>{positionLabel(player.position)}</span>
                  <strong>{displayPlayerName(player)}</strong>
                </div>
                <div className="squad-player-details">
                  <span>{player.club}</span>
                  <span>{player.height_cm} cm</span>
                  <span>{ageAtTournament(player.date_of_birth)} años</span>
                  <span>Camiseta: {player.shirt_name}</span>
                </div>
              </div>
            </article>
          ))}
        </div>
      </article>
        </>
      )}
    </section>
  );
}

function SquadsIntro({ teams, onSelectTeam }: { teams: SquadTeam[]; onSelectTeam: (team: string) => void }) {
  const quickTeams = ["MEX", "CAN", "USA", "ESP", "CUW", "CPV"]
    .map((code) => teams.find((team) => team.code === code))
    .filter((team): team is SquadTeam => Boolean(team));

  return (
    <section className="squads-intro">
      <article className="wide-panel squads-intro-hero">
        <div className="squads-intro-copy">
          <p className="panel-kicker">Mundial FIFA 2026</p>
          <h2>El Mundial más grande empieza aquí</h2>
          <p>
            Tres países anfitriones, 48 selecciones y un formato nuevo que convierte cada grupo en una historia abierta.
            Explora convocatorias oficiales, relatos curiosos y los caminos que pueden cambiar todo el torneo.
          </p>
        </div>
        <div className="squads-intro-logo" aria-label="Logo oficial We Are 26">
          <img src={WORLD_CUP_26_LOGO} alt="Logo oficial We Are 26" />
        </div>
      </article>

      <div className="world-cup-fact-grid">
        <WorldCupFactCard value="48" label="selecciones" detail="El primer Mundial con este tamaño." />
        <WorldCupFactCard value="104" label="partidos" detail="72 de grupos y 32 de eliminatorias." />
        <WorldCupFactCard value="16" label="ciudades sede" detail="Repartidas entre Canadá, México y Estados Unidos." />
        <WorldCupFactCard value="12" label="grupos" detail="Los dos primeros y ocho terceros pasan a dieciseisavos." />
      </div>

      <article className="wide-panel world-cup-format-panel">
        <div>
          <p className="panel-kicker">11 junio - 19 julio</p>
          <h2>Un torneo pensado para que haya más caminos raros</h2>
          <p>
            La fase de grupos ya no es solo quedar primero o segundo: los terceros entran en juego y abren cruces inesperados.
            Por eso esta app mezcla convocatoria, historias y simulación: cada detalle puede cambiar el cuadro.
          </p>
        </div>
        <div className="host-country-grid">
          <span>Anfitriones</span>
          <button type="button" onClick={() => onSelectTeam("Mexico")}>
            <TeamName team="Mexico" />
          </button>
          <button type="button" onClick={() => onSelectTeam("Canada")}>
            <TeamName team="Canada" />
          </button>
          <button type="button" onClick={() => onSelectTeam("USA")}>
            <TeamName team="USA" />
          </button>
        </div>
      </article>

      <article className="wide-panel intro-explore-panel">
        <header className="panel-header">
          <div>
            <p className="panel-kicker">Empieza explorando</p>
            <h2>Selecciona un país</h2>
          </div>
        </header>
        <div className="intro-team-grid">
          {quickTeams.map((team) => (
            <button type="button" key={team.code} onClick={() => onSelectTeam(team.team)}>
              <TeamName team={team.team} />
              <span>Grupo {team.group ?? "-"}</span>
            </button>
          ))}
        </div>
      </article>
    </section>
  );
}

function WorldCupFactCard({ value, label, detail }: { value: string; label: string; detail: string }) {
  return (
    <article className="world-cup-fact-card">
      <strong>{value}</strong>
      <span>{label}</span>
      <p>{detail}</p>
    </article>
  );
}

function SquadSummaryCard({
  label,
  value,
  active,
  onClick
}: {
  label: string;
  value: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button className={`squad-summary-card ${active ? "active" : ""}`} type="button" onClick={onClick}>
      <span>{label}</span>
      <strong>{value}</strong>
    </button>
  );
}

function TeamStoryPanel({ story }: { story: TeamStory }) {
  return (
    <article className="wide-panel team-story-panel">
      <div className="team-story-copy">
        <p className="panel-kicker">¿Sabías que...?</p>
        <h2>{story.title}</h2>
        {story.paragraphs.map((paragraph) => (
          <p key={paragraph}>{paragraph}</p>
        ))}
      </div>
      <div className="team-story-sources">
        <span>Fuentes</span>
        {story.sources.map((source) => (
          <a href={source.url} target="_blank" rel="noreferrer" key={source.url}>
            {source.label}
          </a>
        ))}
      </div>
    </article>
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
      <section className="scenario-toolbar" aria-label="Controles de simulación de grupos">
        <label className="surprise-slider">
          <span>Favoritos</span>
          <input
            aria-label="Nivel de sorpresa del simulador de partidos"
            type="range"
            min={0}
            max={100}
            value={simulatorSurprise}
            onChange={(event) => setSimulatorSurprise(Number(event.target.value))}
          />
          <span>Sorpresas</span>
        </label>
        <button className="simulate-button intro-action" type="button" onClick={simulateAllGroups}>
          <span aria-hidden="true">{"\u{26BD}"}</span>
          Todos los grupos
        </button>
      </section>
      <div className="groups-grid">
        {Object.entries(groups).map(([group, teams]) => {
          const matches = groupMatches[group] ?? [];
          const standings = computeStandings(teams, matches, facts);
          return (
            <article className="group-panel" key={group}>
              <header className="panel-header">
                <div>
                  <p className="panel-kicker">Grupo</p>
                  <h2>{group}</h2>
                </div>
                <div className="panel-actions">
                  <span>
                    {matches.length} partido{matches.length === 1 ? "" : "s"}
                  </span>
                  <button className="simulate-button group-sim-button" type="button" onClick={() => simulateGroup(matches)}>
                    <span aria-hidden="true">{"\u{26BD}"}</span>
                    Grupo
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
  updateKnockoutWinner
}: {
  matches: Match[];
  displayTeams: Record<number, DisplayTeams>;
  layout: Record<number, BracketPosition>;
  facts: Record<number, FactDraft>;
  updateKnockoutWinner: (match: Match, winner: "home" | "away") => void;
}) {
  const rounds = groupBy(matches, (match) => match.round);
  const thirdPlaceMatches = rounds["Match for third place"] ?? [];
  const thirdPlaceMatch = thirdPlaceMatches[0];
  const bracketMatches = matches.filter((match) => match.round !== "Match for third place");
  const [shellElement, bracketMetrics] = useBracketMetrics();
  const { cardWidth, rowHeight } = bracketMetrics;
  const bracketWidth = BRACKET_ROUNDS.length * cardWidth + (BRACKET_ROUNDS.length - 1) * BRACKET_COLUMN_GAP;
  const bracketHeight = BRACKET_ROWS * rowHeight;
  const connectors = buildBracketConnectors(layout, rowHeight, cardWidth);
  const headerStyle = bracketGridStyle(cardWidth, bracketWidth);

  return (
    <section className="view-stack">
      <div className="bracket-shell" ref={shellElement}>
        <div className="bracket-headers" style={headerStyle}>
          {BRACKET_ROUNDS.map((round, index) => (
            <h2 key={`${round}-${index}`}>{roundTitleFor(round)}</h2>
          ))}
        </div>
        <div className="bracket-board" style={bracketBoardStyle(cardWidth, rowHeight, bracketWidth, bracketHeight)}>
          <svg
            className="bracket-lines"
            width={bracketWidth}
            height={bracketHeight}
            viewBox={`0 0 ${bracketWidth} ${bracketHeight}`}
            aria-hidden="true"
          >
            {connectors.map((path, index) => (
              <path className="bracket-line" d={path} key={`${path}-${index}`} />
            ))}
          </svg>
          {bracketMatches.map((match) => {
            const position = layout[match.match_id] ?? {
              round: match.round,
              column: 1,
              slot: 1,
              childMatchIds: [],
              side: "left" as const
            };
            return (
              <div
                className={`bracket-card ${match.round === "Final" ? "final-card" : ""}`}
                key={match.match_id}
                style={{ gridColumn: position.column, gridRow: `${position.slot} / span ${BRACKET_CARD_ROW_SPAN}` }}
              >
                {match.round === "Final" ? (
                  <div className="final-stack">
                    <div className="final-block">
                      <h3>FINAL</h3>
                      <KnockoutMatchCard
                        match={match}
                        displayTeams={displayTeams[match.match_id]}
                        fact={facts[match.match_id]}
                        updateKnockoutWinner={updateKnockoutWinner}
                      />
                    </div>
                    {thirdPlaceMatch && (
                      <div className="final-block third-place-block">
                        <h3>3º PUESTO</h3>
                        <KnockoutMatchCard
                          match={thirdPlaceMatch}
                          displayTeams={displayTeams[thirdPlaceMatch.match_id]}
                          fact={facts[thirdPlaceMatch.match_id]}
                          updateKnockoutWinner={updateKnockoutWinner}
                        />
                      </div>
                    )}
                  </div>
                ) : (
                  <KnockoutMatchCard
                    match={match}
                    displayTeams={displayTeams[match.match_id]}
                    fact={facts[match.match_id]}
                    updateKnockoutWinner={updateKnockoutWinner}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function KnockoutMatchCard({
  match,
  displayTeams,
  fact,
  updateKnockoutWinner
}: {
  match: Match;
  displayTeams?: DisplayTeams;
  fact?: FactDraft;
  updateKnockoutWinner: (match: Match, winner: "home" | "away") => void;
}) {
  const homeTeam = displayTeams?.homeTeam ?? match.home_team;
  const awayTeam = displayTeams?.awayTeam ?? match.away_team;
  const selectedWinner = knockoutWinnerSide(fact);

  return (
    <div className={`knockout-match winner-pick-card ${selectedWinner ? "has-winner" : ""}`}>
      <div className="winner-pick-stack">
        <WinnerPickButton
          match={match}
          side="home"
          team={homeTeam}
          selectedWinner={selectedWinner}
          updateKnockoutWinner={updateKnockoutWinner}
        />
        <WinnerPickButton
          match={match}
          side="away"
          team={awayTeam}
          selectedWinner={selectedWinner}
          updateKnockoutWinner={updateKnockoutWinner}
        />
      </div>
    </div>
  );
}

function WinnerPickButton({
  match,
  side,
  team,
  selectedWinner,
  updateKnockoutWinner
}: {
  match: Match;
  side: "home" | "away";
  team: string;
  selectedWinner: "home" | "away" | null;
  updateKnockoutWinner: (match: Match, winner: "home" | "away") => void;
}) {
  const selected = selectedWinner === side;
  const faded = selectedWinner !== null && !selected;
  const displayName = displayTeamNameFor(team);
  return (
    <button
      className={`winner-pick-button ${selected ? "selected" : ""} ${faded ? "faded" : ""}`}
      type="button"
      aria-pressed={selected}
      aria-label={selected ? `Borrar ganador ${displayName}` : `Elegir ganador ${displayName}`}
      title={selected ? "Volver a pinchar para borrar" : "Elegir ganador"}
      onClick={() => updateKnockoutWinner(match, side)}
    >
      <TeamName team={team} matchLabel />
    </button>
  );
}

function MatchEditor({
  match,
  fact,
  updateScore,
  resetMatch,
  simulateMatch
}: {
  match: Match;
  fact?: FactDraft;
  updateScore: (match: Match, side: "home_score" | "away_score", value: string) => void;
  resetMatch: (matchId: number) => void;
  simulateMatch: (match: Match, displayTeams?: DisplayTeams) => void;
}) {
  const homeTeam = match.home_team;
  const awayTeam = match.away_team;

  return (
    <div className="match-editor">
      <div className="match-actions">
        <button
          className="simulate-button match-sim-button"
          type="button"
          title="Simular partido"
          aria-label={`Simular partido ${match.match_id}`}
          onClick={() => simulateMatch(match)}
        >
          {"\u{26BD}"}
        </button>
        <button className="ghost-button clear-match-button" title="Borrar partido" aria-label="Borrar partido" onClick={() => resetMatch(match.match_id)}>
          ×
        </button>
      </div>
      <div className="match-meta">
        <span>{formatSpainKickoff(match)}</span>
      </div>
      <div className="score-row">
        <TeamName team={homeTeam} matchLabel />
        <input
          aria-label={`Marcador de ${displayTeamNameFor(homeTeam)}`}
          type="number"
          min={0}
          max={30}
          value={fact?.home_score ?? ""}
          onChange={(event) => updateScore(match, "home_score", event.target.value)}
        />
        <span className="score-separator">-</span>
        <input
          aria-label={`Marcador de ${displayTeamNameFor(awayTeam)}`}
          type="number"
          min={0}
          max={30}
          value={fact?.away_score ?? ""}
          onChange={(event) => updateScore(match, "away_score", event.target.value)}
        />
        <TeamName team={awayTeam} align="right" matchLabel />
      </div>
    </div>
  );
}

function PredictionsView({
  prediction,
  tournament,
  baseline,
  baselineError,
  simulations,
  setSimulations,
  loading,
  runPrediction,
  copyShareLink,
  clearScenario,
  shareStatus
}: {
  prediction: Prediction | null;
  tournament: Tournament;
  baseline: BaselinePrediction | null;
  baselineError: string | null;
  simulations: number;
  setSimulations: (value: number) => void;
  loading: boolean;
  runPrediction: () => void;
  copyShareLink: () => void;
  clearScenario: () => void;
  shareStatus: string | null;
}) {
  const controls = (
    <PredictionControls
      simulations={simulations}
      setSimulations={setSimulations}
      loading={loading}
      runPrediction={runPrediction}
      copyShareLink={copyShareLink}
      clearScenario={clearScenario}
      shareStatus={shareStatus}
    />
  );

  if (!prediction) {
    return (
      <section className="predictions-layout">
        {controls}
        <section className="empty-state">
          <h2>Aún no hay predicción</h2>
          <p>Fija los resultados reales que quieras tratar como hechos y calcula el escenario.</p>
        </section>
      </section>
    );
  }

  const effect =
    baseline && baseline.data_version === prediction.data_version ? buildButterflyEffect(prediction, baseline) : null;
  const baselineNote =
    baseline && baseline.data_version !== prediction.data_version
      ? "El Efecto Mariposa está oculto porque la base pertenece a otra versión de datos."
      : baselineError;

  return (
    <section className="predictions-layout">
      {controls}

      {effect ? (
        <ButterflyEffectPanel effect={effect} />
      ) : (
        baselineNote && <p className="butterfly-note">{baselineNote}</p>
      )}

      <article className="wide-panel champion-panel">
        <header className="panel-header">
          <div>
            <p className="panel-kicker">Ganador proyectado</p>
            <h2>Probabilidades de campeón</h2>
          </div>
        </header>
        <div className="probability-list">
          {prediction.champion_probabilities.slice(0, 8).map((row, index) => (
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

      <SpainPathPanel
        prediction={prediction}
        tournament={tournament}
        baseline={baseline && baseline.data_version === prediction.data_version ? baseline : null}
      />

      <article className="wide-panel">
        <h2>Clasificación de grupos</h2>
        <div className="group-prob-grid">
          {Object.entries(prediction.group_probabilities).map(([group, rows]) => (
            <div className="mini-table" key={group}>
              <h3>Grupo {group}</h3>
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

function PredictionControls({
  simulations,
  setSimulations,
  loading,
  runPrediction,
  copyShareLink,
  clearScenario,
  shareStatus
}: {
  simulations: number;
  setSimulations: (value: number) => void;
  loading: boolean;
  runPrediction: () => void;
  copyShareLink: () => void;
  clearScenario: () => void;
  shareStatus: string | null;
}) {
  return (
    <article className="prediction-controls wide-panel">
      <label>
        Simulaciones
        <input
          type="number"
          min={100}
          max={100000}
          step={100}
          value={simulations}
          onChange={(event) => setSimulations(Number(event.target.value))}
        />
      </label>
      <div className="prediction-actions">
        <button className="primary" onClick={runPrediction} disabled={loading}>
          {loading ? "Calculando..." : "Calcular"}
        </button>
        <button onClick={copyShareLink}>Copiar enlace</button>
        <button onClick={clearScenario}>Borrar cambios</button>
      </div>
      {shareStatus && <span className="status-note">{shareStatus}</span>}
    </article>
  );
}

function ButterflyEffectPanel({ effect }: { effect: ButterflyEffect }) {
  return (
    <article className="wide-panel butterfly-panel">
      <header className="butterfly-hero">
        <div>
          <p className="panel-kicker">Efecto Mariposa</p>
          <h2>{effect.headline}</h2>
          <p>{effect.narrative}</p>
        </div>
        <div className="effect-score" aria-label={`Índice de caos ${effect.chaosScore} de 100`}>
          <span>Índice de caos</span>
          <strong>
            <span className="chaos-value">{effect.chaosScore}</span>
            <span className="chaos-total">/100</span>
          </strong>
        </div>
      </header>

      <div className="effect-grid">
        <EffectSummaryCard
          label="Ojito con..."
          team={effect.biggestWinner?.team}
          value={effect.biggestWinner ? formatSignedPercentPoints(effect.biggestWinner.delta) : "Sin cambio"}
          tone="positive"
        />
        <EffectSummaryCard
          label="Mayor Pechofriada"
          team={effect.biggestLoser?.team}
          value={effect.biggestLoser ? formatSignedPercentPoints(effect.biggestLoser.delta) : "Ninguna"}
          tone="negative"
        />
        <EffectSummaryCard
          label="Favorito ahora"
          team={effect.championFavorite?.team}
          value={effect.championFavorite ? formatPercent(effect.championFavorite.probability) : "Abierto"}
        />
        <EffectSummaryCard label="Punto clave" team={effect.pressurePoint} value="Cambio de camino" />
      </div>

      <div className="delta-layout">
        <DeltaList title="Ganadores" rows={effect.winners} tone="positive" />
        <DeltaList title="Golpes" rows={effect.losers} tone="negative" />
      </div>
    </article>
  );
}

function SpainPathPanel({
  prediction,
  tournament,
  baseline
}: {
  prediction: Prediction;
  tournament: Tournament;
  baseline: BaselinePrediction | null;
}) {
  const analysis = buildSpainPathAnalysis(prediction, tournament, baseline);

  if (!analysis) {
    return null;
  }

  return (
    <article className="wide-panel spain-path-panel">
      <header className="spain-path-header">
        <div>
          <p className="panel-kicker">Camino de España</p>
          <h2>{analysis.title}</h2>
          <p>{analysis.summary}</p>
        </div>
        <div className="spain-model-badge">
          <span>Modelo usado</span>
          <strong>{prediction.settings.simulations.toLocaleString("es-ES")}</strong>
          <small>Seed {prediction.settings.seed}</small>
        </div>
      </header>

      <div className="spain-kpi-grid">
        {analysis.kpis.map((item) => (
          <div className="spain-kpi" key={item.label}>
            <span>{item.label}</span>
            <strong>{item.value}</strong>
            {item.detail && <small>{item.detail}</small>}
          </div>
        ))}
      </div>

      <section className="spain-section-grid">
        <div className="spain-card">
          <h3>Grupo {analysis.group}</h3>
          <p>{analysis.groupRead}</p>
          <div className="spain-group-rows">
            {analysis.groupRows.map((row) => (
              <div className="spain-group-row" key={row.team}>
                <TeamName team={row.team} compact />
                <span>{formatPercent(row.winner)} 1º</span>
                <span>{formatPercent(row.runner_up)} 2º</span>
                <strong>{formatPercent(row.qualify)}</strong>
              </div>
            ))}
          </div>
        </div>

        <div className="spain-card">
          <h3>Calendario que decide la ruta</h3>
          <div className="spain-fixtures">
            {analysis.fixtures.map((match) => (
              <div className="spain-fixture" key={match.match_id}>
                <span>{formatSpainKickoff(match)}</span>
                <strong>
                  {displayTeamNameFor(match.home_team)} vs {displayTeamNameFor(match.away_team)}
                </strong>
              </div>
            ))}
          </div>
        </div>
      </section>

      <div className="spain-route-grid">
        {analysis.routes.map((route) => (
          <section className={`spain-route-card ${route.tone}`} key={route.title}>
            <div className="spain-route-title">
              <span>{route.label}</span>
              <strong>{route.probability}</strong>
            </div>
            <h3>{route.title}</h3>
            <p>{route.summary}</p>
            <ol>
              {route.steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          </section>
        ))}
      </div>

      <section className="spain-card spain-switchboard">
        <h3>Interruptores del cuadro</h3>
        <div className="spain-switch-grid">
          {analysis.switches.map((item) => (
            <div className="spain-switch" key={item.title}>
              <strong>{item.title}</strong>
              <p>{item.body}</p>
            </div>
          ))}
        </div>
      </section>
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
      <strong>{team && !team.startsWith("Grupo ") ? <TeamName team={team} compact /> : (team ?? "Sin cambio")}</strong>
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
        <p className="muted-text">Sin movimientos importantes.</p>
      )}
    </div>
  );
}

type GroupProbabilityRow = Prediction["group_probabilities"][string][number];

function buildSpainPathAnalysis(prediction: Prediction, tournament: Tournament, baseline: BaselinePrediction | null) {
  const spainGroup = findTeamGroup(tournament.groups, "Spain");
  if (!spainGroup) {
    return null;
  }

  const groupRows = prediction.group_probabilities[spainGroup] ?? [];
  const spainGroupRow = groupRows.find((row) => row.team === "Spain");
  const spainRoundRow = prediction.round_probabilities.find((row) => row.team === "Spain");
  if (!spainGroupRow || !spainRoundRow) {
    return null;
  }

  const baselineSpain = baseline?.round_probabilities.find((row) => row.team === "Spain");
  const championDelta = baselineSpain ? spainRoundRow.champion - baselineSpain.champion : null;
  const thirdProbability = probabilityAsThird(spainGroupRow);
  const fixtures = tournament.matches.filter(
    (match) => match.group === `Group ${spainGroup}` && [match.home_team, match.away_team].includes("Spain")
  );
  const title = spainGroupRow.winner >= 0.72 ? "La clave es ganar el grupo: cambia todo el cuadro" : "España tiene margen, pero el puesto en el grupo lo cambia todo";
  const summary =
    `España tiene ${formatPercent(spainRoundRow.champion)} de título en este escenario. ` +
    `La diferencia real está entre ir como 1${spainGroup} (${formatPercent(spainGroupRow.winner)}) o caer al 2${spainGroup} (${formatPercent(spainGroupRow.runner_up)}): ` +
    "la primera ruta evita al ganador del grupo J de salida; la segunda puede meter a Argentina en el primer cruce.";

  const routes = [
    {
      label: `1${spainGroup}`,
      probability: formatPercent(spainGroupRow.winner),
      tone: "best",
      title: "Ruta ideal: liderar el grupo H",
      summary:
        `Dieciseisavos serían contra ${slotSummary(prediction, "2J")}. ` +
        `Si ${slotTeamName(prediction, "1J")} gana el grupo J, España no se lo encuentra ni en dieciseisavos ni en octavos; solo podría aparecer mucho más tarde.`,
      steps: [
        `Dieciseisavos: M84 contra ${slotSummary(prediction, "2J")}. El partido de Argentina en el grupo J es clave: si Argentina acaba segunda, entra justo por este slot.`,
        `Octavos: M93 contra el ganador de M83 (${slotSummary(prediction, "2K")} vs ${slotSummary(prediction, "2L")}). España se beneficia si los favoritos de K y L ganan sus grupos, porque no aparecen como segundos.`,
        `Cuartos: M98 contra la rama M81/M82: ${slotSummary(prediction, "1D")} o ${slotSummary(prediction, "1G")} más terceros. Es una zona menos directa que la rama del 2H.`,
        `Semifinal: M101, rama izquierda. Aquí pueden crecer los ganadores de E, F e I; si ${slotTeamName(prediction, "1I")} cumple, es el rival grande que puede esperar al final de esta mitad.`
      ]
    },
    {
      label: `2${spainGroup}`,
      probability: formatPercent(spainGroupRow.runner_up),
      tone: "danger",
      title: "Ruta trampa: segunda de grupo",
      summary:
        `El primer cruce pasa a ser M86 contra ${slotSummary(prediction, "1J")}. ` +
        "Es el salto de dificultad más importante: ser segunda puede convertir un cuadro controlable en un inicio de eliminatoria durísimo.",
      steps: [
        `Dieciseisavos: M86 contra ${slotSummary(prediction, "1J")}. Si Argentina gana J, esta ruta obliga a España a medirse con ella inmediatamente.`,
        `Octavos: M95 contra W88 (${slotSummary(prediction, "2D")} vs ${slotSummary(prediction, "2G")}). Si ${slotTeamName(prediction, "1G")} gana G, España evita a ese rival por el slot 2G; si queda segundo, cae justo en esta puerta.`,
        `Cuartos: M100 contra la rama W96, donde mandan ${slotSummary(prediction, "1B")} y ${slotSummary(prediction, "1K")} más terceros. Es una rama con menos margen de error.`,
        "Semifinal: M102, lado derecho. La ruta se vuelve muy dependiente de que los favoritos de A, C, E, J, K y L no se acumulen por el mismo lado."
      ]
    },
    {
      label: `3${spainGroup}`,
      probability: formatPercent(thirdProbability),
      tone: "volatile",
      title: "Ruta supervivencia: entrar como tercera",
      summary:
        "Si España entra como tercera, deja de controlar el cuadro. El rival depende del reparto de terceros y puede caer en varias puertas muy distintas.",
      steps: [
        `Posibles entradas: M77 contra ${slotSummary(prediction, "1I")}, M79 contra ${slotSummary(prediction, "1A")}, M80 contra ${slotSummary(prediction, "1L")} o M82 contra ${slotSummary(prediction, "1G")}.`,
        `La peor lectura es M77 si ${slotTeamName(prediction, "1I")} gana I: España pasaría de favorita de grupo a un cruce directo contra una potencia.`,
        `La mejor noticia sería caer contra un 1A/1G menos dominante o que el reparto de terceros aleje a España de la rama de I. Aun así, es una ruta de mucho ruido.`,
        "Como tercera, el objetivo ya no es optimizar semifinales; es sobrevivir al primer cruce y esperar que el cuadro se abra por resultados ajenos."
      ]
    }
  ];

  return {
    group: spainGroup,
    title,
    summary,
    groupRows,
    groupRead: buildSpainGroupRead(groupRows, spainGroupRow),
    fixtures,
    kpis: [
      { label: "Clasificar", value: formatPercent(spainRoundRow.round_of_32), detail: `Grupo ${spainGroup}` },
      { label: "Ganar grupo", value: formatPercent(spainGroupRow.winner), detail: "ruta limpia" },
      { label: "Segunda", value: formatPercent(spainGroupRow.runner_up), detail: "ruta peligrosa" },
      { label: "Tercera", value: formatPercent(thirdProbability), detail: "reparto abierto" },
      { label: "Final", value: formatPercent(spainRoundRow.final), detail: "prob. actual" },
      {
        label: "Campeona",
        value: formatPercent(spainRoundRow.champion),
        detail: championDelta === null ? "sin base" : `${formatSignedPercentPoints(championDelta)} vs base`
      }
    ],
    routes,
    switches: buildSpainSwitches(prediction, spainGroupRow, thirdProbability)
  };
}

function buildSpainGroupRead(groupRows: GroupProbabilityRow[], spain: GroupProbabilityRow) {
  const mainThreat = groupRows
    .filter((row) => row.team !== "Spain")
    .sort((left, right) => right.winner - left.winner)[0];
  const thirdProbability = probabilityAsThird(spain);
  const threatText = mainThreat
    ? `${displayTeamNameFor(mainThreat.team)} es quien más amenaza el primer puesto (${formatPercent(mainThreat.winner)}).`
    : "Ningún rival aparece como amenaza clara al primer puesto.";
  return `${threatText} Para España, la frontera crítica no es solo clasificarse: es evitar el 2H. Como tercera aparece en ${formatPercent(thirdProbability)}, una ruta demasiado dependiente de terceros.`;
}

function buildSpainSwitches(prediction: Prediction, spainGroupRow: GroupProbabilityRow, thirdProbability: number) {
  return [
    {
      title: "Uruguay aprieta el grupo H",
      body:
        `Si Uruguay le quita el primer puesto a España, el camino cambia de 1H a 2H. ` +
        `Eso mueve el primer cruce de ${slotSummary(prediction, "2J")} a ${slotSummary(prediction, "1J")}, que es el mayor salto de dificultad del cuadro español.`
    },
    {
      title: `${slotTeamName(prediction, "1J")} gana el grupo J`,
      body:
        `Beneficia muchísimo a España si acaba 1H: ese rival queda lejos de dieciseisavos y octavos. ` +
        `Pero castiga a España si acaba 2H, porque lo tendría en M86 como primer partido eliminatorio.`
    },
    {
      title: `${slotTeamName(prediction, "1K")} gana el grupo K`,
      body:
        `Ayuda a la ruta 1H porque ese equipo no entra como 2K en el M83. ` +
        `El rival de octavos para España pasaría a depender más de ${slotSummary(prediction, "2K")} y del segundo del grupo L.`
    },
    {
      title: `${slotTeamName(prediction, "1L")} gana el grupo L`,
      body:
        `También ayuda a la ruta 1H: evita que el favorito de L aparezca como 2L en el M83. ` +
        `Si cae al segundo puesto, España primera podría verlo ya en octavos.`
    },
    {
      title: `${slotTeamName(prediction, "1I")} domina el grupo I`,
      body:
        `Para España 1H no es un problema inmediato: quedaría como amenaza de semifinal. ` +
        `Para España 3H sí puede ser dramático, porque uno de los repartos posibles la manda al M77 contra 1I.`
    },
    {
      title: `${slotTeamName(prediction, "1G")} gana el grupo G`,
      body:
        `Mejora especialmente la ruta 2H, porque evita que ese rival entre como 2G en el M88. ` +
        `Si falla y queda segundo, el hipotético octavo de España como segunda se endurece mucho.`
    },
    {
      title: `España cae a tercera (${formatPercent(thirdProbability)})`,
      body:
        `No es solo peor por probabilidad; es peor por control. ` +
        `Puede caer contra 1I, 1A, 1L o 1G, así que deja de elegir rama y pasa a depender del reparto global de terceros.`
    },
    {
      title: `España gana H (${formatPercent(spainGroupRow.winner)})`,
      body:
        "Es el interruptor bueno: evita el cruce directo con 1J, apunta al M84 y coloca la primera gran amenaza en octavos o cuartos, no en el primer día de eliminatorias."
    }
  ];
}

function slotSummary(prediction: Prediction, token: string) {
  if (/^[12][A-L]$/.test(token)) {
    const candidate = likelySlotCandidate(prediction, token);
    return candidate ? `${displayTeamNameFor(candidate.team)} (${formatPercent(candidate.probability)})` : token;
  }
  if (/^3[A-L/]+$/.test(token)) {
    const candidates = token.slice(1).split("/");
    const likelyThird = likelyThirdCandidate(prediction, candidates);
    return likelyThird
      ? `${displayTeamNameFor(likelyThird.team)} (${formatPercent(likelyThird.probability)} como 3º) entre terceros de ${candidates.join("/")}`
      : `un tercero de ${candidates.join("/")}`;
  }
  return token;
}

function slotTeamName(prediction: Prediction, token: string) {
  return displayTeamNameFor(likelySlotCandidate(prediction, token)?.team ?? token);
}

function likelySlotCandidate(prediction: Prediction, token: string) {
  const match = token.match(/^([12])([A-L])$/);
  if (!match) {
    return null;
  }
  const [, rank, group] = match;
  const metric: "winner" | "runner_up" = rank === "1" ? "winner" : "runner_up";
  const row = [...(prediction.group_probabilities[group] ?? [])].sort(
    (left, right) => right[metric] - left[metric] || left.team.localeCompare(right.team)
  )[0];
  return row ? { team: row.team, probability: row[metric] } : null;
}

function likelyThirdCandidate(prediction: Prediction, groups: string[]) {
  return groups
    .flatMap((group) =>
      (prediction.group_probabilities[group] ?? []).map((row) => ({
        team: row.team,
        probability: probabilityAsThird(row)
      }))
    )
    .sort((left, right) => right.probability - left.probability || left.team.localeCompare(right.team))[0];
}

function probabilityAsThird(row: GroupProbabilityRow) {
  return clamp(row.qualify - row.winner - row.runner_up, 0, 1);
}

function findTeamGroup(groups: Record<string, string[]>, team: string) {
  return Object.entries(groups).find(([, teams]) => teams.includes(team))?.[0] ?? null;
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
    throw new Error("El lienzo no está disponible.");
  }
  context.drawImage(image, 0, 0);

  const pngBlob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!pngBlob) {
    throw new Error("No se pudo crear el PNG.");
  }

  const copied = await copyPngToClipboard(pngBlob);
  const pngUrl = URL.createObjectURL(pngBlob);
  const link = document.createElement("a");
  link.href = pngUrl;
  link.download = "mundial-2026-efecto-mariposa.png";
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(pngUrl), 1000);
  return copied;
}

function buildButterflyShareSvg(effect: ButterflyEffect, prediction: Prediction) {
  const winner = effect.biggestWinner
    ? `${displayTeamNameFor(effect.biggestWinner.team)} ${formatSignedPercentPoints(effect.biggestWinner.delta)}`
    : "Sin impulso claro";
  const heartbreak = effect.biggestLoser
    ? `${displayTeamNameFor(effect.biggestLoser.team)} ${formatSignedPercentPoints(effect.biggestLoser.delta)}`
    : "Sin golpe importante";
  const favorite = effect.championFavorite
    ? `${displayTeamNameFor(effect.championFavorite.team)} ${formatPercent(effect.championFavorite.probability)}`
    : "Muy abierto";
  const headline = svgTextBlock(effect.headline, 72, 154, 48, 58, 34);
  const narrative = svgTextBlock(effect.narrative, 72, 492, 22, 30, 86, 2, true);
  const scoreSuffixX = effect.chaosScore >= 100 ? 224 : effect.chaosScore >= 10 ? 174 : 118;

  return `
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="#0b1f17"/>
  <rect x="36" y="36" width="1128" height="558" rx="28" fill="#123724" stroke="#d8ebe1" stroke-opacity="0.18"/>
  <rect x="72" y="72" width="238" height="58" rx="16" fill="#dcefe4" fill-opacity="0.12"/>
  <text x="96" y="109" fill="#ffffff" font-family="Aptos, Segoe UI, Arial, sans-serif" font-size="24" font-weight="900">MUNDIAL 2026</text>
  <text x="72" y="246" fill="#d8ebe1" font-family="Aptos, Segoe UI, Arial, sans-serif" font-size="28" font-weight="800">Escenario Efecto Mariposa</text>
  ${headline}
  <g transform="translate(810 92)">
    <rect width="260" height="204" rx="24" fill="#8e7cf6"/>
    <text x="34" y="58" fill="#ffffff" font-family="Aptos, Segoe UI, Arial, sans-serif" font-size="24" font-weight="900">ÍNDICE DE CAOS</text>
    <text x="34" y="158" fill="#ffffff" font-family="Aptos, Segoe UI, Arial, sans-serif" font-size="96" font-weight="900">${effect.chaosScore}</text>
    <text x="${scoreSuffixX}" y="158" fill="#ffffff" fill-opacity="0.78" font-family="Aptos, Segoe UI, Arial, sans-serif" font-size="34" font-weight="900">/100</text>
  </g>
  ${shareMetric(72, 330, "Ojito con...", winner, "#dcefe4")}
  ${shareMetric(410, 330, "Mayor Pechofriada", heartbreak, "#f0c9d8")}
  ${shareMetric(748, 330, "Favorito ahora", favorite, "#d8ebe1")}
  ${narrative}
  <text x="72" y="574" fill="#d8ebe1" fill-opacity="0.82" font-family="Aptos, Segoe UI, Arial, sans-serif" font-size="18" font-weight="800">Generado con ${prediction.settings.simulations.toLocaleString()} simulaciones</text>
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

function svgTextBlock(
  text: string,
  x: number,
  y: number,
  size: number,
  lineHeight: number,
  maxChars: number,
  maxLines = 3,
  truncate = false
) {
  const lines = splitSvgLines(text, maxChars);
  const visibleLines = lines.slice(0, maxLines);
  if (truncate && lines.length > maxLines && visibleLines.length > 0) {
    const lastIndex = visibleLines.length - 1;
    visibleLines[lastIndex] = `${visibleLines[lastIndex].replace(/[.,;:]?$/, "")}...`;
  }
  return visibleLines
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
    image.onerror = () => reject(new Error("No se pudo renderizar la imagen para compartir."));
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

function StandingsTable({ rows, compact = false }: { rows: Array<Record<string, string | number>>; compact?: boolean }) {
  return (
    <div className="table-wrap">
      <table className={compact ? "compact-table" : ""}>
        <thead>
          <tr>
            <th>Equipo</th>
            <th>PJ</th>
            <th>G</th>
            <th>E</th>
            <th>D</th>
            <th>DG</th>
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
  const displayName = placeholder ? team : displayTeamNameFor(team);
  const label = matchLabel && !placeholder ? teamCodeFor(team) : displayName;
  return (
    <span
      className={`team-name ${align === "right" ? "align-right" : ""} ${compact ? "compact-team" : ""} ${
        matchLabel ? "match-team" : ""
      }`}
      title={matchLabel ? displayName : undefined}
    >
      {flagUrl && <img className="flag" src={flagUrl} alt={flagLabelFor(team)} loading="lazy" />}
      <span className={placeholder ? "placeholder-team" : ""}>{label}</span>
    </span>
  );
}

function countPositions(players: SquadTeam["players"]) {
  return players.reduce<Record<"GK" | "DF" | "MF" | "FW", number>>(
    (counts, player) => {
      counts[player.position] += 1;
      return counts;
    },
    { GK: 0, DF: 0, MF: 0, FW: 0 }
  );
}

const SQUAD_POSITION_ORDER: Record<SquadTeam["players"][number]["position"], number> = {
  GK: 0,
  DF: 1,
  MF: 2,
  FW: 3
};

function sortSquadPlayersByPositionAndNumber(players: SquadTeam["players"]) {
  return [...players].sort((left, right) => {
    const positionDifference = SQUAD_POSITION_ORDER[left.position] - SQUAD_POSITION_ORDER[right.position];
    return positionDifference || left.number - right.number;
  });
}

function positionLabel(position: "GK" | "DF" | "MF" | "FW") {
  const labels = {
    GK: "Portero",
    DF: "Defensa",
    MF: "Centrocampista",
    FW: "Delantero"
  };
  return labels[position];
}

function positionPluralLabel(position: "GK" | "DF" | "MF" | "FW") {
  const labels = {
    GK: "Porteros",
    DF: "Defensas",
    MF: "Centrocampistas",
    FW: "Delanteros"
  };
  return labels[position];
}

function displayPlayerName(player: SquadTeam["players"][number]) {
  const rawParts = player.player_name.trim().split(/\s+/).filter(Boolean);
  if (rawParts.length === 0) {
    return player.player_name;
  }

  const firstGivenIndex = rawParts.findIndex((part, index) => index > 0 && /[a-z]/.test(part));
  if (firstGivenIndex > 0) {
    const surnameTokens = rawParts.slice(0, firstGivenIndex);
    const givenTokens = rawParts.slice(firstGivenIndex);
    return [
      formatNameTokens(givenTokens, player.first_names.split(/\s+/), "given"),
      formatNameTokens(surnameTokens, player.last_names.split(/\s+/), "surname")
    ]
      .filter(Boolean)
      .join(" ");
  }

  return formatNameTokens(rawParts, [...player.first_names.split(/\s+/), ...player.last_names.split(/\s+/)], "free");
}

function formatNameTokens(rawTokens: string[], officialTokens: string[], mode: "given" | "surname" | "free") {
  return rawTokens
    .map((token, index) => {
      const official = officialTokens.find((candidate) => sameBaseToken(candidate, token));
      return formatNameToken(official ?? token, mode === "surname", index);
    })
    .join(" ");
}

function sameBaseToken(left: string, right: string) {
  return stripMarks(left).replace(/[.'’]/g, "").toUpperCase() === stripMarks(right).replace(/[.'’]/g, "").toUpperCase();
}

function stripMarks(value: string) {
  return value.normalize("NFD").replace(/\p{M}/gu, "");
}

const NAME_TOKEN_OVERRIDES: Record<string, string> = {
  AIT: "Aït",
  ALVARO: "Álvaro",
  ANDRES: "Andrés",
  ARAUJO: "Araújo",
  BAENA: "Baena",
  CACERES: "Cáceres",
  CALHANOGLU: "Çalhanoğlu",
  CANCAO: "Canção",
  CANCELO: "Cancelo",
  CANDIDO: "Cândido",
  CASTANO: "Castaño",
  CAVACO: "Cavaco",
  CELIK: "Çelik",
  CHOINIERE: "Choinière",
  COEMERT: "Cömert",
  CONCEICAO: "Conceição",
  CORDOBA: "Córdoba",
  CUBARSI: "Cubarsí",
  DIAZ: "Díaz",
  EDERSON: "Éderson",
  ENCARNACAO: "Encarnação",
  FELIX: "Félix",
  FERNANDEZ: "Fernández",
  GARCIA: "García",
  GIMENEZ: "Giménez",
  GONZALEZ: "González",
  GULER: "Güler",
  GUNOK: "Günok",
  GYOKERES: "Gyökeres",
  HERNANDEZ: "Hernández",
  IBANEZ: "Ibáñez",
  INIGO: "Íñigo",
  JOAO: "João",
  JOSE: "José",
  JUNIOR: "Júnior",
  KOKE: "Koke",
  KOKCU: "Kökçü",
  KONE: "Koné",
  LEAO: "Leão",
  LINDELOF: "Lindelöf",
  LOPEZ: "López",
  MAGALHAES: "Magalhães",
  MARTIN: "Martín",
  MARTINEZ: "Martínez",
  MUNOZ: "Muñoz",
  NICOLAS: "Nicolás",
  NUNEZ: "Núñez",
  OZCAN: "Özcan",
  PAIXAO: "Paixão",
  PENA: "Peña",
  PEREZ: "Pérez",
  RIOS: "Ríos",
  RODRIGUEZ: "Rodríguez",
  SANCHEZ: "Sánchez",
  SIMON: "Simón",
  SOYUNCU: "Söyüncü",
  TRINCAO: "Trincão",
  VICTOR: "Víctor",
  VINA: "Viña",
  VINAS: "Viñas",
  VINICIUS: "Vinícius",
  YUKSEK: "Yüksek"
};

const LOWERCASE_NAME_PARTICLES = new Set(["DA", "DAS", "DE", "DEL", "DI", "DO", "DOS", "DU", "LA", "LAS", "LE", "LOS", "VAN", "VON"]);

function formatNameToken(token: string, surnameMode: boolean, index: number) {
  const clean = token.replace(/[.,]+$/g, "");
  const override = NAME_TOKEN_OVERRIDES[stripMarks(clean).toUpperCase()];
  if (override) {
    return override;
  }
  const upper = clean.toUpperCase();
  if (surnameMode && index > 0 && LOWERCASE_NAME_PARTICLES.has(upper)) {
    return clean.toLocaleLowerCase("es-ES");
  }
  if (LOWERCASE_NAME_PARTICLES.has(upper)) {
    return clean.toLocaleLowerCase("es-ES");
  }
  const lower = clean.toLocaleLowerCase("es-ES");
  return lower.charAt(0).toLocaleUpperCase("es-ES") + lower.slice(1);
}

function ageAtTournament(dateOfBirth: string) {
  const [day, month, year] = dateOfBirth.split("/").map(Number);
  const tournamentStart = new Date(Date.UTC(2026, 5, 11));
  let age = tournamentStart.getUTCFullYear() - year;
  const birthdayThisYear = new Date(Date.UTC(2026, month - 1, day));
  if (birthdayThisYear > tournamentStart) {
    age -= 1;
  }
  return age;
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

function useBracketMetrics() {
  const [element, setElement] = useState<HTMLDivElement | null>(null);
  const [metrics, setMetrics] = useState({ cardWidth: BRACKET_DEFAULT_CARD_WIDTH, rowHeight: BRACKET_ROW_HEIGHT });

  useEffect(() => {
    if (!element) return;
    const target = element;

    function updateMetrics() {
      const styles = window.getComputedStyle(target);
      const horizontalPadding = parseFloat(styles.paddingLeft) + parseFloat(styles.paddingRight);
      const verticalPadding = parseFloat(styles.paddingTop) + parseFloat(styles.paddingBottom);
      const headers = target.querySelector<HTMLElement>(".bracket-headers");
      const headerStyles = headers ? window.getComputedStyle(headers) : null;
      const headerHeight = headers?.offsetHeight ?? 0;
      const headerGap = headerStyles ? parseFloat(headerStyles.marginBottom) : 0;
      const availableWidth = Math.max(0, target.clientWidth - horizontalPadding);
      const availableHeight = Math.max(0, target.clientHeight - verticalPadding - headerHeight - headerGap);
      const cardWidth = Math.max(
        BRACKET_MIN_CARD_WIDTH,
        Math.floor((availableWidth - (BRACKET_ROUNDS.length - 1) * BRACKET_COLUMN_GAP) / BRACKET_ROUNDS.length)
      );
      const rowHeight = Math.max(BRACKET_ROW_HEIGHT, Math.floor(availableHeight / BRACKET_ROWS));

      setMetrics((current) =>
        current.cardWidth === cardWidth && current.rowHeight === rowHeight ? current : { cardWidth, rowHeight }
      );
    }

    updateMetrics();
    const observer = new ResizeObserver(updateMetrics);
    observer.observe(target);
    return () => observer.disconnect();
  }, [element]);

  return [setElement, metrics] as const;
}

function bracketGridStyle(cardWidth: number, bracketWidth: number): React.CSSProperties {
  return {
    gridTemplateColumns: `repeat(${BRACKET_ROUNDS.length}, ${cardWidth}px)`,
    columnGap: BRACKET_COLUMN_GAP,
    width: bracketWidth
  };
}

function bracketBoardStyle(cardWidth: number, rowHeight: number, bracketWidth: number, bracketHeight: number): React.CSSProperties {
  return {
    gridTemplateColumns: `repeat(${BRACKET_ROUNDS.length}, ${cardWidth}px)`,
    gridTemplateRows: `repeat(${BRACKET_ROWS}, ${rowHeight}px)`,
    columnGap: BRACKET_COLUMN_GAP,
    width: bracketWidth,
    minHeight: bracketHeight
  };
}

function knockoutWinnerSide(fact?: FactDraft): "home" | "away" | null {
  if (!fact) {
    return null;
  }
  if (fact.home_score !== undefined && fact.away_score !== undefined) {
    if (fact.home_score > fact.away_score) {
      return "home";
    }
    if (fact.away_score > fact.home_score) {
      return "away";
    }
  }
  return fact.knockout_winner ?? null;
}

function buildBracketConnectors(layout: Record<number, BracketPosition>, rowHeight: number, cardWidth: number) {
  return Object.values(layout).flatMap((position) =>
    position.childMatchIds.map((childMatchId) => {
      const child = layout[childMatchId];
      if (!child) return "";
      const childIsLeftOfParent = child.column < position.column;
      const startX = bracketX(child.column, childIsLeftOfParent ? "right" : "left", cardWidth);
      const startY = bracketY(child.slot, rowHeight);
      const endX = bracketX(position.column, childIsLeftOfParent ? "left" : "right", cardWidth);
      const endY = bracketY(position.slot, rowHeight);
      const midX = startX + (endX - startX) / 2;
      return `M ${startX} ${startY} H ${midX} V ${endY} H ${endX}`;
    })
  ).filter(Boolean);
}

function bracketX(column: number, edge: "left" | "right", cardWidth: number) {
  const left = (column - 1) * (cardWidth + BRACKET_COLUMN_GAP);
  return edge === "left" ? left : left + cardWidth;
}

function bracketY(slot: number, rowHeight: number) {
  return slot * rowHeight;
}

function tabFromSearch(search: string): Tab | null {
  const view = new URLSearchParams(search).get("view");
  return view === "groups" || view === "knockout" || view === "predictions" || view === "squads" ? view : null;
}

function formatPercent(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}

function roundTitleFor(round: string) {
  const titles: Record<string, string> = {
    "Round of 32": "Dieciseisavos",
    "Round of 16": "Octavos",
    "Quarter-final": "Cuartos",
    "Semi-final": "Semis",
    Final: "Final",
    "Match for third place": "Tercer puesto"
  };
  return titles[round] ?? round;
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

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
