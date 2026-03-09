#!/usr/bin/env python3
"""
Deep family discovery v2 — mines graph orphans, connection references,
Wikipedia categories (EN + AR), Forbes/business lists, stock exchange listings.

Usage: python discover-families-v2.py [--dry-run]
"""

import json
import re
import sys
import time
import urllib.request
import urllib.parse
from pathlib import Path
from collections import defaultdict

DATA_DIR = Path(__file__).resolve().parents[1] / "src" / "data"
DRY_RUN = "--dry-run" in sys.argv

HEADERS = {"User-Agent": "GCCFamilyDiscovery/2.0"}


def wiki_search(query, limit=10, lang="en"):
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


def wiki_category_members(category, limit=500, lang="en"):
    base = f"https://{lang}.wikipedia.org/w/api.php"
    url = base + "?" + urllib.parse.urlencode({
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


def wiki_article(title, lang="en"):
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


def normalize_id(name):
    name = name.strip()
    name = re.sub(r'\s*\(.*?\)\s*', '', name)
    name = re.sub(r'\s*family\s*$', '', name, flags=re.IGNORECASE)
    name = name.lower()
    name = re.sub(r"[''`]", '', name)
    name = re.sub(r'[^a-z0-9\s-]', '', name)
    name = re.sub(r'\s+', '_', name.strip())
    return name


def is_junk_name(name, fid):
    """Filter out non-family entries."""
    name_lower = name.lower()

    # Place/building indicators
    place_words = [
        "road", "street", "bridge", "island", "district", "region", "beach",
        "stadium", "park", "mall", "tower", "port", "airport", "corniche",
        "tunnel", "refinery", "palace", "mosque", "hospital", "school",
        "university", "museum", "fort", "library", "village", "city",
        "club", "training", "media", "sports", "english", "arabic",
        "documentary", "holdings", "holding", "collection", "group",
        "archaeological", "theatrical", "cultural", "complex",
        "province", "governorate", "municipality", "neighborhood",
        "mountain", "desert", "oasis", "valley", "river", "lake",
        "airline", "petroleum", "company", "corporation", "bank",
        "exchange", "market", "exchange", "authority", "ministry",
        "council", "committee", "association", "federation", "league",
        "championship", "tournament", "cup",
    ]
    if any(p in name_lower for p in place_words):
        return True

    bad_suffixes = ["_road", "_street", "_bridge", "_island", "_district",
                    "_region", "_beach", "_stadium", "_park", "_mall", "_tower",
                    "_port", "_airport", "_air", "_club", "_one", "_dar",
                    "_bait", "_al", "_the", "_international", "_province",
                    "_governorate", "_oasis", "_valley"]
    if any(fid.endswith(s) for s in bad_suffixes):
        return True

    # Generic words
    skip_words = {"the", "and", "for", "from", "with", "this", "that", "into", "over",
                  "city", "state", "gulf", "arab", "saudi", "united", "king", "prince",
                  "list", "history", "economy", "culture", "people", "dynasty_of"}
    if fid in skip_words:
        return True

    # Skip entries with underscored "FirstName_LastName" pattern (people, not families)
    parts = fid.split('_')
    if len(parts) == 2 and not parts[0].startswith('al') and not parts[0] in ('bin', 'bani', 'house', 'ba', 'bu'):
        # Likely a person "firstname_lastname" not a family
        return True

    # Skip single generic words that aren't prefixed with al/bin
    if '_' not in fid and not any(fid.startswith(p) for p in ('al', 'bin', 'ba', 'bu')):
        # Single generic word — very likely junk unless it's a known family name format
        if len(fid) < 6:
            return True

    return False


# ── Source 1: Graph orphans ──────────────────────────────────────────────

def discover_from_graph_orphans(families, tribes, graph):
    """Find family-type nodes in graph.json that don't exist in families.json."""
    family_ids = {f['id'] for f in families}
    tribe_ids = {t['id'] for t in tribes}
    all_ids = family_ids | tribe_ids

    discovered = {}
    for n in graph['nodes']:
        if n['id'] in all_ids:
            continue
        if n.get('type') == 'family':
            fid = n['id']
            name = n.get('name', fid.replace('_', ' ').title())
            discovered[fid] = {"name": name, "source": "graph_orphan"}
    return discovered


# ── Source 2: Connection references ──────────────────────────────────────

def discover_from_connections(families, tribes):
    """Find entities referenced in connections but not in data."""
    family_ids = {f['id'] for f in families}
    tribe_ids = {t['id'] for t in tribes}
    all_ids = family_ids | tribe_ids

    discovered = {}
    for f in families:
        for conn in f.get('connections', []):
            eid = conn.get('entityId', '')
            etype = conn.get('entityType', '')
            if eid and eid not in ('<UNKNOWN>', '') and eid not in all_ids and etype == 'family':
                name = eid.replace('_', ' ').title()
                # Clean up common patterns
                name = re.sub(r'\bFamily$', '', name).strip()
                discovered[eid] = {"name": name, "source": f"connection_ref:{f['name']}"}
    return discovered


# ── Source 3: Extended Wikipedia mining ──────────────────────────────────

WIKI_CATEGORIES_EN = [
    # Direct family categories
    "Saudi Arabian families",
    "Emirati families",
    "Kuwaiti families",
    "Bahraini families",
    "Qatari families",
    "Omani families",
    "Royal houses of the Middle East",
    "Merchant families",
    # Businesspeople (extract family names)
    "Saudi Arabian businesspeople",
    "Emirati businesspeople",
    "Kuwaiti businesspeople",
    "Bahraini businesspeople",
    "Qatari businesspeople",
    "Omani businesspeople",
    "Saudi Arabian billionaires",
    "Emirati billionaires",
    "Kuwaiti billionaires",
    # Politicians
    "Saudi Arabian politicians",
    "Emirati politicians",
    "Kuwaiti politicians",
    "Bahraini politicians",
    "Qatari politicians",
    "Members of the Consultative Assembly of Saudi Arabia",
    # Historical
    "Arab dynasties",
    "Arabian Peninsula dynasties",
    "History of the Persian Gulf",
    "Dynasties of Bahrain",
]

WIKI_CATEGORIES_AR = [
    # Arabic categories
    "عائلات سعودية",  # Saudi families
    "عائلات إماراتية",  # Emirati families
    "عائلات كويتية",  # Kuwaiti families
    "عائلات بحرينية",  # Bahraini families
    "عائلات قطرية",  # Qatari families
    "أسر حاكمة عربية",  # Arab ruling families
    "تجار سعوديون",  # Saudi merchants
    "رجال أعمال إماراتيون",  # Emirati businessmen
    "رجال أعمال سعوديون",  # Saudi businessmen
    "رجال أعمال كويتيون",  # Kuwaiti businessmen
]

WIKI_ARTICLES = [
    # List articles
    "List of billionaires from the Middle East",
    "List of wealthiest families",
    "Economy of Saudi Arabia",
    "Economy of the United Arab Emirates",
    "Economy of Kuwait",
    "Economy of Bahrain",
    "Economy of Qatar",
    "Economy of Oman",
    "List of Saudis",
    "List of Emiratis",
    "List of Kuwaitis",
    "List of Bahrainis",
    "Families of Kuwait",
    # Cities
    "Dubai", "Abu Dhabi", "Riyadh", "Jeddah", "Dammam", "Doha", "Manama",
    "Kuwait City", "Muscat, Oman", "Sharjah", "Ajman", "Ras Al Khaimah",
    "Fujairah", "Umm Al Quwain", "Al Ain", "Khobar", "Dhahran",
    "Mecca", "Medina", "Tabuk", "Jizan", "Najran",
    # History
    "History of the United Arab Emirates",
    "History of Saudi Arabia",
    "History of Kuwait",
    "History of Bahrain",
    "History of Qatar",
    "History of Oman",
    "Pearl diving in the Persian Gulf",
    "Trucial States",
    "British Residency of the Persian Gulf",
    # Business
    "Saudi Stock Exchange",
    "Dubai Financial Market",
    "Abu Dhabi Securities Exchange",
    "Kuwait Stock Exchange",
    "Bahrain Bourse",
    "Qatar Stock Exchange",
    "Muscat Securities Market",
    # Specific family/dynasty articles
    "House of Saud",
    "Al Nahyan",
    "Al Maktoum",
    "House of Khalifa",
    "House of Thani",
    "Al-Sabah",
    "Al Said dynasty",
    "Bani Yas",
    "Al Qasimi",
]

FAMILY_PATTERNS = [
    r'\bAl[- ]([A-Z][a-z]+(?:\s[A-Z][a-z]+)?)\b',
    r'\bHouse of ([A-Z][a-z]+(?:\s[A-Z][a-z]+)?)\b',
    r'\bBin ([A-Z][a-z]+)\s+family\b',
    r'\b([A-Z][a-z]+) [Ff]amily\b',
    r'\bAal ([A-Z][a-z]+)\b',
]


def extract_family_names(text):
    families = set()
    for pattern in FAMILY_PATTERNS:
        for match in re.finditer(pattern, text):
            name = match.group(1) if match.lastindex else match.group(0)
            if 2 < len(name) < 40:
                families.add(name)
    return list(families)


def discover_from_wikipedia():
    discovered = {}

    # English categories
    for cat in WIKI_CATEGORIES_EN:
        print(f"  EN cat: {cat}...", end=" ", flush=True)
        time.sleep(0.2)
        members = wiki_category_members(cat)
        count = 0
        for title in members:
            name_clean = re.sub(r'\s*\(.*?\)', '', title).strip()
            if any(name_clean.lower().startswith(p) for p in ("al ", "al-", "house of ", "bin ", "aal ")):
                fid = normalize_id(name_clean)
                if fid and fid not in discovered:
                    discovered[fid] = {"name": name_clean, "source": f"wiki_cat:{cat}"}
                    count += 1
        print(f"{count} families from {len(members)} pages")

    # Arabic categories
    for cat in WIKI_CATEGORIES_AR:
        print(f"  AR cat: {cat}...", end=" ", flush=True)
        time.sleep(0.2)
        members = wiki_category_members(cat, lang="ar")
        count = 0
        for title in members:
            # Arabic titles need different extraction
            # Look for آل (Aal) or عائلة (family) patterns
            if any(title.startswith(p) for p in ("آل ", "بيت ", "أسرة ")):
                # Try to find English equivalent via search
                en_results = wiki_search(title, limit=1)
                if en_results:
                    en_name = en_results[0]["title"]
                    fid = normalize_id(en_name)
                    if fid:
                        discovered[fid] = {"name": en_name, "source": f"wiki_ar:{cat}"}
                        count += 1
        print(f"{count} families from {len(members)} pages")

    # Article text mining
    for article in WIKI_ARTICLES:
        print(f"  Article: {article}...", end=" ", flush=True)
        time.sleep(0.3)
        text = wiki_article(article)
        if text:
            families = extract_family_names(text)
            count = 0
            for name in families:
                fid = normalize_id(name)
                if fid and fid not in discovered:
                    discovered[fid] = {"name": name, "source": f"wiki_article:{article}"}
                    count += 1
            print(f"{count} new names")
        else:
            print("no text")

    return discovered


# ── Source 4: Expanded seed list ─────────────────────────────────────────

SEED_FAMILIES = {
    "Saudi Arabia": [
        # Major business families
        "Al Hokair", "Al Othaim", "Al Jomaih", "Al Tayyar", "Al Babtain",
        "Al Turki", "Bin Mahfouz", "Al Juffali", "Al Jameel", "Al Zamil",
        "Al Dossary", "Al Qassim", "Al Faisal", "Al Angari", "Al Rasheed",
        "Al Fraih", "Al Mojil", "Al Rabiah", "Al Naghi", "Al Amoudi",
        "Al Sulaiman", "Al Khorayef", "Al Saif", "Al Rashed",
        "Al Hamrani", "Al Rughaib", "Al Khaldi", "Bugshan",
        "Al Nahdi", "Al Bawardi", "Al Zamel", "Al Ballaa",
        "Al Taweel", "Al Sayari", "Al Habib", "Al Omran",
        "Binzagr", "Banaja", "Al Obeikan", "Al Kanhal",
        # More Saudi families
        "Al Sudairi", "Al Ibrahim", "Al Sheikh", "Al Sulaim",
        "Al Tuwaijri", "Al Humaidan", "Al Anqari", "Al Bassam",
        "Al Muqbil", "Al Muqrin", "Al Jubeir", "Al Falih",
        "Al Swailem", "Al Harbi", "Kashoggi", "Al Aiban",
        "Al Issa", "Al Nahedh", "Al Mubarak", "Al Twaijri",
        "Al Shathri", "Al Moajil", "Al Quraishi", "Al Mishari",
        "Dallah", "Al Zahrani", "Al Dosari", "Sharbatly",
        "Olayan", "Bin Laden", "Al Khereiji", "Al Mady",
        "Al Marshad", "Al Saghyir", "Al Fozan", "Al Essa",
        "Kaaki", "Bugshan", "Jamjoom", "Fitaihi",
        "Al Sabbagh", "Nazer", "Pharaon", "Akeel",
    ],
    "United Arab Emirates": [
        "Al Masaood", "Al Nowais", "Al Sayegh", "Al Mazrouei", "Al Mulla",
        "Al Naboodah", "Al Ansari", "Al Serkal", "Al Rostamani",
        "Al Banna", "Al Majid", "Al Qassimi", "Al Mualla",
        "Al Sharqi", "Al Nuaimi", "Al Zaabi", "Al Ketbi",
        "Al Bwardy", "Al Owais", "Al Darmaki",
        "Galadari", "Al Tayer", "Al Shirawi",
        "Lootah", "Al Sari",
        "Al Shamsi", "Al Kaabi",
        # More UAE families
        "Al Habtoor", "Al Futtaim", "Al Ghurair", "Al Gurg",
        "Al Mansoori", "Al Rumaithi", "Al Dhaheri", "Al Suwaidi",
        "Al Hammadi", "Al Marri", "Al Mheiri", "Al Qubaisi",
        "Al Balooshi", "Al Neyadi", "Al Hosani", "Al Katheeri",
        "Juma Al Majid", "Al Jaber", "Al Otaiba",
        "Al Mubarak", "Al Dahbashi", "Al Falasi", "Al Falahi",
        "Khalaf Al Habtoor", "Abdulla Al Ghurair",
        "Al Maktoum", "Al Nahyan",
    ],
    "Kuwait": [
        "Al Kharafi", "Al Ghanim", "Al Bahar", "Al Humaidhi",
        "Al Saqer", "Al Rumi", "Al Mudhaf", "Al Bader",
        "Al Marzouq", "Al Khaled", "Al Wazzan", "Al Nisf",
        "Al Shaya", "Al Hamad", "Behbehani", "Alghanim",
        "Al Kazemi", "Al Qattan", "Al Roumi",
        "Al Failakawi", "Al Adsani", "Al Kandari",
        # More Kuwait
        "Al Sabah", "Al Jassim", "Al Saleh", "Marafi",
        "Al Awadhi", "Al Mutairi", "Al Enezi", "Al Ajmi",
        "Al Rashidi", "Al Brahim", "Al Muhailan",
        "Khedouri", "Zilkha", "Al Babtain",
        "Al Nafisi", "Al Sanea", "Al Fulaij",
        "Al Essa", "Al Sayer", "Al Mulla",
    ],
    "Bahrain": [
        "Kanoo", "Al Zayani", "Al Moayyed", "Fakhroo",
        "Al Aali", "Al Koohejji", "Al Jalahma", "Jawad",
        "Nass", "Al Mannai", "Al Hawaj",
        "Al Shirawi", "Al Baharna", "Al Maskati",
        # More Bahrain
        "Al Khalifa", "Al Mahroos", "Al Wazzan", "Zainal",
        "Al Fakhro", "Al Arayed", "Al Qassab", "Hasan",
        "Al Alawi", "Al Shakar", "Al Mahooz",
        "Kooheji", "Dadabhai", "Al Matrook",
        "Al Kooheji", "Al Musallam", "Al Mahmeed",
        "Al Tajir", "Al Basti", "Trafco",
    ],
    "Qatar": [
        "Al Fardan", "Al Mana", "Al Mannai", "Al Muftah",
        "Al Misnad", "Al Darwish", "Al Attiyah", "Al Binali",
        "Al Maadheed", "Al Sulaiti", "Al Kaabi",
        "Al Nasr", "Al Jaidah", "Al Kuwari",
        "Al Emadi", "Al Khater", "Al Marri",
        # More Qatar
        "Al Thani", "Al Muraikhi", "Al Khayarin",
        "Al Dosari", "Al Hajri", "Al Naimi",
        "Al Nuaimi", "Al Mohannadi", "Al Abdulghani",
        "Al Khulaifi", "Al Baker", "Al Maadheed",
        "Al Jaida", "Nasser Bin Khaled",
    ],
    "Oman": [
        "Al Shanfari", "Al Zubair", "Al Hashar", "Al Rawas",
        "Al Ghazali", "Al Barwani", "Al Lawati", "Al Kharusi",
        "Al Maskari", "Al Mahrouqi", "Al Balushi",
        "Bahwan", "Khimji", "Towell",
        # More Oman
        "Al Said", "Al Busaidi", "Al Harthi",
        "Al Wahaibi", "Al Hinai", "Al Jabri",
        "Al Nabhani", "Al Riyami", "Al Rashdi",
        "Al Siyabi", "Muscat families",
        "Al Zadjali", "Al Ismaili", "Al Mukhaini",
    ],
}


def discover_from_seeds():
    discovered = {}
    for country, families in SEED_FAMILIES.items():
        for name in families:
            fid = normalize_id(name)
            if fid:
                discovered[fid] = {"name": name, "country": country, "source": "seed_list"}
    return discovered


def quick_wiki_check(name):
    results = wiki_search(f"{name} family Arabian Gulf", limit=3)
    for r in results:
        name_lower = name.lower().replace("al ", "").replace("al-", "")
        if name_lower in r["title"].lower():
            snippet = r.get("snippet", "")
            snippet = re.sub(r'<[^>]+>', '', snippet)
            return {"wiki_title": r["title"], "snippet": snippet}
    return {}


# ── Main ─────────────────────────────────────────────────────────────────

def main():
    families = json.loads((DATA_DIR / "families.json").read_text())
    tribes = json.loads((DATA_DIR / "tribes.json").read_text())
    graph = json.loads((DATA_DIR / "graph.json").read_text())

    existing_ids = {f["id"] for f in families}
    tribe_ids = {t["id"] for t in tribes}
    existing_names = {f["name"].lower() for f in families}

    # Build fuzzy match sets
    existing_variants = set()
    for f in families:
        n = f["name"].lower()
        existing_variants.add(n)
        if n.startswith("al "):
            existing_variants.add(n[3:])
            existing_variants.add(f"house of {n[3:]}")
            existing_variants.add(f"house of al {n[3:]}")

    print(f"Existing families: {len(families)}")
    print(f"Existing tribes: {len(tribes)}")

    # Discover from all sources
    print("\n=== Source 1: Graph orphans ===")
    graph_discovered = discover_from_graph_orphans(families, tribes, graph)
    print(f"  Found: {len(graph_discovered)}")

    print("\n=== Source 2: Connection references ===")
    conn_discovered = discover_from_connections(families, tribes)
    print(f"  Found: {len(conn_discovered)}")

    print("\n=== Source 3: Wikipedia (EN + AR) ===")
    wiki_discovered = discover_from_wikipedia()
    print(f"  Found: {len(wiki_discovered)}")

    print("\n=== Source 4: Seed lists ===")
    seed_discovered = discover_from_seeds()
    print(f"  Found: {len(seed_discovered)}")

    # Merge all sources (seeds and graph orphans take priority)
    all_discovered = {}
    all_discovered.update(wiki_discovered)
    all_discovered.update(conn_discovered)
    all_discovered.update(graph_discovered)
    all_discovered.update(seed_discovered)

    print(f"\nTotal unique discovered: {len(all_discovered)}")

    # Filter
    new_families = {}
    skipped = {"existing": 0, "tribe": 0, "junk": 0}

    for fid, info in all_discovered.items():
        name_lower = info["name"].lower()
        name_stripped = re.sub(r'^(house of |al[- ]|bani |aal |bin )', '', name_lower).strip()

        # Already exists
        if (fid in existing_ids or name_lower in existing_names
                or name_lower in existing_variants
                or f"al_{name_stripped.replace(' ', '_')}" in existing_ids
                or name_stripped.replace(' ', '_') in existing_ids):
            skipped["existing"] += 1
            continue

        # Is a tribe
        if fid in tribe_ids or name_lower in {t["name"].lower() for t in tribes}:
            skipped["tribe"] += 1
            continue

        # Is junk
        if is_junk_name(info["name"], fid):
            skipped["junk"] += 1
            continue

        # Too short
        if len(fid) < 3:
            skipped["junk"] += 1
            continue

        # Wiki article extractions are very noisy — only keep "Al X" or "House of X" patterns
        if info.get("source", "").startswith("wiki_article:"):
            if not any(name_lower.startswith(p) for p in ("al ", "al-", "house of ", "bin ", "aal ")):
                skipped["junk"] += 1
                continue

        # Wiki category / AR extractions: filter out individual people (long names with "bin/bint")
        if info.get("source", "").startswith(("wiki_cat:", "wiki_ar:")):
            if any(w in name_lower for w in (" bin ", " bint ", " of saudi", " of qatar", " of bahrain", " of oman")):
                skipped["junk"] += 1
                continue

        # Skip entries that are clearly duplicates of existing (e.g. "al_kooheji" when "kooheji" exists)
        name_core = re.sub(r'^al_', '', fid)
        if name_core in existing_ids or f"al_{name_core}" in existing_ids:
            skipped["existing"] += 1
            continue

        # Skip "Khalaf Al Habtoor" type entries (person + family name)
        name_words = info["name"].split()
        if info.get("source") == "seed_list" and len(name_words) >= 3:
            # 3+ word names are often individuals, not family names
            # Unless it's "House of X" or "Nasser Bin Khaled" style
            if not name_lower.startswith("house of ") and "bin " not in name_lower:
                skipped["junk"] += 1
                continue

        # Hardcoded exclusions - duplicates/non-families
        exclude = {
            "al_nahyan_family", "al_saud_family", "al_qasimi_family",
            "house_saud", "bahrain_royal_family", "merchant_families_gulf",
            "al_bu", "al-maadeed", "muscat_families", "trafco",
            "akeel",  # too generic
        }
        if fid in exclude:
            skipped["junk"] += 1
            continue

        new_families[fid] = info

    print(f"\nFiltered:")
    for reason, count in skipped.items():
        print(f"  Skipped ({reason}): {count}")
    print(f"  New families to add: {len(new_families)}")

    if DRY_RUN:
        print("\n--- DRY RUN ---")
        by_source = defaultdict(list)
        for fid, info in sorted(new_families.items()):
            src = info.get("source", "unknown").split(":")[0]
            by_source[src].append(f"  {fid}: {info['name']}")

        for src in sorted(by_source.keys()):
            print(f"\nFrom {src} ({len(by_source[src])}):")
            for line in sorted(by_source[src]):
                print(line)
        return

    # Validate and create skeletons
    print(f"\nValidating {len(new_families)} families against Wikipedia...")
    new_entries = []
    for i, (fid, info) in enumerate(new_families.items()):
        if i % 20 == 0 and i > 0:
            print(f"  Validated {i}/{len(new_families)}...")
        wiki_info = quick_wiki_check(info["name"])
        time.sleep(0.12)

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
            "description": wiki_info.get("snippet") or f"{info['name']} — a GCC family.",
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

    families.extend(new_entries)
    (DATA_DIR / "families.json").write_text(
        json.dumps(families, indent=2, ensure_ascii=False) + "\n"
    )

    new_ids_file = DATA_DIR / "new_family_ids.json"
    new_ids_file.write_text(json.dumps([e["id"] for e in new_entries], indent=2) + "\n")

    print(f"\nDone! Added {len(new_entries)} new families.")
    print(f"Total families now: {len(families)}")


if __name__ == "__main__":
    main()
