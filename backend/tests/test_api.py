from fastapi.testclient import TestClient

from app.main import app


client = TestClient(app)


def test_tournament_payload_has_full_fixture_list():
    response = client.get("/api/tournament")

    assert response.status_code == 200
    payload = response.json()
    assert payload["name"] == "World Cup 2026"
    assert len(payload["matches"]) == 104
    assert sorted(payload["groups"].keys()) == list("ABCDEFGHIJKL")
    assert payload["matches"][0]["spain_time"] == "21:00"


def test_predict_accepts_locked_group_fact():
    response = client.post(
        "/api/predict",
        json={
            "facts": [
                {
                    "match_id": 1,
                    "home_score": 2,
                    "away_score": 0,
                    "source": "manual",
                }
            ],
            "settings": {"simulations": 200, "seed": 7},
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["facts_used"][0]["match_id"] == 1
    mexico = next(row for row in payload["factual_group_standings"]["A"] if row["team"] == "Mexico")
    assert mexico["points"] == 3


def test_tied_knockout_fact_requires_winner():
    response = client.post(
        "/api/predict",
        json={
            "facts": [
                {
                    "match_id": 73,
                    "home_score": 1,
                    "away_score": 1,
                    "source": "manual",
                }
            ],
            "settings": {"simulations": 200, "seed": 7},
        },
    )

    assert response.status_code == 422
    assert "needs knockout_winner" in response.json()["detail"]


def test_predict_is_seed_deterministic():
    request = {
        "facts": [],
        "settings": {"simulations": 200, "seed": 99},
    }

    first = client.post("/api/predict", json=request)
    second = client.post("/api/predict", json=request)

    assert first.status_code == 200
    assert second.status_code == 200
    assert first.json()["settings"]["seed"] == 99
    assert first.json()["champion_probabilities"] == second.json()["champion_probabilities"]


def test_predict_generates_seed_when_not_supplied():
    request = {
        "facts": [],
        "settings": {"simulations": 200},
    }

    first = client.post("/api/predict", json=request)
    second = client.post("/api/predict", json=request)

    assert first.status_code == 200
    assert second.status_code == 200
    assert isinstance(first.json()["settings"]["seed"], int)
    assert first.json()["settings"]["seed"] != second.json()["settings"]["seed"]
