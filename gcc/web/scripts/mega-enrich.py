#!/usr/bin/env python3
"""
Mega-enrichment v3 — Deep research pipeline with folk legends, etymology, and origin verification.
Usage: python mega-enrich.py <shard> <total_shards>
Re-enriches ALL entities (not just missing ones) with much deeper research.
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

RATE_LIMIT_DELAY = 1.5  # Slightly faster since we have 10 shards


# ── Wikipedia API ──────────────────────────────────────────────────────────

def wiki_search(query: str, limit: int = 5) -> list[dict]:
    url = (
        "https://en.wikipedia.org/w/api.php?"
        + urllib.parse.urlencode({
            "action": "query", "list": "search",
            "srsearch": query, "format": "json", "srlimit": str(limit),
        })
    )
    req = urllib.request.Request(url, headers={"User-Agent": "GCCTribalResearch/3.0"})
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read())
            return data.get("query", {}).get("search", [])
    except Exception:
        return []


def wiki_article(title: str) -> str:
    url = (
        "https://en.wikipedia.org/w/api.php?"
        + urllib.parse.urlencode({
            "action": "query", "titles": title,
            "prop": "extracts", "explaintext": "1", "format": "json",
        })
    )
    req = urllib.request.Request(url, headers={"User-Agent": "GCCTribalResearch/3.0"})
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
    url = (
        "https://ar.wikipedia.org/w/api.php?"
        + urllib.parse.urlencode({
            "action": "query", "list": "search",
            "srsearch": query, "format": "json", "srlimit": str(limit),
        })
    )
    req = urllib.request.Request(url, headers={"User-Agent": "GCCTribalResearch/3.0"})
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read())
            return data.get("query", {}).get("search", [])
    except Exception:
        return []


def wiki_article_ar(title: str) -> str:
    url = (
        "https://ar.wikipedia.org/w/api.php?"
        + urllib.parse.urlencode({
            "action": "query", "titles": title,
            "prop": "extracts", "explaintext": "1", "format": "json",
        })
    )
    req = urllib.request.Request(url, headers={"User-Agent": "GCCTribalResearch/3.0"})
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read())
            pages = data.get("query", {}).get("pages", {})
            for pid, page in pages.items():
                return page.get("extract", "")
    except Exception:
        return ""
    return ""


# ── DuckDuckGo ──────────────────────────────────────────────────────────

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


def fetch_page_text(url: str, max_chars: int = 15000) -> str:
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


# ── MEGA Research Pipeline ────────────────────────────────────────────────

def strip_prefix(name: str) -> str:
    """Strip common prefixes for search variations."""
    for prefix in ("Al ", "Bani ", "Banu ", "Aal "):
        if name.startswith(prefix):
            return name[len(prefix):]
    return name

def transliteration_variants(name: str) -> list[str]:
    """Generate common Arabic-English transliteration variants."""
    bare = strip_prefix(name)
    variants = [bare]
    # Q/G/K interchange
    if 'Q' in bare or 'q' in bare:
        variants.append(bare.replace('Q', 'G').replace('q', 'g'))
        variants.append(bare.replace('Q', 'K').replace('q', 'k'))
    if 'G' in bare or 'g' in bare:
        variants.append(bare.replace('G', 'Q').replace('g', 'q'))
    # oo/u/ou interchange
    variants.append(bare.replace('oo', 'u'))
    variants.append(bare.replace('ou', 'u'))
    # ei/ay interchange
    variants.append(bare.replace('ei', 'ay'))
    variants.append(bare.replace('ay', 'ei'))
    # kh/kh
    variants.append(bare.replace('kh', 'kh'))
    # Double letters
    variants.append(re.sub(r'(.)\1', r'\1', bare))
    return list(set(v for v in variants if v != bare))


def research_family_deep(name: str, family: dict) -> str:
    """
    MEGA deep research for families — 8-12 Wikipedia articles, etymology searches,
    folk legend searches, Arabic Wikipedia, DuckDuckGo supplementary.
    """
    all_research = []
    seen_titles = set()
    bare = strip_prefix(name)
    country = ""

    # Try to infer country from existing data
    if family.get("rulesOver"):
        country = family["rulesOver"]
    elif family.get("tribeId"):
        country = "Arabian Gulf"

    # === 1. Wikipedia English — MANY query variations ===
    wiki_queries = [
        f"{name} family",
        f"{name} family Arabian Gulf",
        f"House of {bare}",
        f"{bare} surname origin",
        f"{bare} name meaning Arabic",
        f"{bare} family history",
        f"{name} business group",
        name,
    ]
    if country:
        wiki_queries.insert(1, f"{name} {country}")
    if family.get("tribeId"):
        wiki_queries.append(family["tribeId"].replace("_", " ") + " tribe")
    if family.get("rulesOver"):
        wiki_queries.append(f"List of rulers of {family['rulesOver']}")
        wiki_queries.append(f"History of {family['rulesOver']}")

    # Add transliteration variants
    for variant in transliteration_variants(name)[:3]:
        wiki_queries.append(f"Al {variant} family")
        wiki_queries.append(f"{variant} surname")

    wiki_articles_fetched = 0
    for q in wiki_queries:
        if wiki_articles_fetched >= 10:
            break
        results = wiki_search(q, limit=3)
        for r in results:
            title = r["title"]
            if title in seen_titles or wiki_articles_fetched >= 10:
                continue
            seen_titles.add(title)
            article_text = wiki_article(title)
            if article_text and len(article_text) > 200:
                all_research.append(f"[Wikipedia: {title}]\n{article_text}")
                wiki_articles_fetched += 1

    # === 2. Arabic Wikipedia — richer genealogy ===
    ar_queries = [
        name,
        f"عائلة {bare}",  # Family of X
        f"آل {bare}",      # House of X
        f"أصل اسم {bare}",  # Origin of name X
    ]
    if family.get("tribeId"):
        ar_queries.append(f"قبيلة {family['tribeId'].replace('_', ' ')}")

    ar_fetched = 0
    for q in ar_queries:
        if ar_fetched >= 4:
            break
        results = wiki_search_ar(q, limit=2)
        for r in results:
            title = r["title"]
            if title in seen_titles or ar_fetched >= 4:
                continue
            seen_titles.add(title)
            article_text = wiki_article_ar(title)
            if article_text and len(article_text) > 200:
                all_research.append(f"[Arabic Wikipedia: {title}]\n{article_text}")
                ar_fetched += 1

    # === 3. DuckDuckGo — etymology, folk legends, origin stories ===
    ddg_queries = [
        f'"{name}" origin history family Gulf',
        f'"{bare}" surname meaning Arabic etymology',
        f'"{name}" folk legend story origin',
        f'"{name}" family Dubai Abu Dhabi merchant',
        f'"{name}" Persian Iranian Indian origin Gulf',
    ]
    if family.get("isRuling"):
        ddg_queries.append(f'"{name}" royal family history ruling')

    seen_urls = set()
    pages_fetched = 0
    for q in ddg_queries:
        results = ddg_search(q, max_results=3)
        for r in results:
            if r["url"] in seen_urls:
                continue
            seen_urls.add(r["url"])
            all_research.append(f"[Web: {r['title']}]: {r['snippet']}")
            if pages_fetched < 4 and "wikipedia" not in r["url"]:
                page_text = fetch_page_text(r["url"])
                if page_text:
                    all_research.append(f"[Content from {r['url'][:80]}]:\n{page_text}")
                    pages_fetched += 1
        time.sleep(0.2)

    combined = "\n\n".join(all_research)
    return combined[:100000] if combined else ""


def research_tribe_deep(name: str, tribe: dict) -> str:
    """MEGA deep research for tribes."""
    all_research = []
    seen_titles = set()
    bare = strip_prefix(name)

    # === 1. Wikipedia English ===
    wiki_queries = [
        f"{name} tribe",
        f"{name} Arabian tribe",
        f"Banu {bare}",
        f"Bani {bare}",
        f"{bare} tribe history Arabian Peninsula",
        f"{bare} tribe migration",
        f"{name} tribal confederation",
    ]
    if tribe.get("lineageRoot"):
        wiki_queries.append(f"{tribe['lineageRoot']} Arab lineage")
    if tribe.get("originRegionId"):
        wiki_queries.append(f"{tribe['originRegionId'].replace('_', ' ')} tribes")

    for variant in transliteration_variants(name)[:3]:
        wiki_queries.append(f"Bani {variant} tribe")

    wiki_articles_fetched = 0
    for q in wiki_queries:
        if wiki_articles_fetched >= 10:
            break
        results = wiki_search(q, limit=3)
        for r in results:
            title = r["title"]
            if title in seen_titles or wiki_articles_fetched >= 10:
                continue
            seen_titles.add(title)
            article_text = wiki_article(title)
            if article_text and len(article_text) > 200:
                all_research.append(f"[Wikipedia: {title}]\n{article_text}")
                wiki_articles_fetched += 1

    # === 2. Arabic Wikipedia ===
    ar_queries = [
        f"قبيلة {bare}",
        f"بني {bare}",
        f"قبيلة {name}",
        f"نسب {bare}",  # genealogy of X
    ]

    ar_fetched = 0
    for q in ar_queries:
        if ar_fetched >= 4:
            break
        results = wiki_search_ar(q, limit=2)
        for r in results:
            title = r["title"]
            if title in seen_titles or ar_fetched >= 4:
                continue
            seen_titles.add(title)
            article_text = wiki_article_ar(title)
            if article_text and len(article_text) > 200:
                all_research.append(f"[Arabic Wikipedia: {title}]\n{article_text}")
                ar_fetched += 1

    # === 3. DuckDuckGo supplementary ===
    ddg_queries = [
        f'"{name}" tribe history origin Arabian',
        f'"Bani {bare}" tribe genealogy',
        f'"{name}" folk legend tribal origin',
    ]

    seen_urls = set()
    pages_fetched = 0
    for q in ddg_queries:
        results = ddg_search(q, max_results=3)
        for r in results:
            if r["url"] in seen_urls:
                continue
            seen_urls.add(r["url"])
            all_research.append(f"[Web: {r['title']}]: {r['snippet']}")
            if pages_fetched < 3 and "wikipedia" not in r["url"]:
                page_text = fetch_page_text(r["url"])
                if page_text:
                    all_research.append(f"[Content from {r['url'][:80]}]:\n{page_text}")
                    pages_fetched += 1
        time.sleep(0.2)

    combined = "\n\n".join(all_research)
    return combined[:100000] if combined else ""


# ── Claude API ──────────────────────────────────────────────────────────────

def call_claude(prompt: str, max_tokens: int = 8000) -> str | None:
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
            with urllib.request.urlopen(req, timeout=90) as resp:
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
ABSOLUTE RULES — VIOLATIONS WILL CAUSE HARM:
1. ONLY include facts DIRECTLY supported by the research text provided above.
2. If research says nothing about a topic, output null or empty array. NEVER invent.
3. DO NOT generate template histories. Each entity is unique.
4. DO NOT default to "Bani Yas" or any tribal origin unless research EXPLICITLY confirms it.
5. Many Gulf merchant families are Persian, Indian, Baloch, Hadrami, African, Levantine, etc. — respect this.
6. If origin is disputed or unclear, SAY SO. "Origins disputed" is better than a guess.
7. For folk legends: ONLY include stories that appear in the research. Label them clearly as folk legend/oral tradition.
8. For etymology: ONLY if the research discusses the name's meaning or origin.
9. Coordinates: only for places you can verify. null if unsure.
10. 3 accurate paragraphs > 8 paragraphs of speculation.
"""


def family_prompt(family, research):
    existing = json.dumps({k: v for k, v in family.items()
        if v and k in ("name", "description", "familyType", "tribeId", "rulesOver",
                        "isRuling", "originStory", "tribalOrigin", "history")}, ensure_ascii=False)
    return f"""You are a world-class historian specializing in GCC family genealogy, business history, tribal lineage, and oral traditions.

You must synthesize the research below into comprehensive, ACCURATE structured data. This data will be displayed to users who know these families personally — inaccuracies will be immediately noticed and are unacceptable.

FAMILY: {family['name']} (id: {family['id']})
EXISTING DATA (may contain errors — verify against research): {existing}

RESEARCH:
{research}

{ANTI_HALLUCINATION}

SPECIAL INSTRUCTIONS:
- If the existing data contains errors (e.g., says "Bani Yas origin" but research shows Persian/Iranian), CORRECT IT.
- Include folk legends, oral traditions, and name etymology stories IF they appear in the research. Mark them clearly.
- For ruling families: cover succession disputes, coups, territorial conflicts, foreign relations.
- For merchant families: cover business evolution, key ventures, how wealth was built.
- Be specific: names, dates, places, events. Generic statements are useless.

Return ONLY valid JSON:
{{
  "history": "Comprehensive narrative (4-8 paragraphs). Cover: verified ethnic/tribal origins, how the family came to their current location, key historical events involving them, business/political evolution, territorial disputes, foreign relations, modern status. Include specific dates, names, places from the research. If origin is disputed or uncertain, explain the competing theories.",
  "description": "2-3 sentence factual summary of who they are today",
  "originStory": "Verified origin narrative. If uncertain, say 'Origins disputed/uncertain — [theories]'. null if no info.",
  "tribalOrigin": "Parent tribe name if confirmed tribal origin, or null if Persian/Indian/Hadrami/uncertain",
  "modernStatus": "Current business/political status with specifics (company names, roles, wealth estimates if available)",
  "folkLegends": [
    {{"title": "Legend title", "story": "The folk legend or oral tradition as described in research", "source": "Where this legend comes from (oral tradition, local lore, etc.)", "plausibility": "likely|possible|disputed|uncertain"}}
  ],
  "nameEtymology": "Origin/meaning of the family name if discussed in research, or null",
  "migrationPath": [{{"year": 1800, "endYear": null, "from": "Place", "fromCoords": [lat, lng], "to": "Place", "toCoords": [lat, lng], "description": "..."}}],
  "timelineEvents": [{{"year": 1793, "title": "Event", "description": "...", "location": "Place", "coords": [lat, lng], "eventType": "founding"}}],
  "connections": [{{"entityId": "entity_id", "entityType": "tribe", "relationship": "descended_from", "context": "..."}}],
  "notableFigures": [{{"id": "fig_id", "name": "Full Name", "title": "Title/Role", "roleDescription": "What they did", "bornYear": 1900, "diedYear": 1970, "era": "20th century", "biography": "2-3 sentence bio based on research", "achievements": ["achievement1"], "birthPlace": "City", "birthCoords": [lat, lng]}}]
}}

coords=[lat,lng]. Gulf lat 20-30, lng 45-60. Iran lat 28-35, lng 48-58. India lat 8-35, lng 68-90. Levant lat 30-37, lng 34-42. Yemen/Hadhramaut lat 14-16, lng 48-50.
eventType: migration|conflict|political|economic|founding|alliance|cultural
endYear: null if single date, otherwise end of period.
Empty arrays/null for anything not supported by research. ONLY JSON."""


def tribe_prompt(tribe, research):
    existing = json.dumps({k: v for k, v in tribe.items()
        if v and k in ("name", "description", "lineageRoot", "alignment", "formationType",
                        "ancestorStory", "foundingEra", "history")}, ensure_ascii=False)
    return f"""You are a world-class historian specializing in Arabian Peninsula tribal genealogy and oral traditions.

Synthesize the research below into comprehensive, ACCURATE structured data. People from these tribes will read this — inaccuracies are unacceptable.

TRIBE: {tribe['name']} (id: {tribe['id']})
EXISTING DATA (may contain errors — verify against research): {existing}

RESEARCH:
{research}

{ANTI_HALLUCINATION}

SPECIAL INSTRUCTIONS:
- Cover tribal genealogy (Adnani vs Qahtani lineage), sub-tribal divisions, historical migrations.
- Include folk legends about tribal origins IF they appear in the research.
- Cover inter-tribal relations: alliances, rivalries, marriages, wars.
- Be specific about geography: where did they actually live, migrate to, settle?

Return ONLY valid JSON:
{{
  "history": "Comprehensive narrative (4-8 paragraphs). Cover: genealogical origin (verified), sub-tribal structure, key historical events, migrations, inter-tribal relations, territorial control, role in modern states. Include specific dates, names, places.",
  "folkLegends": [
    {{"title": "Legend title", "story": "The folk legend/oral tradition", "source": "oral tradition/genealogical text/etc.", "plausibility": "likely|possible|disputed|uncertain"}}
  ],
  "nameEtymology": "Origin/meaning of the tribe name if discussed in research, or null",
  "migrationPath": [{{"year": 650, "endYear": null, "from": "Place", "fromCoords": [lat, lng], "to": "Place", "toCoords": [lat, lng], "description": "..."}}],
  "timelineEvents": [{{"year": 750, "title": "Event", "description": "...", "location": "Place", "coords": [lat, lng], "eventType": "conflict"}}]
}}

coords=[lat,lng]. Gulf lat 20-30, lng 45-60. Najd lat 24-26, lng 44-47. Yemen lat 14-16, lng 44-48.
eventType: migration|conflict|political|economic|founding|alliance|cultural
endYear: null if single date. Empty arrays/null for anything not supported. ONLY JSON."""


# ── Main ────────────────────────────────────────────────────────────────────

def main():
    tribes = json.loads((DATA_DIR / "tribes.json").read_text())
    families = json.loads((DATA_DIR / "families.json").read_text())

    # Build work list — ALL entities, not just missing ones
    work = []
    for i, f in enumerate(families):
        work.append(("family", i, f))
    for i, t in enumerate(tribes):
        work.append(("tribe", i, t))

    # Shard the work
    my_work = [w for idx, w in enumerate(work) if idx % TOTAL_SHARDS == SHARD]
    print(f"[Shard {SHARD}/{TOTAL_SHARDS}] Total entities: {len(work)}, my share: {len(my_work)}")

    output_file = SHARD_DIR / f"mega_{SHARD}.json"
    results = []

    # Resume from existing shard if it exists
    if output_file.exists():
        try:
            results = json.loads(output_file.read_text())
            print(f"  Resuming from {len(results)} existing results")
        except Exception:
            results = []

    done_ids = {r["id"] for r in results}
    enriched = len(results)
    failed = 0
    skipped = 0

    for idx, (etype, orig_idx, entity) in enumerate(my_work):
        if entity["id"] in done_ids:
            skipped += 1
            continue

        print(f"[S{SHARD}][{idx+1}/{len(my_work)}] {etype}: {entity['name']}...", end=" ", flush=True)

        if etype == "family":
            research = research_family_deep(entity["name"], entity)
        else:
            research = research_tribe_deep(entity["name"], entity)

        research_len = len(research)
        if not research:
            print("NO RESEARCH", end=" ")
            research = "No research found. Return minimal data with null for anything uncertain."

        if etype == "tribe":
            prompt = tribe_prompt(entity, research)
        else:
            prompt = family_prompt(entity, research)

        response = call_claude(prompt, max_tokens=8000)
        if not response:
            print("FAILED (no response)")
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
        n_fig = len(data.get("notableFigures") or [])
        n_folk = len(data.get("folkLegends") or [])
        n_ev = len(data.get("timelineEvents") or [])
        print(f"OK ({research_len}r, {h_len}h, {n_fig}fig, {n_folk}folk, {n_ev}ev)")

        # Save every 5 items for safety
        if enriched % 5 == 0:
            output_file.write_text(json.dumps(results, indent=2, ensure_ascii=False))
            print(f"  [Saved {enriched} results]")

        time.sleep(RATE_LIMIT_DELAY)

    # Final save
    output_file.write_text(json.dumps(results, indent=2, ensure_ascii=False))
    print(f"\n[Shard {SHARD}] DONE: {enriched} enriched, {failed} failed, {skipped} skipped (resumed)")


if __name__ == "__main__":
    main()
