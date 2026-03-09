#!/usr/bin/env python3
"""
Discover missing GCC families from Wikipedia lists, Forbes lists, and known sources.
Creates skeleton entries in families.json for the mega-enrich pipeline to fill.

Usage: python discover-families.py [--dry-run]
"""

import json
import re
import sys
import time
import html
import urllib.request
import urllib.parse
from pathlib import Path
from collections import defaultdict

DATA_DIR = Path(__file__).resolve().parents[1] / "src" / "data"
DRY_RUN = "--dry-run" in sys.argv

# ── Wikipedia API ────────────────────────────────────────────────────────

HEADERS = {"User-Agent": "GCCFamilyDiscovery/1.0"}

def wiki_search(query: str, limit: int = 10, lang: str = "en") -> list[dict]:
    base = f"https://{lang}.wikipedia.org/w/api.php"
    url = base + "?" + urllib.parse.urlencode({
        "action": "query", "list": "search",
        "srsearch": query, "format": "json", "srlimit": str(limit),
    })
    req = urllib.request.Request(url, headers=HEADERS)
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return json.loads(resp.read()).get("query", {}).get("search", [])
    except Exception:
        return []


def wiki_article(title: str, lang: str = "en") -> str:
    base = f"https://{lang}.wikipedia.org/w/api.php"
    url = base + "?" + urllib.parse.urlencode({
        "action": "query", "titles": title,
        "prop": "extracts", "explaintext": "1", "format": "json",
    })
    req = urllib.request.Request(url, headers=HEADERS)
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            pages = json.loads(resp.read()).get("query", {}).get("pages", {})
            for page in pages.values():
                return page.get("extract", "")
    except Exception:
        return ""
    return ""


def wiki_links(title: str, limit: int = 500) -> list[str]:
    """Get all internal links from a Wikipedia article."""
    url = "https://en.wikipedia.org/w/api.php?" + urllib.parse.urlencode({
        "action": "query", "titles": title,
        "prop": "links", "pllimit": str(limit), "format": "json",
    })
    req = urllib.request.Request(url, headers=HEADERS)
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            pages = json.loads(resp.read()).get("query", {}).get("pages", {})
            for page in pages.values():
                return [l["title"] for l in page.get("links", [])]
    except Exception:
        return []
    return []


def wiki_category_members(category: str, limit: int = 500) -> list[str]:
    """Get members of a Wikipedia category."""
    url = "https://en.wikipedia.org/w/api.php?" + urllib.parse.urlencode({
        "action": "query", "list": "categorymembers",
        "cmtitle": f"Category:{category}",
        "cmlimit": str(limit), "cmtype": "page", "format": "json",
    })
    req = urllib.request.Request(url, headers=HEADERS)
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            members = json.loads(resp.read()).get("query", {}).get("categorymembers", [])
            return [m["title"] for m in members]
    except Exception:
        return []


# ── Family name extraction ───────────────────────────────────────────────

# Patterns that indicate a family/dynasty/house
FAMILY_PATTERNS = [
    r'\bAl[- ]([A-Z][a-z]+(?:\s[A-Z][a-z]+)?)\b',  # Al Hokair, Al Futtaim
    r'\bHouse of ([A-Z][a-z]+)\b',
    r'\b([A-Z][a-z]+ family)\b',
    r'\bBin ([A-Z][a-z]+) family\b',
    r'\b([A-Z][a-z]+) Group\b',  # business groups
]

# Known major GCC families to seed discovery
SEED_FAMILIES = {
    # Saudi Arabia - major business/political families
    "Saudi Arabia": [
        "Al Hokair", "Al Othaim", "Al Jomaih", "Al Tayyar", "Al Babtain",
        "Al Turki", "Bin Mahfouz", "Al Juffali", "Al Jameel", "Al Zamil",
        "Al Dossary", "Al Qassim", "Al Faisal", "Al Angari", "Al Rasheed",
        "Al Fraih", "Al Mojil", "Al Rabiah", "Al Naghi", "Al Amoudi",
        "Al Sulaiman", "Al Khorayef", "Al Saif", "Al Rashed",
        "Al Hamrani", "Al Rughaib", "Al Khaldi", "Bugshan",
        "Al Nahdi", "Al Bawardi", "Al Zamel", "Al Ballaa",
        "Al Taweel", "Al Sayari", "Al Habib", "Al Omran",
        "Binzagr", "Banaja", "Al Obeikan", "Al Kanhal",
    ],
    # UAE - major business/political families
    "United Arab Emirates": [
        "Al Masaood", "Al Nowais", "Al Sayegh", "Al Mazrouei", "Al Mulla",
        "Al Naboodah", "Al Ansari", "Al Serkal", "Al Rostamani",
        "Al Banna", "Al Majid", "Al Qassimi", "Al Mualla",
        "Al Sharqi", "Al Nuaimi", "Al Zaabi", "Al Ketbi",
        "Al Bwardy", "Al Owais", "Al Darmaki",
        "Galadari", "Al Tayer", "Al Shirawi",
        "Juma Al Majid", "Lootah", "Al Sari",
        "Al Shamsi", "Al Kaabi",
    ],
    # Kuwait - major business/political families
    "Kuwait": [
        "Al Kharafi", "Al Ghanim", "Al Bahar", "Al Humaidhi",
        "Al Saqer", "Al Rumi", "Al Mudhaf", "Al Bader",
        "Al Marzouq", "Al Khaled", "Al Wazzan", "Al Nisf",
        "Al Shaya", "Al Hamad", "Behbehani", "Alghanim",
        "Al Kazemi", "Al Qattan", "Al Roumi",
        "Al Failakawi", "Al Adsani", "Al Kandari",
    ],
    # Bahrain - major business/political families
    "Bahrain": [
        "Kanoo", "Al Zayani", "Al Moayyed", "Fakhroo",
        "Al Aali", "Al Koohejji", "Al Jalahma", "Jawad",
        "Nass", "Al Mannai", "Al Hawaj",
        "Al Shirawi", "Al Baharna", "Al Maskati",
    ],
    # Qatar - major business/political families
    "Qatar": [
        "Al Fardan", "Al Mana", "Al Mannai", "Al Muftah",
        "Al Misnad", "Al Darwish", "Al Attiyah", "Al Binali",
        "Al Maadheed", "Al Sulaiti", "Al Kaabi",
        "Al Nasr", "Al Jaidah", "Al Kuwari",
        "Al Emadi", "Al Khater", "Al Marri",
    ],
    # Oman - major business/political families
    "Oman": [
        "Al Shanfari", "Al Zubair", "Al Hashar", "Al Rawas",
        "Al Ghazali", "Al Barwani", "Al Lawati", "Al Kharusi",
        "Al Maskari", "Al Mahrouqi", "Al Balushi",
        "Bahwan", "Khimji", "Towell",
    ],
}


def normalize_id(name: str) -> str:
    """Convert a family name to a standardized ID."""
    name = name.strip()
    name = re.sub(r'\s*\(.*?\)\s*', '', name)  # Remove parenthetical
    name = re.sub(r'\s*family\s*$', '', name, flags=re.IGNORECASE)
    name = name.lower()
    name = re.sub(r"[''`]", '', name)
    name = re.sub(r'[^a-z0-9\s-]', '', name)
    name = re.sub(r'\s+', '_', name.strip())
    return name


def extract_families_from_article(text: str) -> list[str]:
    """Extract family names from Wikipedia article text."""
    families = set()
    for pattern in FAMILY_PATTERNS:
        for match in re.finditer(pattern, text):
            name = match.group(1) if match.lastindex else match.group(0)
            if len(name) > 2 and len(name) < 40:
                families.add(name)
    return list(families)


# ── Wikipedia list mining ────────────────────────────────────────────────

WIKI_SOURCES = [
    # Category pages
    ("category", "Saudi Arabian families"),
    ("category", "Emirati families"),
    ("category", "Kuwaiti families"),
    ("category", "Bahraini families"),
    ("category", "Qatari families"),
    ("category", "Omani families"),
    ("category", "Saudi Arabian businesspeople"),
    ("category", "Emirati businesspeople"),
    ("category", "Kuwaiti businesspeople"),
    ("category", "Ruling families of the Arabian Peninsula"),
    ("category", "Arab dynasties"),
    # Article pages with family lists
    ("article", "List of billionaires from the Middle East"),
    ("article", "Economy of Saudi Arabia"),
    ("article", "Economy of the United Arab Emirates"),
    ("article", "Economy of Kuwait"),
    ("article", "Economy of Bahrain"),
    ("article", "Economy of Qatar"),
    ("article", "Economy of Oman"),
    ("article", "List of Saudis"),
    ("article", "List of Emiratis"),
    ("article", "Families of Kuwait"),
    ("article", "Dubai"),
    ("article", "Abu Dhabi"),
    ("article", "Riyadh"),
    ("article", "Jeddah"),
    ("article", "Dammam"),
    ("article", "Doha"),
    ("article", "Manama"),
    ("article", "Muscat, Oman"),
    ("article", "Kuwait City"),
    ("article", "Pearl diving in the Persian Gulf"),
    ("article", "History of the United Arab Emirates"),
    ("article", "History of Saudi Arabia"),
]


def discover_from_wikipedia() -> dict[str, dict]:
    """Mine Wikipedia for GCC family names."""
    discovered = {}

    for source_type, source_name in WIKI_SOURCES:
        print(f"  Mining {source_type}: {source_name}...", end=" ", flush=True)
        time.sleep(0.3)

        if source_type == "category":
            members = wiki_category_members(source_name)
            for title in members:
                # Extract "Al X" patterns from page titles
                name_clean = re.sub(r'\s*\(.*?\)', '', title).strip()
                if any(name_clean.lower().startswith(p) for p in ("al ", "al-", "house of ", "bin ")):
                    fid = normalize_id(name_clean)
                    if fid and fid not in discovered:
                        discovered[fid] = {"name": name_clean, "source": f"wiki:{source_name}"}
            print(f"{len(members)} pages")

        elif source_type == "article":
            text = wiki_article(source_name)
            if text:
                families = extract_families_from_article(text)
                for name in families:
                    fid = normalize_id(name)
                    if fid and fid not in discovered:
                        discovered[fid] = {"name": name, "source": f"wiki:{source_name}"}
                print(f"{len(families)} names")
            else:
                print("no text")

    return discovered


def discover_from_seeds() -> dict[str, dict]:
    """Create entries from our seed list of known families."""
    discovered = {}
    for country, families in SEED_FAMILIES.items():
        for name in families:
            fid = normalize_id(name)
            if fid:
                discovered[fid] = {
                    "name": name,
                    "country": country,
                    "source": "seed_list",
                }
    return discovered


def search_wikipedia_for_family_info(name: str) -> dict:
    """Quick Wikipedia check to get basic info about a family."""
    results = wiki_search(f"{name} family Arabian Gulf", limit=3)
    for r in results:
        title = r["title"].lower()
        name_lower = name.lower().replace("al ", "").replace("al-", "")
        if name_lower in title:
            snippet = r.get("snippet", "")
            snippet = re.sub(r'<[^>]+>', '', snippet)
            return {"wiki_title": r["title"], "snippet": snippet}
    return {}


# ── Main ─────────────────────────────────────────────────────────────────

def main():
    # Load existing families
    families = json.loads((DATA_DIR / "families.json").read_text())
    existing_ids = {f["id"] for f in families}
    existing_names = {f["name"].lower() for f in families}
    print(f"Existing families: {len(families)}")

    # Also check tribes (some "families" are actually tribes or overlap)
    tribes = json.loads((DATA_DIR / "tribes.json").read_text())
    tribe_ids = {t["id"] for t in tribes}
    tribe_names = {t["name"].lower() for t in tribes}

    # Discover families
    print("\n1. Mining Wikipedia...")
    wiki_discovered = discover_from_wikipedia()

    print(f"\n2. Adding seed families...")
    seed_discovered = discover_from_seeds()

    # Merge: seeds take priority (have country info)
    all_discovered = {}
    all_discovered.update(wiki_discovered)
    all_discovered.update(seed_discovered)

    print(f"\nTotal discovered: {len(all_discovered)}")

    # Build fuzzy match sets for dedup
    # "House of Nahyan" -> "al_nahyan", "House of Maktoum" -> "al_maktoum" etc.
    existing_name_variants = set()
    for f in families:
        n = f["name"].lower()
        existing_name_variants.add(n)
        # Add without "Al " prefix
        if n.startswith("al "):
            existing_name_variants.add(n[3:])
        # Add "house of X" variant
        if n.startswith("al "):
            existing_name_variants.add(f"house of {n[3:]}")
            existing_name_variants.add(f"house of al {n[3:]}")

    # Filter out existing
    new_families = {}
    skipped_existing = 0
    skipped_tribe = 0
    skipped_short = 0

    for fid, info in all_discovered.items():
        # Skip if already exists (exact or fuzzy)
        name_lower = info["name"].lower()
        name_stripped = re.sub(r'^(house of |al[- ]|bani |aal )', '', name_lower).strip()
        if (fid in existing_ids or name_lower in existing_names
                or name_lower in existing_name_variants
                or f"al_{name_stripped.replace(' ', '_')}" in existing_ids
                or name_stripped.replace(' ', '_') in existing_ids):
            skipped_existing += 1
            continue

        # Skip if it's a tribe
        if fid in tribe_ids or name_lower in tribe_names:
            skipped_tribe += 1
            continue

        # Skip very short names (likely false positives)
        if len(fid) < 3:
            skipped_short += 1
            continue

        # Skip common non-family words and place names
        skip_words = {"the", "and", "for", "from", "with", "this", "that", "into", "over",
                      "city", "state", "gulf", "arab", "saudi", "united", "king", "prince",
                      "list", "history", "economy", "culture", "road", "island", "bridge",
                      "airport", "museum", "palace", "mosque", "stadium", "park", "mall",
                      "tower", "port", "beach", "school", "hospital", "university",
                      "club", "sports", "football", "basketball", "air", "media",
                      "district", "village", "region", "street", "tunnel", "refinery"}
        if fid in skip_words:
            continue

        # Skip entries that look like places, buildings, or organizations (not families)
        name_lower = info["name"].lower()
        place_indicators = [
            "road", "street", "bridge", "island", "district", "region", "beach",
            "stadium", "park", "mall", "tower", "port", "airport", "corniche",
            "tunnel", "refinery", "palace", "mosque", "hospital", "school",
            "university", "museum", "fort", "library", "village", "city",
            "club", "training", "media", "sports", "english", "arabic",
            "documentary", "holdings", "holding", "collection", "group",
            "archaeological", "theatrical", "cultural", "complex",
        ]
        if any(p in name_lower for p in place_indicators):
            continue

        # Skip IDs that end with common non-family suffixes
        bad_suffixes = ["_road", "_street", "_bridge", "_island", "_district",
                        "_region", "_beach", "_stadium", "_park", "_mall", "_tower",
                        "_port", "_airport", "_air", "_club", "_one", "_dar",
                        "_bait", "_al", "_the", "_international"]
        if any(fid.endswith(s) for s in bad_suffixes):
            continue

        # Skip entries that look like "FirstName LastName" (individual people, not families)
        # These come from Wikipedia lists of businesspeople
        name_parts = info["name"].split()
        if len(name_parts) == 2 and not name_parts[0].lower().startswith("al") and not name_parts[0].lower().startswith("bin"):
            # Likely a person name, not a family
            continue

        # Skip very generic single words that aren't prefixed with "Al"
        if len(name_parts) == 1 and not info.get("country"):
            # Single word from Wikipedia extraction — likely noise unless from seed list
            if info.get("source", "").startswith("wiki:"):
                continue

        new_families[fid] = info

    print(f"  Skipped (already exists): {skipped_existing}")
    print(f"  Skipped (is a tribe): {skipped_tribe}")
    print(f"  Skipped (too short): {skipped_short}")
    print(f"  New families to add: {len(new_families)}")

    if DRY_RUN:
        print("\n--- DRY RUN - Would add these families: ---")
        by_country = defaultdict(list)
        for fid, info in sorted(new_families.items()):
            country = info.get("country", "Unknown")
            by_country[country].append(f"  {fid}: {info['name']}")

        for country in sorted(by_country.keys()):
            print(f"\n{country}:")
            for line in sorted(by_country[country]):
                print(line)
        return

    # Quick Wikipedia validation pass — check which ones actually have Wikipedia presence
    print("\n3. Validating families against Wikipedia...")
    validated = []
    for i, (fid, info) in enumerate(new_families.items()):
        if i % 20 == 0 and i > 0:
            print(f"  Validated {i}/{len(new_families)}...")
        wiki_info = search_wikipedia_for_family_info(info["name"])
        info["wiki_info"] = wiki_info
        validated.append((fid, info))
        time.sleep(0.15)

    # Create skeleton entries
    print(f"\n4. Creating {len(validated)} skeleton entries...")
    new_entries = []
    for fid, info in validated:
        entry = {
            "id": fid,
            "name": info["name"],
            "nameAr": None,
            "tribeId": None,
            "familyType": None,
            "isRuling": 0,
            "rulesOver": None,
            "currentHead": None,
            "foundedYear": None,
            "originStory": None,
            "legitimacyBasis": None,
            "description": info.get("wiki_info", {}).get("snippet") or f"{info['name']} — a GCC family.",
            "notableFigures": [],
            "connections": [],
            "migrationPath": [],
            "timelineEvents": [],
            "tribalOrigin": None,
            "history": None,
            "modernStatus": None,
            "folkLegends": [],
            "nameEtymology": None,
        }
        new_entries.append(entry)

    # Add to families.json
    families.extend(new_entries)
    (DATA_DIR / "families.json").write_text(
        json.dumps(families, indent=2, ensure_ascii=False) + "\n"
    )

    print(f"\nDone! Added {len(new_entries)} new families.")
    print(f"Total families now: {len(families)}")

    # Write a list of new IDs for the enrichment pipeline
    new_ids_file = DATA_DIR / "new_family_ids.json"
    new_ids_file.write_text(json.dumps([fid for fid, _ in validated], indent=2) + "\n")
    print(f"New family IDs saved to {new_ids_file}")


if __name__ == "__main__":
    main()
