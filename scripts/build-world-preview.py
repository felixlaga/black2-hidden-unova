"""Render an interactive design diagram from authoring data; never a game build."""
import json
from pathlib import Path

root = Path(__file__).resolve().parents[1]
expansion = json.loads((root / "content/expansion.json").read_text())
world = json.loads((root / "content/world-map.json").read_text())
areas = {area["id"]: area for area in expansion["hidden_areas"]}
towns = []
for town in expansion["settlements"]:
    secrets = []
    for area_id in town["hidden_area_ids"]:
        area = areas[area_id]
        species = [area["encounter"]["species"]] + [q["species"] for q in area.get("story_quest_encounters", [])]
        secrets.append({"name": area["name"], "species": " / ".join(species)})
    towns.append({"id": town["id"], "name": town["name"], "secrets": secrets})
data = {
    "towns": towns,
    "secretCount": len(areas),
    "regions": [{"id": region["id"], "name": region["name"], "townIds": region["settlement_ids"]} for region in world["regions"]],
    "gyms": [{"townId": gym["settlement_id"], "name": gym["building"]["name"], "type": gym["type"], "leader": gym["leader"]["name"], "puzzle": gym["puzzle"]} for gym in expansion["gyms"]],
    "routes": [{"from": route["from"], "to": route["to"]} for route in world["routes"]],
}
payload = json.dumps(data, ensure_ascii=False).replace("<", "\\u003c")
template = (root / "scripts/world-preview.template.html").read_text()
output = root / "output/world-plan.html"
output.parent.mkdir(exist_ok=True)
output.write_text(template.replace("__DATA__", payload))
print(output)
