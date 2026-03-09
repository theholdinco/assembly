#!/usr/bin/env python3
"""
Sharded deep enrichment v2 — Wikipedia-first research pipeline.
Usage: python enrich-shard.py <shard> <total_shards>
Each shard writes to a separate output file. Run merge-shards.py after all complete.
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

# ── Config ──────────────────────────────────────────────────────────────────

SHARD = int(sys.argv[1])
TOTAL_SHARDS = int(sys.argv[2])

ENV_PATH = Path(__file__).resolve().parents[3] / "web" / ".env.local"
if ENV_PATH.exists():
    for line in ENV_PATH.read_text().splitlines():
        if line.startswith("ANTHROPIC_API_KEY="):
            os.environ["ANTHROPIC_API_KEY"] = line.split("=", 1)[1].strip()

API_KEY = os.environ.get("ANTHROPIC_API_KEY")
if not API_KEY:
    print("ERROR: No ANTHROPIC_API_KEY found"); sys.exit(1)

DATA_DIR = Path(__file__).resolve().parents[1] / "src" / "data"
SHARD_DIR = DATA_DIR / "shards"
SHARD_DIR.mkdir(exist_ok=True)

RATE_LIMIT_DELAY = 1.8

# ── Missing families ──────────────────────────────────────────────────────

MISSING_GCC_FAMILIES = [
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
    {"id": "al_rajhi", "name": "Al Rajhi", "country": "Saudi Arabia", "tribal_affiliation": "Bani Zaid (Qudaa)"},
    {"id": "al_olayan", "name": "Al Olayan", "country": "Saudi Arabia", "tribal_affiliation": None},
    {"id": "bin_laden", "name": "Bin Laden", "country": "Saudi Arabia", "tribal_affiliation": "Kindah (Hadrami)"},
    {"id": "al_dabbagh", "name": "Al Dabbagh", "country": "Saudi Arabia", "tribal_affiliation": None},
    {"id": "al_gosaibi", "name": "Al Gosaibi", "country": "Saudi Arabia", "tribal_affiliation": None},
    {"id": "al_zamil", "name": "Al Zamil", "country": "Saudi Arabia", "tribal_affiliation": "Anizah"},
    {"id": "al_turki_family", "name": "Al Turki", "country": "Saudi Arabia", "tribal_affiliation": None},
    {"id": "al_muhaidib", "name": "Al Muhaidib", "country": "Saudi Arabia", "tribal_affiliation": "Anizah"},
    {"id": "al_subeaei", "name": "Al Subeaei", "country": "Saudi Arabia", "tribal_affiliation": "Subay tribe"},
    {"id": "al_mana", "name": "Al Mana", "country": "Qatar", "tribal_affiliation": None},
    {"id": "al_fardan", "name": "Al Fardan", "country": "Qatar", "tribal_affiliation": None},
    {"id": "al_misnad", "name": "Al Misnad", "country": "Qatar", "tribal_affiliation": None},
    {"id": "al_moayyed", "name": "Al Moayyed", "country": "Bahrain", "tribal_affiliation": None},
    {"id": "kanoo", "name": "Kanoo", "country": "Bahrain", "tribal_affiliation": None},
    {"id": "al_zayani", "name": "Al Zayani", "country": "Bahrain", "tribal_affiliation": "Utub"},
    {"id": "jawad", "name": "Jawad", "country": "Bahrain", "tribal_affiliation": None},
    {"id": "al_ghanim", "name": "Al Ghanim", "country": "Kuwait", "tribal_affiliation": "Utub"},
    {"id": "al_kharafi", "name": "Al Kharafi", "country": "Kuwait", "tribal_affiliation": None},
    {"id": "al_sager", "name": "Al Sager", "country": "Kuwait", "tribal_affiliation": None},
    {"id": "al_bahar", "name": "Al Bahar", "country": "Kuwait", "tribal_affiliation": None},
    {"id": "al_marzook", "name": "Al Marzook", "country": "Kuwait", "tribal_affiliation": None},
    {"id": "al_shanfari", "name": "Al Shanfari", "country": "Oman", "tribal_affiliation": None},
    {"id": "al_maskiry", "name": "Al Maskiry", "country": "Oman", "tribal_affiliation": None},
    {"id": "al_rawas", "name": "Al Rawas", "country": "Oman", "tribal_affiliation": None},
]


# ── Wikipedia API ──────────────────────────────────────────────────────────

def wiki_search(query: str, limit: int = 5) -> list[dict]:
    """Search Wikipedia and return list of {title, pageid, snippet}."""
    url = (
        "https://en.wikipedia.org/w/api.php?"
        + urllib.parse.urlencode({
            "action": "query", "list": "search",
            "srsearch": query, "format": "json", "srlimit": str(limit),
        })
    )
    req = urllib.request.Request(url, headers={"User-Agent": "GCCTribalResearch/2.0"})
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read())
            return data.get("query", {}).get("search", [])
    except Exception:
        return []


def wiki_article(title: str) -> str:
    """Fetch full plaintext content of a Wikipedia article."""
    url = (
        "https://en.wikipedia.org/w/api.php?"
        + urllib.parse.urlencode({
            "action": "query", "titles": title,
            "prop": "extracts", "explaintext": "1", "format": "json",
        })
    )
    req = urllib.request.Request(url, headers={"User-Agent": "GCCTribalResearch/2.0"})
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read())
            pages = data.get("query", {}).get("pages", {})
            for pid, page in pages.items():
                return page.get("extract", "")
    except Exception:
        return ""
    return ""


def wiki_search_ar(query: str, limit: int = 3) -> list[dict]:
    """Search Arabic Wikipedia for additional context."""
    url = (
        "https://ar.wikipedia.org/w/api.php?"
        + urllib.parse.urlencode({
            "action": "query", "list": "search",
            "srsearch": query, "format": "json", "srlimit": str(limit),
        })
    )
    req = urllib.request.Request(url, headers={"User-Agent": "GCCTribalResearch/2.0"})
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read())
            return data.get("query", {}).get("search", [])
    except Exception:
        return []


def wiki_article_ar(title: str) -> str:
    """Fetch full plaintext of Arabic Wikipedia article."""
    url = (
        "https://ar.wikipedia.org/w/api.php?"
        + urllib.parse.urlencode({
            "action": "query", "titles": title,
            "prop": "extracts", "explaintext": "1", "format": "json",
        })
    )
    req = urllib.request.Request(url, headers={"User-Agent": "GCCTribalResearch/2.0"})
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read())
            pages = data.get("query", {}).get("pages", {})
            for pid, page in pages.items():
                return page.get("extract", "")
    except Exception:
        return ""
    return ""


# ── DuckDuckGo fallback ──────────────────────────────────────────────────

def ddg_search(query: str, max_results: int = 5) -> list[dict]:
    url = "https://html.duckduckgo.com/html/?" + urllib.parse.urlencode({"q": query})
    req = urllib.request.Request(url, headers={
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"
    })
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            page = resp.read().decode("utf-8", errors="replace")
    except Exception:
        return []

    results = []
    for match in re.finditer(
        r'<a rel="nofollow" class="result__a" href="([^"]+)"[^>]*>(.*?)</a>.*?'
        r'<a class="result__snippet"[^>]*>(.*?)</a>',
        page, re.DOTALL
    ):
        if len(results) >= max_results:
            break
        href = match.group(1)
        actual_url = urllib.parse.unquote(re.sub(r'.*uddg=([^&]+).*', r'\1', href))
        title = html.unescape(re.sub(r'<[^>]+>', '', match.group(2)).strip())
        snippet = html.unescape(re.sub(r'<[^>]+>', '', match.group(3)).strip())
        results.append({"title": title, "snippet": snippet, "url": actual_url})
    return results


def fetch_page_text(url: str, max_chars: int = 10000) -> str:
    req = urllib.request.Request(url, headers={
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"
    })
    try:
        with urllib.request.urlopen(req, timeout=8) as resp:
            ct = resp.headers.get("Content-Type", "")
            if "text/html" not in ct and "text/plain" not in ct:
                return ""
            raw = resp.read().decode("utf-8", errors="replace")
    except Exception:
        return ""
    text = re.sub(r'<script[^>]*>.*?</script>', '', raw, flags=re.DOTALL)
    text = re.sub(r'<style[^>]*>.*?</style>', '', text, flags=re.DOTALL)
    text = re.sub(r'<[^>]+>', ' ', text)
    text = html.unescape(text)
    text = re.sub(r'\s+', ' ', text).strip()
    return text[:max_chars]


# ── Research pipeline ──────────────────────────────────────────────────────

def research_entity(name: str, entity_type: str, extra_context: dict = None) -> str:
    """
    Multi-source research: Wikipedia (EN + AR) → DuckDuckGo fallback.
    Uses multiple query variations to cast a wide net.
    """
    all_research = []
    seen_titles = set()
    country = (extra_context or {}).get("country", "")
    tribal = (extra_context or {}).get("tribal_affiliation", "")

    # === 1. Wikipedia English — multiple query variations ===
    wiki_queries = []
    if entity_type == "tribe":
        wiki_queries = [
            f"{name} tribe",
            f"{name} Arabian tribe",
            f"Banu {name.replace('Al ', '').replace('Bani ', '')}",
            f"{name} tribe history migration",
        ]
    else:
        wiki_queries = [
            f"{name} family",
            f"{name} family {country}" if country else f"{name} family Gulf",
            f"{name} Group company" if country else f"{name} business",
            name,  # bare name — sometimes the Wikipedia title is just the name
        ]
        if tribal:
            wiki_queries.append(tribal)

    wiki_articles_fetched = 0
    for q in wiki_queries:
        if wiki_articles_fetched >= 5:
            break
        results = wiki_search(q, limit=3)
        for r in results:
            title = r["title"]
            if title in seen_titles or wiki_articles_fetched >= 5:
                continue
            seen_titles.add(title)
            article_text = wiki_article(title)
            if article_text and len(article_text) > 200:
                # Keep full Wikipedia articles — no cap on research quality
                truncated = article_text
                all_research.append(f"[Wikipedia: {title}]\n{truncated}")
                wiki_articles_fetched += 1

    # === 2. Arabic Wikipedia — often has richer tribal genealogy ===
    ar_queries = [name]
    if entity_type == "tribe":
        ar_queries.append(f"قبيلة {name}")
    else:
        ar_queries.append(f"عائلة {name}")

    ar_fetched = 0
    for q in ar_queries:
        if ar_fetched >= 2:
            break
        results = wiki_search_ar(q, limit=2)
        for r in results:
            title = r["title"]
            if title in seen_titles or ar_fetched >= 2:
                continue
            seen_titles.add(title)
            article_text = wiki_article_ar(title)
            if article_text and len(article_text) > 200:
                truncated = article_text
                all_research.append(f"[Arabic Wikipedia: {title}]\n{truncated}")
                ar_fetched += 1

    # === 3. DuckDuckGo for supplementary web results ===
    ddg_queries = [
        f'"{name}" {"tribe" if entity_type == "tribe" else "family"} history origin Gulf',
    ]
    if entity_type == "family" and country:
        ddg_queries.append(f'"{name}" family {country} business history')

    seen_urls = set()
    for q in ddg_queries:
        results = ddg_search(q, max_results=3)
        for r in results:
            if r["url"] in seen_urls:
                continue
            seen_urls.add(r["url"])
            all_research.append(f"[Web: {r['title']}]: {r['snippet']}")
            # Fetch page text for top 2 non-Wikipedia results
            if len(seen_urls) <= 2 and "wikipedia" not in r["url"]:
                page_text = fetch_page_text(r["url"])
                if page_text:
                    all_research.append(f"[Content from {r['url'][:80]}]:\n{page_text}")
        time.sleep(0.3)

    combined = "\n\n".join(all_research)
    # Cap at 80K to stay well within Claude's context window
    return combined[:80000] if combined else ""


# ── Claude API ──────────────────────────────────────────────────────────────

def call_claude(prompt: str, max_tokens: int = 4000) -> str | None:
    data = json.dumps({
        "model": "claude-sonnet-4-20250514",
        "max_tokens": max_tokens,
        "messages": [{"role": "user", "content": prompt}]
    }).encode()
    req = urllib.request.Request(
        "https://api.anthropic.com/v1/messages", data=data,
        headers={"Content-Type": "application/json", "x-api-key": API_KEY, "anthropic-version": "2023-06-01"},
    )
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                return json.loads(resp.read())["content"][0]["text"]
        except urllib.error.HTTPError as e:
            e.read()
            if e.code in (429, 529):
                time.sleep(15 * (attempt + 1))
                continue
            return None
        except Exception:
            if attempt < 2: time.sleep(5); continue
            return None
    return None


def parse_json(text: str) -> dict | None:
    text = text.strip()
    if text.startswith("```"):
        text = text.split("\n", 1)[1] if "\n" in text else text[3:]
        text = text.rsplit("```", 1)[0]
    start, end = text.find("{"), text.rfind("}") + 1
    if start >= 0 and end > start:
        try:
            return json.loads(text[start:end])
        except json.JSONDecodeError:
            fixed = re.sub(r',\s*}', '}', re.sub(r',\s*]', ']', text[start:end]))
            try: return json.loads(fixed)
            except: return None
    return None


# ── Prompts ─────────────────────────────────────────────────────────────────

ANTI_HALLUCINATION = """
CRITICAL RULES:
- ONLY include facts that are directly supported by the research provided above.
- If the research does not mention something, do NOT invent it. Use null or empty arrays.
- Do NOT generate generic "template" histories (e.g., "originated from Najd, pearl diving, settled in Abu Dhabi").
- If you cannot determine the actual origin (Iranian, Indian, African, Bedouin, Hadrami, etc.), say so in the history — do NOT default to "Bani Yas bedouin".
- Many GCC merchant families are NOT of tribal origin — they may be Persian, Indian, Baloch, Hadrami, etc. Respect this diversity.
- For migration coordinates, only provide coords for places you can verify. Use null if unsure.
- Quality over quantity: 2 accurate paragraphs are better than 6 paragraphs of speculation.
"""

def tribe_prompt(tribe, research):
    existing = json.dumps({k: v for k, v in tribe.items()
        if v and k in ("name","description","lineageRoot","alignment","formationType","ancestorStory","foundingEra")}, ensure_ascii=False)
    return f"""You are a historian specializing in Arabian Peninsula tribal genealogy.
Synthesize the research below into structured data. Return ONLY valid JSON.

TRIBE: {tribe['name']} (id: {tribe['id']})
EXISTING DATA: {existing}

RESEARCH:
{research}

{ANTI_HALLUCINATION}

Return:
{{
  "history": "Rich narrative based ONLY on the research above. Cover: verified origins, genealogy, migrations, politics, conflicts, modern status. Include specific dates/places/names that appear in the research. If research is thin, write a shorter but accurate narrative.",
  "migrationPath": [{{"year":650,"endYear":null,"from":"Place","fromCoords":[24.7,45.0],"to":"Place","toCoords":[23.6,57.5],"description":"..."}}],
  "timelineEvents": [{{"year":750,"title":"Event","description":"...","location":"Place","coords":[24.0,54.0],"eventType":"conflict"}}]
}}

coords=[lat,lng]. Gulf: lat 20-30, lng 45-60. eventType: migration|conflict|political|economic|founding|alliance|cultural.
endYear: null if single event, otherwise end year of migration period (e.g. year:1790, endYear:1830 for a 40-year migration).
Empty arrays if data is insufficient. ONLY JSON."""


def family_prompt(family, research):
    existing = json.dumps({k: v for k, v in family.items()
        if v and k in ("name","description","familyType","tribeId","rulesOver","isRuling","originStory","tribalOrigin")}, ensure_ascii=False)
    return f"""You are a historian specializing in GCC family genealogy, business history, and tribal lineage.
Synthesize the research below into structured data. Return ONLY valid JSON.

FAMILY: {family['name']} (id: {family['id']})
EXISTING DATA: {existing}

RESEARCH:
{research}

{ANTI_HALLUCINATION}

Return:
{{
  "history": "Rich narrative based ONLY on the research above. Cover: verified ethnic/tribal origins (Persian? Bedouin? Hadrami? Indian?), how they settled, business ventures, political roles, modern status. Be specific about what the research actually says.",
  "description": "2-3 sentence factual summary",
  "originStory": "1-2 sentence verified origin (or null if uncertain)",
  "tribalOrigin": "parent tribe name (or null if not tribal / if of Persian/Indian/Hadrami origin)",
  "modernStatus": "current business/political status based on research",
  "migrationPath": [{{"year":1800,"endYear":null,"from":"Place","fromCoords":[lat,lng],"to":"Place","toCoords":[lat,lng],"description":"..."}}],
  "timelineEvents": [{{"year":1793,"title":"Event","description":"...","location":"Place","coords":[lat,lng],"eventType":"founding"}}],
  "connections": [{{"entityId":"tribe_id","entityType":"tribe","relationship":"descended_from","context":"..."}}],
  "notableFigures": [{{"id":"fig_id","name":"Full Name","title":"Title","roleDescription":"Role","bornYear":1900,"diedYear":1970,"era":"20th century"}}]
}}

coords=[lat,lng]. Gulf lat 20-30, lng 45-60. Iran lat 28-35, lng 48-58. India lat 8-35, lng 68-90.
endYear: null if single event, otherwise end year of migration period (e.g. year:1790, endYear:1830).
Use null/empty arrays for anything not supported by the research. ONLY JSON."""


# ── Main ────────────────────────────────────────────────────────────────────

def make_empty_family(info):
    return {
        "id": info["id"], "name": info["name"], "nameAr": None,
        "familyType": "merchant", "tribeId": None, "isRuling": False,
        "rulesOver": None, "foundedYear": None, "currentHead": None,
        "legitimacyBasis": None, "originStory": None, "description": None,
        "notableFigures": [],
        "history": None, "modernStatus": None,
        "tribalOrigin": info.get("tribal_affiliation"),
        "migrationPath": [], "timelineEvents": [], "connections": [],
    }


def main():
    tribes = json.loads((DATA_DIR / "tribes.json").read_text())
    families = json.loads((DATA_DIR / "families.json").read_text())

    # Add missing families
    existing_ids = {f["id"] for f in families}
    for mf in MISSING_GCC_FAMILIES:
        if mf["id"] not in existing_ids:
            families.append(make_empty_family(mf))
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

    # Build extra context lookup for families
    family_extra = {}
    for mf in MISSING_GCC_FAMILIES:
        family_extra[mf["id"]] = {"country": mf.get("country", ""), "tribal_affiliation": mf.get("tribal_affiliation", "")}

    # Only enrich entities missing history (new additions)
    work = []
    for i, f in enumerate(families):
        if not f.get("history"):
            work.append(("family", i, f))
    for i, t in enumerate(tribes):
        if not t.get("history"):
            work.append(("tribe", i, t))

    # Shard the work
    my_work = [w for idx, w in enumerate(work) if idx % TOTAL_SHARDS == SHARD]
    print(f"[Shard {SHARD}/{TOTAL_SHARDS}] Total work: {len(work)}, my share: {len(my_work)}")

    results = []
    enriched = 0
    failed = 0
    no_research = 0

    for idx, (etype, orig_idx, entity) in enumerate(my_work):
        print(f"[S{SHARD}][{idx+1}/{len(my_work)}] {etype}: {entity['name']}...", end=" ", flush=True)

        extra = family_extra.get(entity["id"], {}) if etype == "family" else {}
        research = research_entity(entity["name"], etype, extra)

        research_len = len(research)
        if not research:
            print(f"NO RESEARCH", end=" ")
            no_research += 1
            research = "No web research found. Only provide data you are CERTAIN about. Use null/empty for anything uncertain."

        if etype == "tribe":
            prompt = tribe_prompt(entity, research)
        else:
            prompt = family_prompt(entity, research)

        response = call_claude(prompt, max_tokens=6000)
        if not response:
            print("FAILED")
            failed += 1
            time.sleep(RATE_LIMIT_DELAY)
            continue

        data = parse_json(response)
        if not data:
            print("BAD JSON")
            failed += 1
            time.sleep(RATE_LIMIT_DELAY)
            continue

        results.append({
            "type": etype,
            "id": entity["id"],
            "data": data,
        })
        enriched += 1
        h_len = len(data.get("history", "") or "")
        n_ev = len(data.get("timelineEvents") or [])
        n_mig = len(data.get("migrationPath") or [])
        print(f"OK ({research_len}r, {h_len}h, {n_ev}ev, {n_mig}mig)")

        if enriched % 10 == 0:
            (SHARD_DIR / f"shard_{SHARD}.json").write_text(json.dumps(results, indent=2, ensure_ascii=False))
            print(f"  [Saved {enriched} results]")

        time.sleep(RATE_LIMIT_DELAY)

    # Final save
    (SHARD_DIR / f"shard_{SHARD}.json").write_text(json.dumps(results, indent=2, ensure_ascii=False))
    print(f"\n[Shard {SHARD}] DONE: {enriched} enriched, {failed} failed, {no_research} with no research")


if __name__ == "__main__":
    main()
