#!/usr/bin/env python3
"""
Merge new family enrichment shard results into families.json.
Usage: python merge-new.py
"""

import json
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parents[1] / "src" / "data"
SHARD_DIR = DATA_DIR / "shards"


def main():
    families = json.loads((DATA_DIR / "families.json").read_text())
    family_map = {f["id"]: f for f in families}

    # Load all new_*.json shards
    all_results = []
    for shard_file in sorted(SHARD_DIR.glob("new_*.json")):
        try:
            results = json.loads(shard_file.read_text())
            all_results.extend(results)
            print(f"Loaded {shard_file.name}: {len(results)} results")
        except Exception as e:
            print(f"Error loading {shard_file.name}: {e}")

    print(f"\nTotal enrichment results: {len(all_results)}")

    updated = 0
    for result in all_results:
        fid = result["id"]
        data = result["data"]
        if fid not in family_map:
            print(f"  WARNING: {fid} not in families.json, skipping")
            continue

        family = family_map[fid]

        # Merge enriched fields
        for field in ("history", "description", "originStory", "tribalOrigin",
                      "modernStatus", "nameEtymology"):
            val = data.get(field)
            if val and val != "null":
                family[field] = val

        for field in ("folkLegends", "migrationPath", "timelineEvents",
                      "notableFigures", "connections"):
            val = data.get(field)
            if val and isinstance(val, list) and len(val) > 0:
                existing = family.get(field) or []
                if len(val) > len(existing):
                    family[field] = val

        updated += 1

    # Write back
    (DATA_DIR / "families.json").write_text(
        json.dumps(families, indent=2, ensure_ascii=False) + "\n"
    )
    print(f"\nUpdated {updated} families in families.json")
    print(f"Total families: {len(families)}")


if __name__ == "__main__":
    main()
