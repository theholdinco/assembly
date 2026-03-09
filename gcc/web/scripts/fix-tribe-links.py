#!/usr/bin/env python3
"""
Fix data quality issues in tribal hierarchy:
1. Resolve tribalOrigin strings to tribe IDs via fuzzy matching
2. Fix lineageRoot contradictions between subtribes and parents
3. Mark confederations (tribes with 10+ subTribes)
"""

import json
import re
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parent.parent / "src" / "data"


def normalize_tribe_name(name):
    """Normalize a tribe name for fuzzy matching."""
    s = name.lower().strip()
    s = s.replace("_", " ")
    # Strip common prefixes
    for prefix in ["al-", "al ", "banu ", "bani ", "banu-", "bani-"]:
        if s.startswith(prefix):
            s = s[len(prefix):]
    # Remove parenthetical notes like "(Iraqi branch)"
    s = re.sub(r"\s*\(.*?\)\s*", "", s)
    s = s.strip()
    return s


def build_tribe_lookup(tribes):
    """Build a normalized-name -> tribe-id lookup from tribes.json."""
    lookup = {}
    for t in tribes:
        norm = normalize_tribe_name(t["name"])
        lookup[norm] = t["id"]
        # Also index by the id itself (underscores to spaces)
        norm_id = normalize_tribe_name(t["id"])
        if norm_id not in lookup:
            lookup[norm_id] = t["id"]
    return lookup


def resolve_tribe_ids(families, tribe_lookup):
    """Resolve tribalOrigin text to tribeId via fuzzy matching."""
    resolved = 0
    for fam in families:
        origin = fam.get("tribalOrigin")
        if not origin:
            continue
        current_id = fam.get("tribeId")
        if current_id and current_id != "<UNKNOWN>":
            continue

        norm = normalize_tribe_name(origin)
        matched_id = tribe_lookup.get(norm)
        if matched_id:
            fam["tribeId"] = matched_id
            resolved += 1

    return resolved


def fix_lineage_roots(tribes, graph_links):
    """Fix subtribes whose lineageRoot contradicts their parent."""
    tribe_by_id = {t["id"]: t for t in tribes}

    # Build parent map from graph.json sub_tribe links (source=parent, target=child)
    parent_map = {}
    for link in graph_links:
        if link["type"] == "sub_tribe":
            child_id = link["target"]
            parent_id = link["source"]
            parent_map[child_id] = parent_id

    # Also from tribes.json subTribes arrays
    for t in tribes:
        for sub in t.get("subTribes") or []:
            sub_id = sub["id"] if isinstance(sub, dict) else sub
            if sub_id not in parent_map:
                parent_map[sub_id] = t["id"]

    fixed = 0
    for child_id, parent_id in parent_map.items():
        child = tribe_by_id.get(child_id)
        parent = tribe_by_id.get(parent_id)
        if not child or not parent:
            continue

        parent_root = parent.get("lineageRoot")
        child_root = child.get("lineageRoot")

        if not parent_root or parent_root in ("unknown", "disputed"):
            continue
        if child_root and child_root != parent_root and child_root not in ("unknown", "disputed"):
            child["lineageRoot"] = parent_root
            fixed += 1

    return fixed


def mark_confederations(tribes):
    """Mark tribes with 10+ subTribes as confederations."""
    marked = 0
    for t in tribes:
        subs = t.get("subTribes") or []
        count = len(subs)
        if count >= 10:
            t["isConfederation"] = True
            marked += 1
        else:
            t["isConfederation"] = False
    return marked


def main():
    tribes = json.loads((DATA_DIR / "tribes.json").read_text())
    families = json.loads((DATA_DIR / "families.json").read_text())
    graph = json.loads((DATA_DIR / "graph.json").read_text())

    tribe_lookup = build_tribe_lookup(tribes)

    resolved = resolve_tribe_ids(families, tribe_lookup)
    fixed_lineage = fix_lineage_roots(tribes, graph["links"])
    confederations = mark_confederations(tribes)

    (DATA_DIR / "tribes.json").write_text(json.dumps(tribes, indent=2, ensure_ascii=False) + "\n")
    (DATA_DIR / "families.json").write_text(json.dumps(families, indent=2, ensure_ascii=False) + "\n")

    print(f"Tribe IDs resolved:       {resolved}")
    print(f"Lineage roots fixed:      {fixed_lineage}")
    print(f"Confederations marked:    {confederations}")


if __name__ == "__main__":
    main()
