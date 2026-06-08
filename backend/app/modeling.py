from __future__ import annotations

import math

import numpy as np


def expected_goals(home_team: str, away_team: str, ratings: dict[str, float]) -> tuple[float, float]:
    """Convert an Elo gap into two Poisson means.

    This is the active v1 model. The module boundary is intentionally small so a
    trained ML probability model can replace or blend with it later.
    """

    rating_gap = ratings.get(home_team, 1500.0) - ratings.get(away_team, 1500.0)
    multiplier = 10 ** (rating_gap / 1200)
    base_goals = 1.28
    home_mu = min(max(base_goals * multiplier, 0.25), 4.2)
    away_mu = min(max(base_goals / multiplier, 0.25), 4.2)
    return home_mu, away_mu


def advancement_probability(home_team: str, away_team: str, ratings: dict[str, float]) -> float:
    gap = ratings.get(home_team, 1500.0) - ratings.get(away_team, 1500.0)
    return 1 / (1 + 10 ** (-gap / 400))


def simulate_score(
    home_team: str,
    away_team: str,
    ratings: dict[str, float],
    rng: np.random.Generator,
) -> tuple[int, int]:
    home_mu, away_mu = expected_goals(home_team, away_team, ratings)
    return int(rng.poisson(home_mu)), int(rng.poisson(away_mu))


def win_draw_loss_probabilities(
    home_team: str,
    away_team: str,
    ratings: dict[str, float],
    max_goals: int = 9,
) -> tuple[float, float, float]:
    home_mu, away_mu = expected_goals(home_team, away_team, ratings)
    home_win = 0.0
    draw = 0.0
    away_win = 0.0

    home_probs = [_poisson_probability(home_mu, goals) for goals in range(max_goals + 1)]
    away_probs = [_poisson_probability(away_mu, goals) for goals in range(max_goals + 1)]

    for home_goals, home_prob in enumerate(home_probs):
        for away_goals, away_prob in enumerate(away_probs):
            probability = home_prob * away_prob
            if home_goals > away_goals:
                home_win += probability
            elif home_goals < away_goals:
                away_win += probability
            else:
                draw += probability

    total = home_win + draw + away_win
    return home_win / total, draw / total, away_win / total


def _poisson_probability(mean: float, value: int) -> float:
    return math.exp(-mean) * mean**value / math.factorial(value)


MODEL_CARD = {
    "active_model": "Base Poisson informada por Elo",
    "ml_status": "Las pruebas históricas y el entrenamiento quedan reservados para el siguiente hito de actualización de datos.",
    "notes": [
        "Los resultados reales introducidos por el usuario sustituyen al modelo.",
        "Los partidos pendientes se simulan a partir de los ratings de las selecciones.",
        "Los empates simulados en eliminatorias se resuelven con probabilidad de avance basada en Elo.",
    ],
}
