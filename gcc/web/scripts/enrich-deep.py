#!/usr/bin/env python3
"""
Deep enrichment pipeline: web research + Claude synthesis.
Generates rich narratives, migration paths, timeline events for all tribes and families.
"""

import json
import os
import re
import sys
import time
import html
import urllib.request
import urllib.error
import urllib.parse
from pathlib import Path
from typing import Any

# ── Config ──────────────────────────────────────────────────────────────────

ENV_PATH = Path(__file__).resolve().parents[3] / "web" / ".env.local"
if ENV_PATH.exists():
    for line in ENV_PATH.read_text().splitlines():
        if line.startswith("ANTHROPIC_API_KEY="):
            os.environ["ANTHROPIC_API_KEY"] = line.split("=", 1)[1].strip()

API_KEY = os.environ.get("ANTHROPIC_API_KEY")
if not API_KEY:
    print("ERROR: No ANTHROPIC_API_KEY found")
    sys.exit(1)

DATA_DIR = Path(__file__).resolve().parents[1] / "src" / "data"
TRIBES_FILE = DATA_DIR / "tribes.json"
FAMILIES_FILE = DATA_DIR / "families.json"
REGIONS_FILE = DATA_DIR / "regions.json"

BATCH_SIZE = 25
RATE_LIMIT_DELAY = 1.5  # seconds between API calls


# ── Missing families ────────────────────────────────────────────────────────

MISSING_GCC_FAMILIES = [
    # UAE
    {"id": "al_fahim", "name": "Al Fahim", "country": "UAE", "tribal_affiliation": "Bani Yas (Al Bu Mahair)"},
    {"id": "al_ghurair", "name": "Al Ghurair", "country": "UAE", "tribal_affiliation": "Bani Yas"},
    {"id": "al_futtaim", "name": "Al Futtaim", "country": "UAE", "tribal_affiliation": None},
    {"id": "al_habtoor", "name": "Al Habtoor", "country": "UAE", "tribal_affiliation": "Al Sudan (Bani Yas)"},
    {"id": "al_rostamani", "name": "Al Rostamani", "country": "UAE", "tribal_affiliation": "Al Bu Falasah (Bani Yas)"},
    {"id": "al_tayer", "name": "Al Tayer", "country": "UAE", "tribal_affiliation": None},
    {"id": "al_mulla_family", "name": "Al Mulla", "country": "UAE", "tribal_affiliation": None},
    {"id": "al_serkal", "name": "Al Serkal", "country": "UAE", "tribal_affiliation": None},
    {"id": "al_majid", "name": "Al Majid", "country": "UAE", "tribal_affiliation": None},
    {"id": "al_owais", "name": "Al Owais", "country": "UAE", "tribal_affiliation": None},
    {"id": "al_ansari_family", "name": "Al Ansari", "country": "UAE", "tribal_affiliation": None},
    {"id": "al_zarooni", "name": "Al Zarooni", "country": "UAE", "tribal_affiliation": "Bani Yas"},
    {"id": "al_ketbi_family", "name": "Al Ketbi", "country": "UAE", "tribal_affiliation": "Al Ketbi tribe"},
    {"id": "al_shamsi_family", "name": "Al Shamsi", "country": "UAE", "tribal_affiliation": "Shihuh"},
    {"id": "al_khoory", "name": "Al Khoory", "country": "UAE", "tribal_affiliation": None},
    {"id": "al_azzawi", "name": "Al Azzawi", "country": "UAE", "tribal_affiliation": None},
    {"id": "al_suwaidi_family", "name": "Al Suwaidi", "country": "UAE", "tribal_affiliation": "Bani Yas (Al Suwaidi)"},
    {"id": "al_dhaheri_family", "name": "Al Dhaheri", "country": "UAE", "tribal_affiliation": "Bani Yas (Al Dhawahir)"},
    {"id": "al_mansoori_family", "name": "Al Mansoori", "country": "UAE", "tribal_affiliation": "Manasir tribe"},
    {"id": "al_qubaisi", "name": "Al Qubaisi", "country": "UAE", "tribal_affiliation": "Bani Yas (Al Qubaisat)"},
    {"id": "al_rumaithi", "name": "Al Rumaithi", "country": "UAE", "tribal_affiliation": "Bani Yas (Al Rumaithat)"},
    {"id": "al_mazrouei", "name": "Al Mazrouei", "country": "UAE", "tribal_affiliation": "Bani Yas (Al Mazari)"},
    {"id": "al_hammadi_family", "name": "Al Hammadi", "country": "UAE", "tribal_affiliation": None},
    {"id": "al_ameri_family", "name": "Al Ameri", "country": "UAE", "tribal_affiliation": None},
    {"id": "al_kaabi_family", "name": "Al Kaabi", "country": "UAE", "tribal_affiliation": "Bani Kaab"},
    {"id": "juma_al_majid", "name": "Juma Al Majid", "country": "UAE", "tribal_affiliation": None},
    {"id": "al_dowsari", "name": "Al Dowsari", "country": "UAE", "tribal_affiliation": "Al Dawasir tribe"},
    {"id": "al_muhadib", "name": "Al Muhadib", "country": "UAE", "tribal_affiliation": None},
    # Saudi
    {"id": "al_rajhi", "name": "Al Rajhi", "country": "Saudi Arabia", "tribal_affiliation": "Bani Zaid (Qudaa)"},
    {"id": "al_olayan", "name": "Al Olayan", "country": "Saudi Arabia", "tribal_affiliation": None},
    {"id": "bin_laden", "name": "Bin Laden", "country": "Saudi Arabia", "tribal_affiliation": "Kindah (Hadrami)"},
    {"id": "al_dabbagh", "name": "Al Dabbagh", "country": "Saudi Arabia", "tribal_affiliation": None},
    {"id": "al_gosaibi", "name": "Al Gosaibi", "country": "Saudi Arabia", "tribal_affiliation": None},
    {"id": "al_zamil", "name": "Al Zamil", "country": "Saudi Arabia", "tribal_affiliation": "Anizah"},
    {"id": "al_turki_family", "name": "Al Turki", "country": "Saudi Arabia", "tribal_affiliation": None},
    {"id": "al_muhaidib", "name": "Al Muhaidib", "country": "Saudi Arabia", "tribal_affiliation": "Anizah"},
    {"id": "al_subeaei", "name": "Al Subeaei", "country": "Saudi Arabia", "tribal_affiliation": "Subay tribe"},
    # Qatar
    {"id": "al_mana", "name": "Al Mana", "country": "Qatar", "tribal_affiliation": None},
    {"id": "al_fardan", "name": "Al Fardan", "country": "Qatar", "tribal_affiliation": None},
    {"id": "al_misnad", "name": "Al Misnad", "country": "Qatar", "tribal_affiliation": None},
    # Bahrain
    {"id": "al_moayyed", "name": "Al Moayyed", "country": "Bahrain", "tribal_affiliation": None},
    {"id": "kanoo", "name": "Kanoo", "country": "Bahrain", "tribal_affiliation": None},
    {"id": "al_zayani", "name": "Al Zayani", "country": "Bahrain", "tribal_affiliation": "Utub"},
    {"id": "jawad", "name": "Jawad", "country": "Bahrain", "tribal_affiliation": None},
    # Kuwait
    {"id": "al_ghanim", "name": "Al Ghanim", "country": "Kuwait", "tribal_affiliation": "Utub"},
    {"id": "al_kharafi", "name": "Al Kharafi", "country": "Kuwait", "tribal_affiliation": None},
    {"id": "al_sager", "name": "Al Sager", "country": "Kuwait", "tribal_affiliation": None},
    {"id": "al_bahar", "name": "Al Bahar", "country": "Kuwait", "tribal_affiliation": None},
    {"id": "al_marzook", "name": "Al Marzook", "country": "Kuwait", "tribal_affiliation": None},
    # Oman
    {"id": "al_shanfari", "name": "Al Shanfari", "country": "Oman", "tribal_affiliation": None},
    {"id": "al_maskiry", "name": "Al Maskiry", "country": "Oman", "tribal_affiliation": None},
    {"id": "al_rawas", "name": "Al Rawas", "country": "Oman", "tribal_affiliation": None},
]


# ── Web search via DuckDuckGo HTML ─────────────────────────────────────────

def web_search(query: str, max_results: int = 5) -> list[dict]:
    """Search DuckDuckGo and return results with title + snippet + url."""
    url = "https://html.duckduckgo.com/html/?" + urllib.parse.urlencode({"q": query})
    req = urllib.request.Request(url, headers={
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"
    })
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            page = resp.read().decode("utf-8", errors="replace")
    except Exception as e:
        print(f"    Search error: {e}")
        return []

    results = []
    # Parse DuckDuckGo HTML results
    for match in re.finditer(
        r'<a rel="nofollow" class="result__a" href="([^"]+)"[^>]*>(.*?)</a>.*?'
        r'<a class="result__snippet"[^>]*>(.*?)</a>',
        page, re.DOTALL
    ):
        if len(results) >= max_results:
            break
        href = match.group(1)
        # DuckDuckGo wraps URLs in a redirect
        actual_url = urllib.parse.unquote(re.sub(r'.*uddg=([^&]+).*', r'\1', href))
        title = re.sub(r'<[^>]+>', '', match.group(2)).strip()
        snippet = re.sub(r'<[^>]+>', '', match.group(3)).strip()
        snippet = html.unescape(snippet)
        title = html.unescape(title)
        results.append({"title": title, "snippet": snippet, "url": actual_url})

    return results


def fetch_page_text(url: str, max_chars: int = 4000) -> str:
    """Fetch a web page and extract readable text."""
    req = urllib.request.Request(url, headers={
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"
    })
    try:
        with urllib.request.urlopen(req, timeout=8) as resp:
            content_type = resp.headers.get("Content-Type", "")
            if "text/html" not in content_type and "text/plain" not in content_type:
                return ""
            page_html = resp.read().decode("utf-8", errors="replace")
    except Exception:
        return ""

    # Strip scripts, styles, and HTML tags
    text = re.sub(r'<script[^>]*>.*?</script>', '', page_html, flags=re.DOTALL)
    text = re.sub(r'<style[^>]*>.*?</style>', '', text, flags=re.DOTALL)
    text = re.sub(r'<[^>]+>', ' ', text)
    text = html.unescape(text)
    text = re.sub(r'\s+', ' ', text).strip()
    return text[:max_chars]


def research_entity(name: str, entity_type: str, extra_context: str = "") -> str:
    """Perform web research on an entity. Returns combined research text."""
    queries = [
        f'"{name}" tribe history genealogy Arabian Peninsula',
        f'"{name}" family origin migration Gulf GCC',
        f'"{name}" {"tribe" if entity_type == "tribe" else "family"} heritage lineage',
    ]
    if entity_type == "family":
        queries.append(f'"{name}" family business modern UAE Saudi Qatar')

    all_research = []
    seen_urls = set()

    for q in queries:
        results = web_search(q, max_results=3)
        for r in results:
            if r["url"] in seen_urls:
                continue
            seen_urls.add(r["url"])
            all_research.append(f"[{r['title']}]: {r['snippet']}")
            # Fetch full page for top results (first 2 unique)
            if len(seen_urls) <= 3:
                page_text = fetch_page_text(r["url"], max_chars=3000)
                if page_text:
                    all_research.append(f"[Page content from {r['title']}]: {page_text[:3000]}")
        time.sleep(0.5)  # Be polite to DDG

    combined = "\n\n".join(all_research)
    return combined[:12000]  # Cap total research at 12k chars


# ── Claude API ──────────────────────────────────────────────────────────────

def call_claude(prompt: str, max_tokens: int = 3000) -> str | None:
    """Call Claude API."""
    data = json.dumps({
        "model": "claude-sonnet-4-20250514",
        "max_tokens": max_tokens,
        "messages": [{"role": "user", "content": prompt}]
    }).encode()

    req = urllib.request.Request(
        "https://api.anthropic.com/v1/messages",
        data=data,
        headers={
            "Content-Type": "application/json",
            "x-api-key": API_KEY,
            "anthropic-version": "2023-06-01",
        },
    )

    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=45) as resp:
                result = json.loads(resp.read())
                return result["content"][0]["text"]
        except urllib.error.HTTPError as e:
            body = e.read().decode()
            if e.code == 429:
                wait = 15 * (attempt + 1)
                print(f"rate limited, waiting {wait}s...", end=" ", flush=True)
                time.sleep(wait)
                continue
            elif e.code == 529:
                time.sleep(10)
                continue
            print(f"API {e.code}: {body[:100]}")
            return None
        except Exception as e:
            if attempt < 2:
                time.sleep(5)
                continue
            print(f"Error: {e}")
            return None
    return None


def parse_json_response(text: str) -> dict | None:
    """Extract JSON from Claude's response."""
    text = text.strip()
    if text.startswith("```"):
        text = text.split("\n", 1)[1] if "\n" in text else text[3:]
        text = text.rsplit("```", 1)[0]
    start = text.find("{")
    end = text.rfind("}") + 1
    if start >= 0 and end > start:
        try:
            return json.loads(text[start:end])
        except json.JSONDecodeError:
            # Try fixing common issues
            fixed = text[start:end]
            fixed = re.sub(r',\s*}', '}', fixed)
            fixed = re.sub(r',\s*]', ']', fixed)
            try:
                return json.loads(fixed)
            except json.JSONDecodeError:
                return None
    return None


# ── Enrichment prompts ──────────────────────────────────────────────────────

def build_tribe_prompt(tribe: dict, research: str, all_tribe_ids: list[str]) -> str:
    existing = json.dumps({k: v for k, v in tribe.items()
                           if v and k in ("name", "description", "lineageRoot", "alignment",
                                          "formationType", "ancestorStory", "foundingEra")},
                          ensure_ascii=False)

    return f"""You are a historian specializing in Arabian Peninsula tribal genealogy.

Research the tribe below using the provided web research. Return ONLY valid JSON.

TRIBE: {tribe['name']} (id: {tribe['id']})
EXISTING DATA: {existing}

WEB RESEARCH:
{research}

Return JSON:
{{
  "history": "3-6 paragraph rich narrative covering: origins and genealogy, early history, migrations, role in regional politics, conflicts/alliances, modern status. Be specific with dates, places, names. This should read like a well-researched encyclopedia entry.",
  "migrationPath": [
    {{"year": 650, "from": "Najd", "fromCoords": [24.7, 45.0], "to": "Oman coast", "toCoords": [23.6, 57.5], "description": "Migrated during early Islamic expansion"}}
  ],
  "timelineEvents": [
    {{"year": 750, "title": "Battle of X", "description": "Fought alongside...", "location": "Place", "coords": [24.0, 54.0], "eventType": "conflict"}}
  ]
}}

RULES:
- history must be detailed, multi-paragraph, factual. Include specific dates, rulers, battles, treaties where known.
- migrationPath: chronological list of major moves. Use approximate coords [lat, lng]. null coords if unknown.
- timelineEvents: key moments. eventType must be one of: migration, conflict, political, economic, founding, alliance, cultural
- coords are [latitude, longitude] — Gulf region is roughly lat 20-30, lng 45-60
- Be historically accurate. If web research contradicts known facts, prefer well-established historical accounts.
- If information is truly unknown, use empty arrays rather than fabricating.
- Return ONLY the JSON object."""


def build_family_prompt(family: dict, research: str, all_tribe_ids: list[str]) -> str:
    existing = json.dumps({k: v for k, v in family.items()
                           if v and k in ("name", "description", "familyType", "tribeId",
                                          "rulesOver", "isRuling", "originStory")},
                          ensure_ascii=False)

    return f"""You are a historian and researcher specializing in GCC (Gulf) family genealogy, business history, and tribal lineage.

Research the family below using the provided web research. Return ONLY valid JSON.

FAMILY: {family['name']} (id: {family['id']})
EXISTING DATA: {existing}

WEB RESEARCH:
{research}

Return JSON:
{{
  "history": "3-6 paragraph rich narrative covering: tribal origins and genealogy (which tribe they descend from), how/when they settled in their current location, how they rose to prominence (political power, merchant trade, business empire), key historical events they were involved in, modern status and business interests. Be specific with dates, places, names of key figures.",
  "description": "2-3 sentence summary if current description is missing or thin",
  "originStory": "1-2 sentence origin narrative",
  "tribalOrigin": "Name of the tribe they descend from, e.g. 'Bani Yas' or 'Al Dawasir'",
  "modernStatus": "Current business/political prominence — what companies do they own, what roles do they hold, what is their economic significance",
  "migrationPath": [
    {{"year": 1800, "from": "Liwa Oasis", "fromCoords": [23.1, 53.8], "to": "Abu Dhabi Island", "toCoords": [24.45, 54.38], "description": "Moved to Abu Dhabi following discovery of fresh water"}}
  ],
  "timelineEvents": [
    {{"year": 1793, "title": "Settlement of Abu Dhabi", "description": "The family established...", "location": "Abu Dhabi", "coords": [24.45, 54.38], "eventType": "founding"}}
  ],
  "connections": [
    {{"entityId": "tribe_id_here", "entityType": "tribe", "relationship": "descended_from", "context": "Branch of the X tribe"}}
  ],
  "notableFigures": [
    {{"id": "figure_id", "name": "Full Name", "title": "Title/Role", "roleDescription": "What they did", "bornYear": 1900, "diedYear": 1970, "era": "20th century"}}
  ]
}}

RULES:
- history must be DETAILED and RICH. Multiple paragraphs. Include specific dates, names, events, business deals, political moments.
- For merchant families: describe their business empire, key companies, industries they dominate
- For ruling families: describe succession, key rulers, territorial expansion, modern governance
- For Iranian-origin families: describe their journey from Iran, settlement in Gulf ports, integration
- migrationPath: chronological. coords are [latitude, longitude]. Gulf lat ~20-30, lng ~45-60. Iran lat ~28-35, lng ~48-58.
- connections entityType must be: tribe, family, figure, or region
- connections entityId should reference known tribe/family IDs where possible
- Be historically accurate. Prefer well-established accounts over speculation.
- Return ONLY the JSON object."""


# ── Merge logic ─────────────────────────────────────────────────────────────

def merge_tribe_enrichment(tribe: dict, data: dict) -> dict:
    """Merge deep enrichment into existing tribe."""
    if data.get("history"):
        tribe["history"] = data["history"]
    if data.get("migrationPath"):
        tribe["migrationPath"] = [
            {
                "year": m.get("year"),
                "from": m.get("from", ""),
                "fromCoords": m.get("fromCoords"),
                "to": m.get("to", ""),
                "toCoords": m.get("toCoords"),
                "description": m.get("description", ""),
            }
            for m in data["migrationPath"]
            if isinstance(m, dict)
        ]
    if data.get("timelineEvents"):
        tribe["timelineEvents"] = [
            {
                "year": e.get("year", 0),
                "title": e.get("title", ""),
                "description": e.get("description", ""),
                "location": e.get("location"),
                "coords": e.get("coords"),
                "eventType": e.get("eventType", "political"),
            }
            for e in data["timelineEvents"]
            if isinstance(e, dict) and e.get("year")
        ]
    return tribe


def merge_family_enrichment(family: dict, data: dict) -> dict:
    """Merge deep enrichment into existing family."""
    if data.get("history"):
        family["history"] = data["history"]
    if data.get("description") and not family.get("description"):
        family["description"] = data["description"]
    if data.get("originStory") and not family.get("originStory"):
        family["originStory"] = data["originStory"]
    if data.get("tribalOrigin"):
        family["tribalOrigin"] = data["tribalOrigin"]
    if data.get("modernStatus"):
        family["modernStatus"] = data["modernStatus"]
    if data.get("migrationPath"):
        family["migrationPath"] = [
            {
                "year": m.get("year"),
                "from": m.get("from", ""),
                "fromCoords": m.get("fromCoords"),
                "to": m.get("to", ""),
                "toCoords": m.get("toCoords"),
                "description": m.get("description", ""),
            }
            for m in data["migrationPath"]
            if isinstance(m, dict)
        ]
    if data.get("timelineEvents"):
        family["timelineEvents"] = [
            {
                "year": e.get("year", 0),
                "title": e.get("title", ""),
                "description": e.get("description", ""),
                "location": e.get("location"),
                "coords": e.get("coords"),
                "eventType": e.get("eventType", "political"),
            }
            for e in data["timelineEvents"]
            if isinstance(e, dict) and e.get("year")
        ]
    if data.get("connections"):
        family["connections"] = [
            {
                "entityId": c.get("entityId", ""),
                "entityType": c.get("entityType", "tribe"),
                "relationship": c.get("relationship", ""),
                "context": c.get("context", ""),
            }
            for c in data["connections"]
            if isinstance(c, dict) and c.get("entityId")
        ]
    # Merge notable figures
    if data.get("notableFigures"):
        existing_ids = {f.get("id") for f in family.get("notableFigures", [])}
        for fig in data["notableFigures"]:
            if isinstance(fig, dict) and fig.get("name"):
                fig_id = fig.get("id") or fig["name"].lower().replace(" ", "_")
                if fig_id not in existing_ids:
                    family.setdefault("notableFigures", []).append({
                        "id": fig_id,
                        "name": fig["name"],
                        "title": fig.get("title"),
                        "roleDescription": fig.get("roleDescription"),
                        "bornYear": fig.get("bornYear"),
                        "diedYear": fig.get("diedYear"),
                        "era": fig.get("era"),
                    })
                    existing_ids.add(fig_id)
    return family


# ── Main pipeline ───────────────────────────────────────────────────────────

def needs_deep_enrichment(entity: dict, entity_type: str) -> bool:
    """Check if entity needs deep enrichment."""
    has_history = bool(entity.get("history"))
    has_migration = bool(entity.get("migrationPath") and len(entity["migrationPath"]) > 0)
    has_events = bool(entity.get("timelineEvents") and len(entity["timelineEvents"]) > 0)
    return not (has_history and has_migration and has_events)


def make_empty_family(fam_info: dict) -> dict:
    """Create a new family entry from missing family info."""
    return {
        "id": fam_info["id"],
        "name": fam_info["name"],
        "nameAr": None,
        "familyType": "merchant" if not fam_info.get("country") == "ruling" else "ruling",
        "tribeId": None,
        "isRuling": False,
        "rulesOver": None,
        "foundedYear": None,
        "currentHead": None,
        "legitimacyBasis": None,
        "originStory": None,
        "description": None,
        "notableFigures": [],
        "history": None,
        "modernStatus": None,
        "tribalOrigin": fam_info.get("tribal_affiliation"),
        "migrationPath": [],
        "timelineEvents": [],
        "connections": [],
    }


def main():
    tribes = json.loads(TRIBES_FILE.read_text())
    families = json.loads(FAMILIES_FILE.read_text())

    # ── Add missing families ──
    existing_family_ids = {f["id"] for f in families}
    added_families = 0
    for mf in MISSING_GCC_FAMILIES:
        if mf["id"] not in existing_family_ids:
            families.append(make_empty_family(mf))
            existing_family_ids.add(mf["id"])
            added_families += 1
            print(f"  + Added family: {mf['name']}")

    print(f"\nAdded {added_families} missing families. Total families: {len(families)}")

    # ── Ensure new fields exist on all entities ──
    for t in tribes:
        t.setdefault("history", None)
        t.setdefault("migrationPath", [])
        t.setdefault("timelineEvents", [])

    for f in families:
        f.setdefault("history", None)
        f.setdefault("modernStatus", None)
        f.setdefault("tribalOrigin", None)
        f.setdefault("migrationPath", [])
        f.setdefault("timelineEvents", [])
        f.setdefault("connections", [])

    all_tribe_ids = [t["id"] for t in tribes]

    # ── Process families first (more impactful) ──
    families_to_enrich = [(i, f) for i, f in enumerate(families) if needs_deep_enrichment(f, "family")]
    print(f"\nFamilies needing deep enrichment: {len(families_to_enrich)}/{len(families)}")

    enriched_f = 0
    failed_f = 0
    for batch_start in range(0, len(families_to_enrich), BATCH_SIZE):
        batch = families_to_enrich[batch_start:batch_start + BATCH_SIZE]
        print(f"\n--- Family Batch {batch_start // BATCH_SIZE + 1} ---")

        for idx, (fam_idx, fam) in enumerate(batch):
            global_idx = batch_start + idx + 1
            print(f"[F {global_idx}/{len(families_to_enrich)}] {fam['name']}...", end=" ", flush=True)

            # Web research
            extra = f"country: {fam.get('country', '')}" if fam.get('country') else ""
            research = research_entity(fam["name"], "family", extra)
            if not research:
                print("NO RESEARCH")
                research = "No web research available. Use your knowledge."

            # Claude synthesis
            prompt = build_family_prompt(fam, research, all_tribe_ids)
            response = call_claude(prompt, max_tokens=3000)
            if not response:
                print("FAILED")
                failed_f += 1
                time.sleep(RATE_LIMIT_DELAY)
                continue

            data = parse_json_response(response)
            if not data:
                print("BAD JSON")
                failed_f += 1
                time.sleep(RATE_LIMIT_DELAY)
                continue

            families[fam_idx] = merge_family_enrichment(fam, data)
            enriched_f += 1
            h_len = len(data.get("history", "") or "")
            n_events = len(data.get("timelineEvents") or [])
            n_migration = len(data.get("migrationPath") or [])
            print(f"OK (history:{h_len}c, {n_events}events, {n_migration}migrations)")
            time.sleep(RATE_LIMIT_DELAY)

        # Save after each batch
        FAMILIES_FILE.write_text(json.dumps(families, indent=2, ensure_ascii=False) + "\n")
        print(f"  Saved families ({enriched_f} enriched)")

    # ── Process tribes ──
    tribes_to_enrich = [(i, t) for i, t in enumerate(tribes) if needs_deep_enrichment(t, "tribe")]
    print(f"\n\nTribes needing deep enrichment: {len(tribes_to_enrich)}/{len(tribes)}")

    enriched_t = 0
    failed_t = 0
    for batch_start in range(0, len(tribes_to_enrich), BATCH_SIZE):
        batch = tribes_to_enrich[batch_start:batch_start + BATCH_SIZE]
        print(f"\n--- Tribe Batch {batch_start // BATCH_SIZE + 1} ---")

        for idx, (tribe_idx, tribe) in enumerate(batch):
            global_idx = batch_start + idx + 1
            print(f"[T {global_idx}/{len(tribes_to_enrich)}] {tribe['name']}...", end=" ", flush=True)

            research = research_entity(tribe["name"], "tribe")
            if not research:
                print("NO RESEARCH")
                research = "No web research available. Use your knowledge."

            prompt = build_tribe_prompt(tribe, research, all_tribe_ids)
            response = call_claude(prompt, max_tokens=3000)
            if not response:
                print("FAILED")
                failed_t += 1
                time.sleep(RATE_LIMIT_DELAY)
                continue

            data = parse_json_response(response)
            if not data:
                print("BAD JSON")
                failed_t += 1
                time.sleep(RATE_LIMIT_DELAY)
                continue

            tribes[tribe_idx] = merge_tribe_enrichment(tribe, data)
            enriched_t += 1
            h_len = len(data.get("history", "") or "")
            n_events = len(data.get("timelineEvents") or [])
            n_migration = len(data.get("migrationPath") or [])
            print(f"OK (history:{h_len}c, {n_events}events, {n_migration}migrations)")
            time.sleep(RATE_LIMIT_DELAY)

        TRIBES_FILE.write_text(json.dumps(tribes, indent=2, ensure_ascii=False) + "\n")
        print(f"  Saved tribes ({enriched_t} enriched)")

    # ── Final save ──
    FAMILIES_FILE.write_text(json.dumps(families, indent=2, ensure_ascii=False) + "\n")
    TRIBES_FILE.write_text(json.dumps(tribes, indent=2, ensure_ascii=False) + "\n")

    # ── Summary ──
    print(f"\n{'='*60}")
    print(f"FAMILIES: {enriched_f} enriched, {failed_f} failed, {len(families)} total")
    print(f"TRIBES: {enriched_t} enriched, {failed_t} failed, {len(tribes)} total")

    # Coverage stats
    for label, data_list in [("Families", families), ("Tribes", tribes)]:
        with_history = sum(1 for e in data_list if e.get("history"))
        with_migration = sum(1 for e in data_list if e.get("migrationPath") and len(e["migrationPath"]) > 0)
        with_events = sum(1 for e in data_list if e.get("timelineEvents") and len(e["timelineEvents"]) > 0)
        print(f"\n{label} coverage:")
        print(f"  history: {with_history}/{len(data_list)}")
        print(f"  migrationPath: {with_migration}/{len(data_list)}")
        print(f"  timelineEvents: {with_events}/{len(data_list)}")


if __name__ == "__main__":
    main()
