#!/usr/bin/env python3
"""
Comprehensive family discovery v3 — uses Claude to systematically generate
family lists by country, city, tribe, and sector. Then deduplicates against
existing data and creates skeleton entries.

Usage: python discover-families-v3.py [--dry-run]
"""

import json
import os
import re
import sys
import time
import urllib.request
import urllib.error
import urllib.parse
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parents[1] / "src" / "data"
DRY_RUN = "--dry-run" in sys.argv

ENV_PATH = Path(__file__).resolve().parents[3] / "web" / ".env.local"
if not ENV_PATH.exists():
    ENV_PATH = Path(__file__).resolve().parents[1] / ".env.local"
if ENV_PATH.exists():
    for line in ENV_PATH.read_text().splitlines():
        if line.startswith("ANTHROPIC_API_KEY="):
            os.environ["ANTHROPIC_API_KEY"] = line.split("=", 1)[1].strip()

API_KEY = os.environ.get("ANTHROPIC_API_KEY")
if not API_KEY:
    print("ERROR: No ANTHROPIC_API_KEY found")
    sys.exit(1)

RATE_LIMIT_DELAY = 2.0


def call_claude(prompt, max_tokens=8000):
    data = json.dumps({
        "model": "claude-sonnet-4-20250514",
        "max_tokens": max_tokens,
        "messages": [{"role": "user", "content": prompt}]
    }).encode()
    req = urllib.request.Request(
        "https://api.anthropic.com/v1/messages", data=data,
        headers={
            "Content-Type": "application/json",
            "x-api-key": API_KEY,
            "anthropic-version": "2023-06-01",
        },
    )
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=120) as resp:
                return json.loads(resp.read())["content"][0]["text"]
        except urllib.error.HTTPError as e:
            e.read()
            if e.code in (429, 529):
                time.sleep(15 * (attempt + 1))
                continue
            print(f"  HTTP {e.code}")
            return None
        except Exception as ex:
            if attempt < 2:
                time.sleep(5)
                continue
            print(f"  Error: {ex}")
            return None
    return None


def parse_json_array(text):
    text = text.strip()
    if text.startswith("```"):
        text = text.split("\n", 1)[1] if "\n" in text else text[3:]
        text = text.rsplit("```", 1)[0]
    start = text.find("[")
    end = text.rfind("]") + 1
    if start >= 0 and end > start:
        try:
            return json.loads(text[start:end])
        except json.JSONDecodeError:
            fixed = re.sub(r',\s*]', ']', re.sub(r',\s*}', '}', text[start:end]))
            try:
                return json.loads(fixed)
            except Exception:
                return None
    return None


# ── Prompts ──────────────────────────────────────────────────────────────────

COUNTRY_PROMPT = """You are a comprehensive encyclopedia of Arabian Gulf families. List ALL notable families from {country} that you know of.

Include:
- Ruling/royal families and their branches
- Major merchant families (old and new money)
- Prominent business families
- Historical families with political significance
- Religious/scholarly families (e.g., Qadi families)
- Military/security families
- Families known for specific industries (real estate, trading, banking, retail, construction, hospitality, oil services)
- Lesser-known but established families that locals would recognize
- Families of non-Arab origin settled in {country} (Persian, Indian, Baloch, Hadrami, etc.)

Be EXHAUSTIVE. I need hundreds of families, not dozens. Include families from ALL cities and regions, not just the capital.
Think about every sector: banking, real estate, construction, retail, food, automotive, healthcare, education, media, telecom, shipping, aviation.
Think about historical families that may not be business-prominent today.
Think about families from smaller towns and rural areas too.

Return ONLY a JSON array of objects:
[
  {{"name": "Al Shalan", "country": "{country}", "city": "Riyadh", "type": "merchant", "note": "Brief 1-line description"}},
  ...
]

Valid types: ruling, merchant, religious, military, political, scholarly, tribal_leader, mixed
Give me EVERY family you can think of. Aim for at least 100 families."""


TRIBAL_PROMPT = """List ALL known family branches and notable family lines descended from or associated with the {tribe} tribe/confederation in the Arabian Gulf.

Many tribal families are known by "Al + family patriarch name" and are branches of larger tribes. Include:
- Sheikhy families (leading families of tribal sections)
- Notable branches that became independent family names
- Families that migrated to cities and became merchant/business families
- Families associated with this tribe in each GCC country

Return ONLY a JSON array:
[
  {{"name": "Al Shalan", "tribe": "{tribe}", "country": "Saudi Arabia", "note": "Brief description"}},
  ...
]

Be comprehensive. Include even smaller branches that locals would know."""


CITY_PROMPT = """List ALL notable families historically and currently associated with {city}, {country}.

Think about:
- Old merchant families from the souk/market
- Real estate developers
- Car dealership families
- Restaurant/hospitality families
- Gold/jewelry traders
- Import/export families
- Construction families
- Families in the pearl trade (historically)
- Families that settled from other regions
- Well-known local families that everyone in {city} would recognize

Return ONLY a JSON array:
[
  {{"name": "Al Shalan", "city": "{city}", "country": "{country}", "note": "Brief description"}},
  ...
]

Be exhaustive — aim for at least 50 families per major city."""


SECTOR_PROMPT = """List ALL prominent Arabian Gulf families known for their involvement in {sector}.

Cover all 6 GCC countries: Saudi Arabia, UAE, Kuwait, Bahrain, Qatar, Oman.
Include both well-known tycoon families AND mid-tier established business families.

Return ONLY a JSON array:
[
  {{"name": "Al Shalan", "country": "Saudi Arabia", "sector": "{sector}", "note": "Brief description"}},
  ...
]"""


# ── Discovery Runs ───────────────────────────────────────────────────────────

COUNTRIES = [
    "Saudi Arabia", "United Arab Emirates", "Kuwait", "Bahrain", "Qatar", "Oman"
]

MAJOR_TRIBES = [
    "Anizzah", "Shammar", "Bani Yas", "Bani Tamim", "Harb", "Otaibah",
    "Qahtan", "Dawasir", "Mutair", "Subai", "Ajman tribe", "Bani Khalid",
    "Bani Hajir", "Zaab", "Dhafeer", "Rashidi", "Bani Malik",
    "Shihuh", "Bani Kaab", "Awamir", "Manasir", "Mazrouei",
    "Naim", "Baluch tribes", "Hawala", "Bani Hajer",
]

MAJOR_CITIES = [
    ("Riyadh", "Saudi Arabia"),
    ("Jeddah", "Saudi Arabia"),
    ("Dammam/Eastern Province", "Saudi Arabia"),
    ("Mecca", "Saudi Arabia"),
    ("Medina", "Saudi Arabia"),
    ("Dubai", "United Arab Emirates"),
    ("Abu Dhabi", "United Arab Emirates"),
    ("Sharjah", "United Arab Emirates"),
    ("Al Ain", "United Arab Emirates"),
    ("Kuwait City", "Kuwait"),
    ("Manama", "Bahrain"),
    ("Muharraq", "Bahrain"),
    ("Doha", "Qatar"),
    ("Muscat", "Oman"),
    ("Salalah", "Oman"),
    ("Sohar", "Oman"),
]

SECTORS = [
    "automotive (car dealerships, agencies, spare parts)",
    "real estate and construction",
    "banking, finance, and exchange houses",
    "retail, supermarkets, and consumer goods",
    "gold, jewelry, and luxury goods",
    "hospitality, hotels, and restaurants",
    "oil services, petrochemicals, and energy",
    "shipping, logistics, and freight",
    "healthcare, pharmaceuticals, and medical",
    "food production, distribution, and agriculture",
    "technology, telecom, and media",
    "education and publishing",
    "textiles, fashion, and perfumes",
]


def normalize_name(name):
    """Normalize family name for dedup."""
    name = name.strip()
    # Remove common prefixes for comparison
    name = re.sub(r'^(The |House of |Beit |Bayt )', '', name, flags=re.IGNORECASE)
    # Normalize Al- variants
    name = re.sub(r'^(Al-|Al |Aal |Āl )', 'Al ', name)
    # Remove trailing "family", "clan", etc.
    name = re.sub(r'\s+(family|clan|dynasty|house|group)$', '', name, flags=re.IGNORECASE)
    return name.strip()


def make_id(name):
    """Create ID from family name."""
    clean = name.lower().strip()
    clean = re.sub(r'[^a-z0-9\s]', '', clean)
    clean = re.sub(r'\s+', '_', clean)
    return clean


def is_junk(name):
    """Filter out non-family entries."""
    lower = name.lower()
    junk_words = [
        'stadium', 'airport', 'hotel', 'tower', 'mall', 'hospital',
        'university', 'school', 'mosque', 'street', 'road', 'highway',
        'district', 'province', 'region', 'city', 'village', 'island',
        'company', 'corporation', 'group holdings', 'inc.', 'ltd.',
        'bank of', 'national bank', 'airlines', 'petroleum',
        'ministry', 'government', 'authority',
    ]
    for w in junk_words:
        if w in lower:
            return True
    # Too short or too long
    if len(name) < 3 or len(name) > 60:
        return True
    # Looks like a sentence
    if name.count(' ') > 5:
        return True
    return False


def main():
    families = json.loads((DATA_DIR / "families.json").read_text())
    existing_ids = {f["id"] for f in families}
    existing_names = {normalize_name(f["name"]).lower() for f in families}
    # Also track normalized variants
    for f in families:
        name = f["name"]
        existing_names.add(name.lower())
        existing_names.add(normalize_name(name).lower())
        # Add without "Al " prefix
        bare = re.sub(r'^(Al |Aal |Al-)', '', name)
        existing_names.add(bare.lower())

    all_discovered = {}  # name -> info dict

    def add_family(name, info):
        if is_junk(name):
            return
        norm = normalize_name(name)
        if norm.lower() in existing_names:
            return
        # Check if already discovered under similar name
        fid = make_id(norm)
        if fid in all_discovered:
            return
        # Check bare name too
        bare = re.sub(r'^(al_|aal_)', '', fid)
        for eid in existing_ids:
            if bare == re.sub(r'^(al_|aal_)', '', eid):
                return
        all_discovered[fid] = {
            "name": norm,
            "country": info.get("country", ""),
            "city": info.get("city", ""),
            "type": info.get("type", "merchant"),
            "note": info.get("note", ""),
            "tribe": info.get("tribe", ""),
            "sector": info.get("sector", ""),
        }

    # ── Round 1: By Country ──────────────────────────────────────────────
    print("=" * 60)
    print("ROUND 1: Discovery by country")
    print("=" * 60)

    for country in COUNTRIES:
        print(f"\n[Country] {country}...", flush=True)
        prompt = COUNTRY_PROMPT.format(country=country)
        response = call_claude(prompt)
        if not response:
            print("  FAILED")
            continue

        results = parse_json_array(response)
        if not results:
            print("  BAD JSON")
            continue

        count = 0
        for r in results:
            name = r.get("name", "").strip()
            if name:
                add_family(name, r)
                count += 1
        print(f"  Got {len(results)} families, {count} after filter, total new: {len(all_discovered)}")
        time.sleep(RATE_LIMIT_DELAY)

    # ── Round 2: By Major Tribe ──────────────────────────────────────────
    print("\n" + "=" * 60)
    print("ROUND 2: Discovery by tribe")
    print("=" * 60)

    for tribe in MAJOR_TRIBES:
        print(f"\n[Tribe] {tribe}...", flush=True)
        prompt = TRIBAL_PROMPT.format(tribe=tribe)
        response = call_claude(prompt)
        if not response:
            print("  FAILED")
            continue

        results = parse_json_array(response)
        if not results:
            print("  BAD JSON")
            continue

        count_before = len(all_discovered)
        for r in results:
            name = r.get("name", "").strip()
            if name:
                add_family(name, {**r, "type": "tribal_leader"})
        new = len(all_discovered) - count_before
        print(f"  Got {len(results)} families, {new} new, total: {len(all_discovered)}")
        time.sleep(RATE_LIMIT_DELAY)

    # ── Round 3: By City ─────────────────────────────────────────────────
    print("\n" + "=" * 60)
    print("ROUND 3: Discovery by city")
    print("=" * 60)

    for city, country in MAJOR_CITIES:
        print(f"\n[City] {city}, {country}...", flush=True)
        prompt = CITY_PROMPT.format(city=city, country=country)
        response = call_claude(prompt)
        if not response:
            print("  FAILED")
            continue

        results = parse_json_array(response)
        if not results:
            print("  BAD JSON")
            continue

        count_before = len(all_discovered)
        for r in results:
            name = r.get("name", "").strip()
            if name:
                add_family(name, {**r, "country": country, "city": city})
        new = len(all_discovered) - count_before
        print(f"  Got {len(results)} families, {new} new, total: {len(all_discovered)}")
        time.sleep(RATE_LIMIT_DELAY)

    # ── Round 4: By Sector ───────────────────────────────────────────────
    print("\n" + "=" * 60)
    print("ROUND 4: Discovery by sector")
    print("=" * 60)

    for sector in SECTORS:
        print(f"\n[Sector] {sector}...", flush=True)
        prompt = SECTOR_PROMPT.format(sector=sector)
        response = call_claude(prompt)
        if not response:
            print("  FAILED")
            continue

        results = parse_json_array(response)
        if not results:
            print("  BAD JSON")
            continue

        count_before = len(all_discovered)
        for r in results:
            name = r.get("name", "").strip()
            if name:
                add_family(name, r)
        new = len(all_discovered) - count_before
        print(f"  Got {len(results)} families, {new} new, total: {len(all_discovered)}")
        time.sleep(RATE_LIMIT_DELAY)

    # ── Summary ──────────────────────────────────────────────────────────
    print("\n" + "=" * 60)
    print(f"TOTAL DISCOVERED: {len(all_discovered)} new families")
    print("=" * 60)

    if DRY_RUN:
        print("\n[DRY RUN] Would add these families:")
        for fid, info in sorted(all_discovered.items()):
            print(f"  {info['name']} ({info.get('country', '?')}) - {info.get('note', '')[:60]}")
        return

    # Create skeleton entries
    new_families = []
    for fid, info in all_discovered.items():
        family = {
            "id": fid,
            "name": info["name"],
            "nameAr": None,
            "country": info.get("country") or None,
            "city": info.get("city") or None,
            "familyType": info.get("type", "merchant"),
            "isRuling": 1 if info.get("type") == "ruling" else 0,
            "rulesOver": None,
            "tribeId": None,
            "history": None,
            "description": info.get("note") or None,
            "originStory": None,
            "tribalOrigin": info.get("tribe") or None,
            "modernStatus": None,
            "folkLegends": [],
            "nameEtymology": None,
            "migrationPath": [],
            "timelineEvents": [],
            "connections": [],
            "notableFigures": [],
        }
        new_families.append(family)

    families.extend(new_families)
    (DATA_DIR / "families.json").write_text(
        json.dumps(families, indent=2, ensure_ascii=False) + "\n"
    )
    print(f"\nAdded {len(new_families)} new families to families.json")
    print(f"Total families: {len(families)}")


if __name__ == "__main__":
    main()
