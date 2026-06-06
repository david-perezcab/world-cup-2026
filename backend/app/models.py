from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, field_validator


class FactResult(BaseModel):
    match_id: int = Field(ge=1, le=104)
    home_score: int = Field(ge=0, le=30)
    away_score: int = Field(ge=0, le=30)
    knockout_winner: str | None = None
    source: Literal["manual", "snapshot"] = "manual"

    @field_validator("knockout_winner")
    @classmethod
    def strip_winner(cls, value: str | None) -> str | None:
        if value is None:
            return None
        stripped = value.strip()
        return stripped or None


class SimulationSettings(BaseModel):
    simulations: int = Field(default=20_000, ge=100, le=100_000)
    seed: int | None = Field(default=None, ge=0, le=2_147_483_647)


class PredictRequest(BaseModel):
    facts: list[FactResult] = Field(default_factory=list)
    settings: SimulationSettings = Field(default_factory=SimulationSettings)


class StandingRow(BaseModel):
    team: str
    played: int
    wins: int
    draws: int
    losses: int
    goals_for: int
    goals_against: int
    goal_difference: int
    points: int


class MatchProbability(BaseModel):
    match_id: int
    round: str
    home_team: str
    away_team: str
    is_fact: bool
    home_win: float
    draw: float
    away_win: float
