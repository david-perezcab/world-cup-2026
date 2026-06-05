from app.rules import PlayedResult, rank_table


def test_rank_table_uses_points_goal_difference_and_goals_for():
    teams = ["A", "B", "C", "D"]
    results = [
        PlayedResult(1, "A", "B", 2, 0),
        PlayedResult(2, "C", "D", 1, 0),
        PlayedResult(3, "A", "C", 1, 1),
        PlayedResult(4, "B", "D", 3, 0),
    ]

    ranking = rank_table(teams, results, {"A": 1600, "B": 1500, "C": 1500, "D": 1400})

    assert [row["team"] for row in ranking] == ["A", "C", "B", "D"]
