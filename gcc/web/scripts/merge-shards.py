#!/usr/bin/env python3
"""Merge shard results back into tribes.json and families.json."""

import json
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parents[1] / "src" / "data"
SHARD_DIR = DATA_DIR / "shards"

MISSING_GCC_FAMILIES = [
    {"id": "al_fahim", "name": "Al Fahim"}, {"id": "al_ghurair", "name": "Al Ghurair"},
    {"id": "al_futtaim", "name": "Al Futtaim"}, {"id": "al_habtoor", "name": "Al Habtoor"},
    {"id": "al_rostamani", "name": "Al Rostamani"}, {"id": "al_tayer", "name": "Al Tayer"},
    {"id": "al_mulla_family", "name": "Al Mulla"}, {"id": "al_serkal", "name": "Al Serkal"},
    {"id": "al_majid", "name": "Al Majid"}, {"id": "al_owais", "name": "Al Owais"},
    {"id": "al_ansari_family", "name": "Al Ansari"}, {"id": "al_zarooni", "name": "Al Zarooni"},
    {"id": "al_ketbi_family", "name": "Al Ketbi"}, {"id": "al_shamsi_family", "name": "Al Shamsi"},
    {"id": "al_khoory", "name": "Al Khoory"}, {"id": "al_azzawi", "name": "Al Azzawi"},
    {"id": "al_suwaidi_family", "name": "Al Suwaidi"}, {"id": "al_dhaheri_family", "name": "Al Dhaheri"},
    {"id": "al_mansoori_family", "name": "Al Mansoori"}, {"id": "al_qubaisi", "name": "Al Qubaisi"},
    {"id": "al_rumaithi", "name": "Al Rumaithi"}, {"id": "al_mazrouei", "name": "Al Mazrouei"},
    {"id": "al_hammadi_family", "name": "Al Hammadi"}, {"id": "al_ameri_family", "name": "Al Ameri"},
    {"id": "al_kaabi_family", "name": "Al Kaabi"}, {"id": "juma_al_majid", "name": "Juma Al Majid"},
    {"id": "al_dowsari", "name": "Al Dowsari"}, {"id": "al_muhadib", "name": "Al Muhadib"},
    {"id": "al_rajhi", "name": "Al Rajhi"}, {"id": "al_olayan", "name": "Al Olayan"},
    {"id": "bin_laden", "name": "Bin Laden"}, {"id": "al_dabbagh", "name": "Al Dabbagh"},
    {"id": "al_gosaibi", "name": "Al Gosaibi"}, {"id": "al_zamil", "name": "Al Zamil"},
    {"id": "al_turki_family", "name": "Al Turki"}, {"id": "al_muhaidib", "name": "Al Muhaidib"},
    {"id": "al_subeaei", "name": "Al Subeaei"}, {"id": "al_mana", "name": "Al Mana"},
    {"id": "al_fardan", "name": "Al Fardan"}, {"id": "al_misnad", "name": "Al Misnad"},
    {"id": "al_moayyed", "name": "Al Moayyed"}, {"id": "kanoo", "name": "Kanoo"},
    {"id": "al_zayani", "name": "Al Zayani"}, {"id": "jawad", "name": "Jawad"},
    {"id": "al_ghanim", "name": "Al Ghanim"}, {"id": "al_kharafi", "name": "Al Kharafi"},
    {"id": "al_sager", "name": "Al Sager"}, {"id": "al_bahar", "name": "Al Bahar"},
    {"id": "al_marzook", "name": "Al Marzook"}, {"id": "al_shanfari", "name": "Al Shanfari"},
    {"id": "al_maskiry", "name": "Al Maskiry"}, {"id": "al_rawas", "name": "Al Rawas"},
]

def make_empty_family(fid, fname):
    return {
        "id": fid, "name": fname, "nameAr": None, "familyType": "merchant",
        "tribeId": None, "isRuling": False, "rulesOver": None, "foundedYear": None,
        "currentHead": None, "legitimacyBasis": None, "originStory": None,
        "description": None, "notableFigures": [],
        "history": None, "modernStatus": None, "tribalOrigin": None,
        "migrationPath": [], "timelineEvents": [], "connections": [],
    }

def main():
    tribes = json.loads((DATA_DIR / "tribes.json").read_text())
    families = json.loads((DATA_DIR / "families.json").read_text())

    # Add missing families first
    existing_ids = {f["id"] for f in families}
    for mf in MISSING_GCC_FAMILIES:
        if mf["id"] not in existing_ids:
            families.append(make_empty_family(mf["id"], mf["name"]))
            existing_ids.add(mf["id"])

    # Ensure new fields
    for t in tribes:
        t.setdefault("history", None)
        t.setdefault("migrationPath", [])
        t.setdefault("timelineEvents", [])
    for f in families:
        for field in ("history", "modernStatus", "tribalOrigin"):
            f.setdefault(field, None)
        for field in ("migrationPath", "timelineEvents", "connections"):
            f.setdefault(field, [])

    # Index by id
    tribe_idx = {t["id"]: i for i, t in enumerate(tribes)}
    family_idx = {f["id"]: i for i, f in enumerate(families)}

    # Load and merge all shards
    total = 0
    for shard_file in sorted(SHARD_DIR.glob("shard_*.json")):
        shard_data = json.loads(shard_file.read_text())
        print(f"Loading {shard_file.name}: {len(shard_data)} results")

        for item in shard_data:
            etype = item["type"]
            eid = item["id"]
            data = item["data"]

            if etype == "tribe" and eid in tribe_idx:
                t = tribes[tribe_idx[eid]]
                if data.get("history"): t["history"] = data["history"]
                if data.get("migrationPath"):
                    t["migrationPath"] = [m for m in data["migrationPath"] if isinstance(m, dict)]
                if data.get("timelineEvents"):
                    t["timelineEvents"] = [e for e in data["timelineEvents"] if isinstance(e, dict) and e.get("year")]
                total += 1

            elif etype == "family" and eid in family_idx:
                f = families[family_idx[eid]]
                if data.get("history"): f["history"] = data["history"]
                if data.get("description") and not f.get("description"): f["description"] = data["description"]
                if data.get("originStory") and not f.get("originStory"): f["originStory"] = data["originStory"]
                if data.get("tribalOrigin"): f["tribalOrigin"] = data["tribalOrigin"]
                if data.get("modernStatus"): f["modernStatus"] = data["modernStatus"]
                if data.get("migrationPath"):
                    f["migrationPath"] = [m for m in data["migrationPath"] if isinstance(m, dict)]
                if data.get("timelineEvents"):
                    f["timelineEvents"] = [e for e in data["timelineEvents"] if isinstance(e, dict) and e.get("year")]
                if data.get("connections"):
                    f["connections"] = [c for c in data["connections"] if isinstance(c, dict) and c.get("entityId")]
                # Merge notable figures
                if data.get("notableFigures"):
                    existing_fig_ids = {fig.get("id") for fig in f.get("notableFigures", [])}
                    for fig in data["notableFigures"]:
                        if isinstance(fig, dict) and fig.get("name"):
                            fig_id = fig.get("id") or fig["name"].lower().replace(" ", "_")
                            if fig_id not in existing_fig_ids:
                                f.setdefault("notableFigures", []).append(fig)
                                existing_fig_ids.add(fig_id)
                total += 1

    (DATA_DIR / "tribes.json").write_text(json.dumps(tribes, indent=2, ensure_ascii=False) + "\n")
    (DATA_DIR / "families.json").write_text(json.dumps(families, indent=2, ensure_ascii=False) + "\n")

    # Stats
    print(f"\nMerged {total} enrichments")
    for label, lst in [("Tribes", tribes), ("Families", families)]:
        h = sum(1 for e in lst if e.get("history"))
        m = sum(1 for e in lst if e.get("migrationPath") and len(e["migrationPath"]) > 0)
        ev = sum(1 for e in lst if e.get("timelineEvents") and len(e["timelineEvents"]) > 0)
        print(f"{label} ({len(lst)}): history={h}, migration={m}, events={ev}")

if __name__ == "__main__":
    main()
