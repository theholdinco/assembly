#!/usr/bin/env python3
"""
Merge figure shard results into families.json.
Loads all figures_*.json shards, deduplicates by normalized name, and writes back.
"""

import json
import re
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parents[1] / "src" / "data"
SHARD_DIR = DATA_DIR / "shards"

FIGURE_DEFAULTS = {
    "id": None,
    "name": None,
    "nameAr": None,
    "familyId": None,
    "tribeId": None,
    "bornYear": None,
    "diedYear": None,
    "title": None,
    "roleDescription": None,
    "era": None,
    "significance": None,
    "biography": None,
    "achievements": [],
    "birthPlace": None,
    "birthCoords": None,
}


def normalize_name(name: str) -> str:
    """Normalize a name for deduplication: lowercase, strip common prefixes."""
    n = name.lower().strip()
    for prefix in ("sheikh ", "shaikh ", "bin ", "ibn "):
        n = n.replace(prefix, "")
    n = re.sub(r'\s+', ' ', n).strip()
    return n


def ensure_figure_defaults(figure: dict) -> dict:
    """Ensure all expected fields exist with proper defaults."""
    for key, default in FIGURE_DEFAULTS.items():
        if key not in figure or figure[key] is None:
            if key in ("achievements",):
                figure.setdefault(key, default if isinstance(default, list) else [])
            else:
                figure.setdefault(key, default)
    # Ensure achievements is always a list
    if not isinstance(figure.get("achievements"), list):
        figure["achievements"] = []
    return figure


def main():
    families = json.loads((DATA_DIR / "families.json").read_text())
    family_idx = {f["id"]: i for i, f in enumerate(families)}

    shard_files = sorted(SHARD_DIR.glob("figures_*.json"))
    if not shard_files:
        print("No figures_*.json shard files found."); return

    total_merged = 0
    total_deduped = 0

    for shard_file in shard_files:
        shard_data = json.loads(shard_file.read_text())
        print(f"Loading {shard_file.name}: {len(shard_data)} family results")

        for item in shard_data:
            family_id = item["family_id"]
            new_figures = item.get("figures", [])

            if family_id not in family_idx:
                print(f"  WARNING: family '{family_id}' not found in families.json, skipping")
                continue

            family = families[family_idx[family_id]]
            existing_figures = family.get("notableFigures", [])

            # Build set of normalized names from existing figures
            existing_names = {normalize_name(f["name"]) for f in existing_figures if f.get("name")}

            added = 0
            for fig in new_figures:
                if not isinstance(fig, dict) or not fig.get("name"):
                    continue

                norm = normalize_name(fig["name"])
                if norm in existing_names:
                    total_deduped += 1
                    continue

                existing_names.add(norm)
                ensure_figure_defaults(fig)
                existing_figures.append(fig)
                added += 1

            family["notableFigures"] = existing_figures
            if added > 0:
                total_merged += added
                print(f"  {family['name']}: +{added} figures ({len(existing_figures)} total)")

    (DATA_DIR / "families.json").write_text(
        json.dumps(families, indent=2, ensure_ascii=False) + "\n"
    )

    print(f"\nDone. Merged {total_merged} new figures, skipped {total_deduped} duplicates.")

    # Stats
    figures_count = sum(len(f.get("notableFigures", [])) for f in families)
    families_with = sum(1 for f in families if f.get("notableFigures"))
    print(f"Families with figures: {families_with}/{len(families)}, total figures: {figures_count}")


if __name__ == "__main__":
    main()
