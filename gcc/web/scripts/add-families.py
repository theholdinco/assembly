#!/usr/bin/env python3
"""Add 60 newly researched families to families.json."""

import json
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parents[1] / "src" / "data"

NEW_FAMILIES = [
    {"id": "al_lootah", "name": "Al Lootah", "country": "UAE"},
    {"id": "al_jallaf", "name": "Al Jallaf", "country": "UAE"},
    {"id": "al_kazim", "name": "Al Kazim", "country": "UAE"},
    {"id": "al_sari", "name": "Al Sari", "country": "UAE"},
    {"id": "galadari", "name": "Galadari", "country": "UAE"},
    {"id": "al_shafar", "name": "Al Shafar", "country": "UAE"},
    {"id": "al_gaz", "name": "Al Gaz", "country": "UAE"},
    {"id": "sajwani", "name": "Sajwani", "country": "UAE"},
    {"id": "al_farooq", "name": "Al Farooq", "country": "UAE"},
    {"id": "al_bastaki", "name": "Al Bastaki", "country": "UAE"},
    {"id": "al_mohebi", "name": "Al Mohebi", "country": "UAE"},
    {"id": "abdul_latif_jameel", "name": "Abdul Latif Jameel", "country": "Saudi Arabia"},
    {"id": "al_juffali", "name": "Al Juffali", "country": "Saudi Arabia"},
    {"id": "al_amoudi", "name": "Al Amoudi", "country": "Saudi Arabia"},
    {"id": "bin_mahfouz", "name": "Bin Mahfouz", "country": "Saudi Arabia"},
    {"id": "bugshan", "name": "Bugshan", "country": "Saudi Arabia"},
    {"id": "alireza", "name": "Alireza", "country": "Saudi Arabia"},
    {"id": "binzagr", "name": "Binzagr", "country": "Saudi Arabia"},
    {"id": "al_naghi", "name": "Al Naghi", "country": "Saudi Arabia"},
    {"id": "zahid", "name": "Zahid", "country": "Saudi Arabia"},
    {"id": "sharbatly", "name": "Sharbatly", "country": "Saudi Arabia"},
    {"id": "kamel", "name": "Kamel", "country": "Saudi Arabia"},
    {"id": "al_issa", "name": "Al Issa", "country": "Saudi Arabia"},
    {"id": "abunayyan", "name": "Abunayyan", "country": "Saudi Arabia"},
    {"id": "al_khereiji", "name": "Al Khereiji", "country": "Saudi Arabia"},
    {"id": "al_jomaih", "name": "Al Jomaih", "country": "Saudi Arabia"},
    {"id": "al_jeraisy", "name": "Al Jeraisy", "country": "Saudi Arabia"},
    {"id": "al_saedan", "name": "Al Saedan", "country": "Saudi Arabia"},
    {"id": "al_fakieh", "name": "Al Fakieh", "country": "Saudi Arabia"},
    {"id": "al_qahtani", "name": "Al Qahtani", "country": "Saudi Arabia"},
    {"id": "al_tamimi", "name": "Al Tamimi", "country": "Saudi Arabia"},
    {"id": "al_drees", "name": "Al Drees", "country": "Saudi Arabia"},
    {"id": "al_agil", "name": "Al Agil", "country": "Saudi Arabia"},
    {"id": "al_saleh", "name": "Al Saleh", "country": "Saudi Arabia"},
    {"id": "al_shobokshi", "name": "Al Shobokshi", "country": "Saudi Arabia"},
    {"id": "behbehani", "name": "Behbehani", "country": "Kuwait"},
    {"id": "al_shaya", "name": "Al Shaya", "country": "Kuwait"},
    {"id": "al_sayer", "name": "Al Sayer", "country": "Kuwait"},
    {"id": "al_wazzan", "name": "Al Wazzan", "country": "Kuwait"},
    {"id": "al_ghunaim", "name": "Al Ghunaim", "country": "Kuwait"},
    {"id": "al_mutawa", "name": "Al Mutawa", "country": "Kuwait"},
    {"id": "boodai", "name": "Boodai", "country": "Kuwait"},
    {"id": "al_nafisi", "name": "Al Nafisi", "country": "Kuwait"},
    {"id": "al_humaidi", "name": "Al Humaidi", "country": "Kuwait"},
    {"id": "bukhamseen", "name": "Bukhamseen", "country": "Kuwait"},
    {"id": "al_mannai", "name": "Al Mannai", "country": "Qatar"},
    {"id": "al_jaidah", "name": "Al Jaidah", "country": "Qatar"},
    {"id": "al_emadi", "name": "Al Emadi", "country": "Qatar"},
    {"id": "al_kuwari", "name": "Al Kuwari", "country": "Qatar"},
    {"id": "al_khayyat", "name": "Al Khayyat", "country": "Qatar"},
    {"id": "al_khater", "name": "Al Khater", "country": "Qatar"},
    {"id": "al_mohannadi", "name": "Al Mohannadi", "country": "Qatar"},
    {"id": "fakhro", "name": "Fakhro", "country": "Bahrain"},
    {"id": "nass", "name": "Nass", "country": "Bahrain"},
    {"id": "al_jalal", "name": "Al Jalal", "country": "Bahrain"},
    {"id": "al_zawawi", "name": "Al Zawawi", "country": "Oman"},
    {"id": "al_zubair", "name": "Al Zubair", "country": "Oman"},
    {"id": "bahwan", "name": "Bahwan", "country": "Oman"},
    {"id": "towell", "name": "Towell", "country": "Oman"},
    {"id": "khimji", "name": "Khimji", "country": "Oman"},
]


def make_empty_family(entry: dict) -> dict:
    """Create a full family record with all required fields from a stub."""
    return {
        "id": entry["id"],
        "name": entry["name"],
        "nameAr": None,
        "tribeId": None,
        "familyType": None,
        "isRuling": 0,
        "rulesOver": None,
        "currentHead": None,
        "foundedYear": None,
        "originStory": None,
        "legitimacyBasis": None,
        "description": None,
        "notableFigures": [],
        "history": None,
        "modernStatus": None,
        "tribalOrigin": None,
        "migrationPath": [],
        "timelineEvents": [],
        "connections": [],
        "entityClassification": "family",
        "subTribes": [],
        "relations": [],
    }


def main():
    families_path = DATA_DIR / "families.json"
    families = json.loads(families_path.read_text(encoding="utf-8"))

    existing_ids = {f["id"] for f in families}
    added = 0

    for entry in NEW_FAMILIES:
        if entry["id"] not in existing_ids:
            families.append(make_empty_family(entry))
            added += 1

    families_path.write_text(
        json.dumps(families, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )

    print(f"Added {added} new families ({len(NEW_FAMILIES) - added} already existed)")
    print(f"Total families: {len(families)}")


if __name__ == "__main__":
    main()
