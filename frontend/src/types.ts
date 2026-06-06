export type Match = {
  match_id: number;
  round: string;
  date: string;
  time: string;
  spain_date: string | null;
  spain_time: string | null;
  home_team: string;
  away_team: string;
  group: string | null;
  ground: string;
  is_knockout: boolean;
};

export type TeamMeta = {
  name: string;
  rating: number;
  group: string;
};

export type Tournament = {
  name: string;
  data_version: string;
  matches: Match[];
  groups: Record<string, string[]>;
  teams: TeamMeta[];
  model: {
    active_model: string;
    ml_status: string;
    notes: string[];
  };
};

export type FactDraft = {
  match_id: number;
  home_score?: number;
  away_score?: number;
  knockout_winner?: "home" | "away";
  source: "manual" | "snapshot";
};

export type FactResult = {
  match_id: number;
  home_score: number;
  away_score: number;
  knockout_winner?: "home" | "away";
  source: "manual" | "snapshot";
};

export type StandingRow = {
  team: string;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  goals_for: number;
  goals_against: number;
  goal_difference: number;
  points: number;
};

export type Prediction = {
  data_version: string;
  settings: {
    simulations: number;
    seed: number;
  };
  facts_used: FactResult[];
  factual_group_standings: Record<string, StandingRow[]>;
  group_probabilities: Record<
    string,
    Array<{
      team: string;
      winner: number;
      runner_up: number;
      qualify: number;
    }>
  >;
  round_probabilities: Array<{
    team: string;
    round_of_32: number;
    round_of_16: number;
    quarter_final: number;
    semi_final: number;
    final: number;
    champion: number;
  }>;
  champion_probabilities: Array<{
    team: string;
    probability: number;
  }>;
  match_probabilities: Array<{
    match_id: number;
    round: string;
    home_team: string;
    away_team: string;
    is_fact: boolean;
    home_win: number;
    draw: number;
    away_win: number;
  }>;
  model: {
    active_model: string;
    ml_status: string;
    notes: string[];
  };
};

export type BaselinePrediction = Pick<
  Prediction,
  "data_version" | "settings" | "group_probabilities" | "round_probabilities" | "champion_probabilities"
>;
