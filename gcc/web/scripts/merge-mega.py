#!/usr/bin/env python3
"""Merge mega-enrichment shard results back into tribes.json and families.json."""

import json
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parents[1] / "src" / "data"
SHARD_DIR = DATA_DIR / "shards"


def main():
    tribes = json.loads((DATA_DIR / "tribes.json").read_text())
    families = json.loads((DATA_DIR / "families.json").read_text())

    # Ensure new fields exist
    for f in families:
        f.setdefault("folkLegends", [])
        f.setdefault("nameEtymology", None)
    for t in tribes:
        t.setdefault("folkLegends", [])
        t.setdefault("nameEtymology", None)

    tribe_idx = {t["id"]: i for i, t in enumerate(tribes)}
    family_idx = {f["id"]: i for i, f in enumerate(families)}

    total = 0
    for shard_file in sorted(SHARD_DIR.glob("mega_*.json")):
        shard_data = json.loads(shard_file.read_text())
        print(f"Loading {shard_file.name}: {len(shard_data)} results")

        for item in shard_data:
            etype = item["type"]
            eid = item["id"]
            data = item["data"]

            if etype == "tribe" and eid in tribe_idx:
                t = tribes[tribe_idx[eid]]
                # Only overwrite if new data is richer
                if data.get("history") and len(data["history"]) > len(t.get("history") or ""):
                    t["history"] = data["history"]
                if data.get("migrationPath") and len(data["migrationPath"]) > len(t.get("migrationPath") or []):
                    t["migrationPath"] = [m for m in data["migrationPath"] if isinstance(m, dict)]
                if data.get("timelineEvents") and len(data["timelineEvents"]) > len(t.get("timelineEvents") or []):
                    t["timelineEvents"] = [e for e in data["timelineEvents"] if isinstance(e, dict) and e.get("year")]
                if data.get("folkLegends"):
                    t["folkLegends"] = [fl for fl in data["folkLegends"] if isinstance(fl, dict) and fl.get("story")]
                if data.get("nameEtymology"):
                    t["nameEtymology"] = data["nameEtymology"]
                total += 1

            elif etype == "family" and eid in family_idx:
                f = families[family_idx[eid]]
                if data.get("history") and len(data["history"]) > len(f.get("history") or ""):
                    f["history"] = data["history"]
                if data.get("description") and len(data.get("description", "")) > len(f.get("description") or ""):
                    f["description"] = data["description"]
                if data.get("originStory") and data["originStory"] != "<UNKNOWN>":
                    f["originStory"] = data["originStory"]
                if data.get("tribalOrigin") is not None:
                    f["tribalOrigin"] = data["tribalOrigin"]
                if data.get("modernStatus"):
                    f["modernStatus"] = data["modernStatus"]
                if data.get("migrationPath") and len(data["migrationPath"]) > len(f.get("migrationPath") or []):
                    f["migrationPath"] = [m for m in data["migrationPath"] if isinstance(m, dict)]
                if data.get("timelineEvents") and len(data["timelineEvents"]) > len(f.get("timelineEvents") or []):
                    f["timelineEvents"] = [e for e in data["timelineEvents"] if isinstance(e, dict) and e.get("year")]
                if data.get("connections"):
                    existing = {(c.get("entityId"), c.get("relationship")) for c in f.get("connections", [])}
                    for c in data["connections"]:
                        if isinstance(c, dict) and c.get("entityId"):
                            key = (c["entityId"], c.get("relationship"))
                            if key not in existing:
                                f.setdefault("connections", []).append(c)
                                existing.add(key)
                if data.get("notableFigures"):
                    existing_names = {fig.get("name", "").lower() for fig in f.get("notableFigures", [])}
                    for fig in data["notableFigures"]:
                        if isinstance(fig, dict) and fig.get("name") and fig["name"].lower() not in existing_names:
                            f.setdefault("notableFigures", []).append(fig)
                            existing_names.add(fig["name"].lower())
                if data.get("folkLegends"):
                    f["folkLegends"] = [fl for fl in data["folkLegends"] if isinstance(fl, dict) and fl.get("story")]
                if data.get("nameEtymology"):
                    f["nameEtymology"] = data["nameEtymology"]
                total += 1

    (DATA_DIR / "tribes.json").write_text(json.dumps(tribes, indent=2, ensure_ascii=False) + "\n")
    (DATA_DIR / "families.json").write_text(json.dumps(families, indent=2, ensure_ascii=False) + "\n")

    print(f"\nMerged {total} mega-enrichments")
    for label, lst in [("Tribes", tribes), ("Families", families)]:
        h = sum(1 for e in lst if e.get("history"))
        folk = sum(1 for e in lst if e.get("folkLegends") and len(e["folkLegends"]) > 0)
        etym = sum(1 for e in lst if e.get("nameEtymology"))
        print(f"{label} ({len(lst)}): history={h}, folkLegends={folk}, etymology={etym}")


if __name__ == "__main__":
    main()
