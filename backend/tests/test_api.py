from fastapi.testclient import TestClient

from app.main import app


client = TestClient(app)


def test_tournament_payload_has_full_fixture_list():
    response = client.get("/api/tournament")

    assert response.status_code == 200
    payload = response.json()
    assert payload["name"] == "Mundial 2026"
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


def test_baseline_payload_is_available_and_matches_tournament_version():
    tournament = client.get("/api/tournament").json()
    response = client.get("/api/baseline")

    assert response.status_code == 200
    payload = response.json()
    assert payload["data_version"] == tournament["data_version"]
    assert payload["settings"]["simulations"] > 0
    assert payload["champion_probabilities"]
    assert payload["round_probabilities"]
    assert payload["group_probabilities"]
    assert "facts_used" not in payload
    champion_total = sum(row["probability"] for row in payload["champion_probabilities"])
    assert 0.99 <= champion_total <= 1.01


def test_squads_payload_has_official_squad_snapshot():
    response = client.get("/api/squads")

    assert response.status_code == 200
    payload = response.json()
    assert payload["source"]["url"].endswith("SquadLists-English.pdf")
    assert len(payload["teams"]) == 48
    spain = next(team for team in payload["teams"] if team["team"] == "Spain")
    assert spain["code"] == "ESP"
    assert spain["group"] == "H"
    assert len(spain["players"]) == 26
    assert spain["players"][0]["position"] in {"GK", "DF", "MF", "FW"}


def test_team_stories_payload_has_one_story_per_team():
    response = client.get("/api/team-stories")

    assert response.status_code == 200
    payload = response.json()
    assert payload["source"]["language"] == "es"
    assert len(payload["stories"]) == 48
    assert len({story["code"] for story in payload["stories"]}) == 48
    spain = next(story for story in payload["stories"] if story["code"] == "ESP")
    assert spain["title"]
    assert len(spain["paragraphs"]) >= 2
    assert spain["sources"][0]["url"].startswith("https://")


def test_local_world_cup_logo_is_served():
    response = client.get("/weare26.png")

    assert response.status_code == 200
    assert response.headers["content-type"] == "image/png"
    assert response.content.startswith(b"\x89PNG")


def test_unknown_api_route_returns_json_404():
    response = client.get("/api/not-real")

    assert response.status_code == 404
    assert response.headers["content-type"].startswith("application/json")
    assert response.json()["detail"] == "Ruta de API no encontrada: /api/not-real"


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
    assert "necesita ganador" in response.json()["detail"]


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
