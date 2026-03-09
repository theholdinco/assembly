#!/usr/bin/env python3
"""Deduplicate and merge tribe/family entries with overlapping identities."""

import json
import re
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parents[1] / "src" / "data"

STRIP_PREFIXES = re.compile(
    r"^(al[\s\-]|bani\s|banu\s|house\s+of\s)", re.IGNORECASE
)


def normalize_name(name: str) -> str:
    """Strip common prefixes, lowercase, remove spaces/underscores/hyphens."""
    n = STRIP_PREFIXES.sub("", name)
    return re.sub(r"[\s_\-'\"]+", "", n).lower()


def pick_longer(a: str | None, b: str | None) -> str | None:
    if not a:
        return b
    if not b:
        return a
    return a if len(a) >= len(b) else b


def dedup_migration(steps_a: list, steps_b: list) -> list:
    """Union migration steps, dedup by 'from' key."""
    seen = set()
    merged = []
    for step in steps_a + steps_b:
        key = step.get("from", "")
        if key not in seen:
            seen.add(key)
            merged.append(step)
    return merged


def dedup_timeline(events_a: list, events_b: list) -> list:
    """Union timeline events, dedup by 'title' key."""
    seen = set()
    merged = []
    for evt in events_a + events_b:
        key = evt.get("title", "")
        if key not in seen:
            seen.add(key)
            merged.append(evt)
    return merged


def ensure_migration_endyear(steps: list) -> list:
    for step in steps:
        if "endYear" not in step:
            step["endYear"] = None
    return steps


def ensure_notable_figure_fields(figures: list) -> list:
    for fig in figures:
        fig.setdefault("biography", None)
        fig.setdefault("achievements", [])
        fig.setdefault("birthPlace", None)
        fig.setdefault("birthCoords", None)
    return figures


def merge_tribe_into_family(family: dict, tribe: dict) -> dict:
    """Absorb tribe data into a matched family entry."""
    family["entityClassification"] = "tribe+family"
    family["subTribes"] = tribe.get("subTribes", []) + family.get("subTribes", [])
    family["relations"] = tribe.get("relations", []) + family.get("relations", [])
    family["history"] = pick_longer(family.get("history"), tribe.get("history"))
    family["migrationPath"] = dedup_migration(
        family.get("migrationPath", []), tribe.get("migrationPath", [])
    )
    family["timelineEvents"] = dedup_timeline(
        family.get("timelineEvents", []), tribe.get("timelineEvents", [])
    )
    return family


def merge_family_into_family(target: dict, source: dict) -> dict:
    """Merge a duplicate family into the richer entry."""
    target["history"] = pick_longer(target.get("history"), source.get("history"))
    target["description"] = pick_longer(
        target.get("description"), source.get("description")
    )
    target["migrationPath"] = dedup_migration(
        target.get("migrationPath", []), source.get("migrationPath", [])
    )
    target["timelineEvents"] = dedup_timeline(
        target.get("timelineEvents", []), source.get("timelineEvents", [])
    )
    # Merge notable figures by id
    existing_ids = {f.get("id") for f in target.get("notableFigures", [])}
    for fig in source.get("notableFigures", []):
        if fig.get("id") not in existing_ids:
            target.setdefault("notableFigures", []).append(fig)
    # Merge connections by entityId
    existing_conns = {c.get("entityId") for c in target.get("connections", [])}
    for conn in source.get("connections", []):
        if conn.get("entityId") not in existing_conns:
            target.setdefault("connections", []).append(conn)
    return target


def richness_score(entry: dict) -> int:
    """Rough measure of how much data an entry has."""
    score = 0
    score += len(entry.get("history") or "")
    score += len(entry.get("description") or "")
    score += len(entry.get("notableFigures", []))
    score += len(entry.get("migrationPath", []))
    score += len(entry.get("timelineEvents", []))
    score += len(entry.get("connections", []))
    return score


def main():
    tribes = json.loads((DATA_DIR / "tribes.json").read_text(encoding="utf-8"))
    families = json.loads((DATA_DIR / "families.json").read_text(encoding="utf-8"))

    tribe_by_id = {t["id"]: t for t in tribes}
    tribe_by_norm = {}
    for t in tribes:
        norm = normalize_name(t["name"])
        tribe_by_norm.setdefault(norm, []).append(t)

    family_by_id = {f["id"]: f for f in families}

    # --- Step 1: Merge tribes into families ---
    merged_tribe_ids = set()

    # 1a: Direct tribeId link
    for fam in families:
        tid = fam.get("tribeId")
        if tid and tid in tribe_by_id:
            merge_tribe_into_family(fam, tribe_by_id[tid])
            merged_tribe_ids.add(tid)

    # 1b: Normalized name match (for tribes not yet merged)
    family_by_norm = {}
    for f in families:
        norm = normalize_name(f["name"])
        family_by_norm.setdefault(norm, []).append(f)

    for tribe in tribes:
        if tribe["id"] in merged_tribe_ids:
            continue
        norm = normalize_name(tribe["name"])
        if norm in family_by_norm:
            target = family_by_norm[norm][0]
            merge_tribe_into_family(target, tribe)
            merged_tribe_ids.add(tribe["id"])

    # Remove merged tribes
    tribes = [t for t in tribes if t["id"] not in merged_tribe_ids]

    # --- Step 2: Family-family dedup by normalized name ---
    family_dedup_count = 0
    seen_norms = {}
    dedup_remove_ids = set()

    for fam in families:
        norm = normalize_name(fam["name"])
        if norm in seen_norms:
            existing = seen_norms[norm]
            if richness_score(fam) > richness_score(existing):
                merge_family_into_family(fam, existing)
                dedup_remove_ids.add(existing["id"])
                seen_norms[norm] = fam
            else:
                merge_family_into_family(existing, fam)
                dedup_remove_ids.add(fam["id"])
            family_dedup_count += 1
        else:
            seen_norms[norm] = fam

    families = [f for f in families if f["id"] not in dedup_remove_ids]

    # --- Step 3: Add default fields to all families ---
    for fam in families:
        fam.setdefault("entityClassification", "family")
        fam.setdefault("subTribes", [])
        fam.setdefault("relations", [])

    # --- Step 4: Ensure endYear on all MigrationStep entries ---
    for fam in families:
        ensure_migration_endyear(fam.get("migrationPath", []))
    for tribe in tribes:
        ensure_migration_endyear(tribe.get("migrationPath", []))

    # --- Step 5: Ensure default fields on NotableFigure entries ---
    for fam in families:
        ensure_notable_figure_fields(fam.get("notableFigures", []))

    # --- Write back ---
    (DATA_DIR / "tribes.json").write_text(
        json.dumps(tribes, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    (DATA_DIR / "families.json").write_text(
        json.dumps(families, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )

    print(f"Tribes merged into families: {len(merged_tribe_ids)}")
    print(f"Family-family dedup merges: {family_dedup_count}")
    print(f"Remaining tribes: {len(tribes)}")
    print(f"Final families: {len(families)}")


if __name__ == "__main__":
    main()
