"""Validate authoring references. This does not compile or verify a game ROM."""
import json
from pathlib import Path

root = Path(__file__).resolve().parents[1]
path = root / "content" / "expansion.json"
if not path.exists():
    raise SystemExit("Expansion authoring data is not available yet.")
data = json.loads(path.read_text())
assert data["status"] == "design_only_not_integrated"
settlements = data["settlements"]
areas = data["hidden_areas"]
quests = data["quests"]
assert (len(settlements), len(areas), len(quests)) == (24, 96, 12)
groups = {"settlements": settlements, "areas": areas, "quests": quests}
for name, rows in groups.items():
    ids = [row["id"] for row in rows]
    assert len(ids) == len(set(ids)), f"Duplicate {name} IDs"
town_ids = {row["id"] for row in settlements}
area_by_id = {row["id"]: row for row in areas}
claimed = []
for town in settlements:
    assert len(town["hidden_area_ids"]) == 4, town["id"]
    for area_id in town["hidden_area_ids"]:
        assert area_id in area_by_id, area_id
        assert area_by_id[area_id]["settlement_id"] == town["id"], area_id
        claimed.append(area_id)
assert len(claimed) == len(set(claimed)) == 96
for area in areas:
    assert area["settlement_id"] in town_ids, area["id"]
    assert area["entry_clue"] and area["unlock"] and area["retry_policy"], area["id"]
    encounter = area["encounter"]
    assert 1 <= encounter["national_dex_id"] <= 649, area["id"]
    assert 1 <= encounter["level"] <= 100, area["id"]
for quest in quests:
    assert quest["stages"] and quest["reward"], quest["id"]
    assert set(quest["area_ids"]) <= area_by_id.keys(), quest["id"]
assert data["dialogue"] and data["first_playable_slice"]
assert "gate.postgame" not in json.dumps(data)
assert "gate.late_campaign" in data["symbols"]["gates"]
world = json.loads((root / "content" / "world-map.json").read_text())
assert len(world["regions"]) == 4
assert len(world["routes"]) == 40
assert len(data["gyms"]) == 12
gym_towns = {gym["settlement_id"] for gym in data["gyms"]}
assert all(not town["progression"]["optional"] for town in settlements if town["id"] in gym_towns)
assert all(len(r["settlement_ids"]) == 6 for r in world["regions"])
nodes = {node["id"] for node in world["nodes"]}
assert len(nodes) == len(world["nodes"])
adjacency = {node: set() for node in nodes}
for edge in world["routes"] + world["base_links"] + world["local_links"]:
    assert edge["from"] in nodes and edge["to"] in nodes
    adjacency[edge["from"]].add(edge["to"])
    if edge.get("bidirectional", False):
        adjacency[edge["to"]].add(edge["from"])
reached, pending = set(), ["world.original_unova"]
while pending:
    node = pending.pop()
    if node not in reached:
        reached.add(node)
        pending.extend(adjacency[node] - reached)
assert reached == nodes, f"Unreachable graph nodes: {nodes - reached}"
story = json.loads((root / "content" / "story.json").read_text())
assert len(story["chapters"]) == 7
assert story["chapters"][-1]["key"] == "story.champion"
assert {"story.n_champion", "story.alder_mentor"} <= story["story_bindings"].keys()
assert {q["national_dex_id"] for q in story["secret_quests"]} == {494, 647, 491}
for quest in story["secret_quests"]:
    area = area_by_id[quest["map_binding"]["world_secret_key"]]
    assert any(e["national_dex_id"] == quest["national_dex_id"] for e in area["story_quest_encounters"])
    assert not any(word in " ".join(quest["access_all_of"]).lower() for word in ["league cleared", "challenge won", "postgame", "hall of fame", "champion defeated"])
assert "gate.postgame" not in json.dumps(world)
difficulty = json.loads((root / "config" / "difficulty.json").read_text())
assert difficulty["status"] == "design_only_not_applied"
bosses = difficulty["league"]["roster"]
assert len(bosses) == 5
assert [b["name"] for b in bosses if b["role"] == "champion"] == ["N"]
for boss in bosses + difficulty["mentor_bosses"]:
    if "story_binding" in boss:
        assert boss["story_binding"] in story["story_bindings"]
for boss in bosses:
    assert boss["trainer_record_ids"] is None
    assert len(boss["team"]) == 6
    for pokemon in boss["team"]:
        assert 1 <= pokemon["national_dex_id"] <= 649
        assert 1 <= pokemon["level"] <= 100 and len(pokemon["moves"]) == 4
print(json.dumps({"settlements": 24, "hidden_areas": 96, "quests": 12,
                  "regions": 4, "new_gyms": 12, "routes": 40,
                  "structural_graph_reachable_nodes": len(reached),
                  "main_story_chapters": 7, "permanent_mythical_quests": 3,
                  "league_teams": 5, "league_pokemon": 30,
                  "authoring_references": "passed", "game_integration": False,
                  "actual_rom_progression_and_all_649_availability_proven": False}, indent=2))
