#!/usr/bin/env python3
"""
Enrich only new/skeleton families that have no history yet.
Usage: python enrich-new.py <shard> <total_shards>

Only processes families where history is null/empty. Reuses the mega-enrich
research pipeline and prompts.
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
if not ENV_PATH.exists():
    ENV_PATH = Path(__file__).resolve().parents[1] / ".env.local"
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

RATE_LIMIT_DELAY = 1.5


# ── Import research functions from mega-enrich ──────────────────────────────
# (Duplicated here to keep this standalone)

def wiki_search(query, limit=5):
    url = "https://en.wikipedia.org/w/api.php?" + urllib.parse.urlencode({
        "action": "query", "list": "search",
        "srsearch": query, "format": "json", "srlimit": str(limit),
    })
    req = urllib.request.Request(url, headers={"User-Agent": "GCCTribalResearch/3.0"})
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return json.loads(resp.read()).get("query", {}).get("search", [])
    except Exception:
        return []

def wiki_article(title):
    url = "https://en.wikipedia.org/w/api.php?" + urllib.parse.urlencode({
        "action": "query", "titles": title,
        "prop": "extracts", "explaintext": "1", "format": "json",
    })
    req = urllib.request.Request(url, headers={"User-Agent": "GCCTribalResearch/3.0"})
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            pages = json.loads(resp.read()).get("query", {}).get("pages", {})
            for page in pages.values():
                return page.get("extract", "")
    except Exception:
        return ""
    return ""

def wiki_search_ar(query, limit=3):
    url = "https://ar.wikipedia.org/w/api.php?" + urllib.parse.urlencode({
        "action": "query", "list": "search",
        "srsearch": query, "format": "json", "srlimit": str(limit),
    })
    req = urllib.request.Request(url, headers={"User-Agent": "GCCTribalResearch/3.0"})
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return json.loads(resp.read()).get("query", {}).get("search", [])
    except Exception:
        return []

def wiki_article_ar(title):
    url = "https://ar.wikipedia.org/w/api.php?" + urllib.parse.urlencode({
        "action": "query", "titles": title,
        "prop": "extracts", "explaintext": "1", "format": "json",
    })
    req = urllib.request.Request(url, headers={"User-Agent": "GCCTribalResearch/3.0"})
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            pages = json.loads(resp.read()).get("query", {}).get("pages", {})
            for page in pages.values():
                return page.get("extract", "")
    except Exception:
        return ""
    return ""

def ddg_search(query, max_results=5):
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

def fetch_page_text(url, max_chars=15000):
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


def strip_prefix(name):
    for prefix in ("Al ", "Bani ", "Banu ", "Aal "):
        if name.startswith(prefix):
            return name[len(prefix):]
    return name

def transliteration_variants(name):
    bare = strip_prefix(name)
    variants = [bare]
    if 'Q' in bare or 'q' in bare:
        variants.append(bare.replace('Q', 'G').replace('q', 'g'))
        variants.append(bare.replace('Q', 'K').replace('q', 'k'))
    if 'G' in bare or 'g' in bare:
        variants.append(bare.replace('G', 'Q').replace('g', 'q'))
    variants.append(bare.replace('oo', 'u'))
    variants.append(bare.replace('ou', 'u'))
    variants.append(bare.replace('ei', 'ay'))
    variants.append(bare.replace('ay', 'ei'))
    variants.append(re.sub(r'(.)\1', r'\1', bare))
    return list(set(v for v in variants if v != bare))


def research_family_deep(name, family):
    all_research = []
    seen_titles = set()
    bare = strip_prefix(name)
    country = family.get("rulesOver") or family.get("country") or "Arabian Gulf"

    wiki_queries = [
        f"{name} family",
        f"{name} family {country}",
        f"House of {bare}",
        f"{bare} surname origin",
        f"{bare} name meaning Arabic",
        f"{name} business group",
        name,
    ]
    if family.get("tribeId"):
        wiki_queries.append(family["tribeId"].replace("_", " ") + " tribe")
    if family.get("rulesOver"):
        wiki_queries.append(f"List of rulers of {family['rulesOver']}")

    for variant in transliteration_variants(name)[:3]:
        wiki_queries.append(f"Al {variant} family")

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

    ar_queries = [name, f"عائلة {bare}", f"آل {bare}"]
    ar_fetched = 0
    for q in ar_queries:
        if ar_fetched >= 3:
            break
        results = wiki_search_ar(q, limit=2)
        for r in results:
            title = r["title"]
            if title in seen_titles or ar_fetched >= 3:
                continue
            seen_titles.add(title)
            article_text = wiki_article_ar(title)
            if article_text and len(article_text) > 200:
                all_research.append(f"[Arabic Wikipedia: {title}]\n{article_text}")
                ar_fetched += 1

    ddg_queries = [
        f'"{name}" origin history family Gulf',
        f'"{bare}" surname meaning Arabic etymology',
        f'"{name}" family {country} business merchant',
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

def call_claude(prompt, max_tokens=8000):
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

def parse_json(text):
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


ANTI_HALLUCINATION = """
ABSOLUTE RULES:
1. ONLY include facts DIRECTLY supported by the research text.
2. If research says nothing, output null or empty array. NEVER invent.
3. DO NOT default to "Bani Yas" or any tribal origin unless EXPLICITLY confirmed.
4. Many Gulf families are Persian, Indian, Baloch, Hadrami — respect actual origins.
5. If origin is disputed, SAY SO.
6. For folk legends: ONLY from research. Label clearly.
7. 3 accurate paragraphs > 8 paragraphs of speculation.
"""

def family_prompt(family, research):
    return f"""You are a world-class historian specializing in GCC family genealogy, business history, and tribal lineage.

Synthesize the research below into comprehensive, ACCURATE structured data.

FAMILY: {family['name']} (id: {family['id']})

RESEARCH:
{research}

{ANTI_HALLUCINATION}

Return ONLY valid JSON:
{{
  "history": "Comprehensive narrative (3-6 paragraphs). Cover: verified origins, how they came to current location, key events, business/political evolution. Specific dates/names/places only.",
  "description": "2-3 sentence factual summary",
  "originStory": "Verified origin narrative, or null",
  "tribalOrigin": "Parent tribe if confirmed, or null",
  "modernStatus": "Current business/political status with specifics",
  "folkLegends": [
    {{"title": "Legend title", "story": "The legend", "source": "oral tradition/etc.", "plausibility": "likely|possible|disputed|uncertain"}}
  ],
  "nameEtymology": "Origin of name if in research, or null",
  "migrationPath": [{{"year": 1800, "endYear": null, "from": "Place", "fromCoords": [lat, lng], "to": "Place", "toCoords": [lat, lng], "description": "..."}}],
  "timelineEvents": [{{"year": 1793, "title": "Event", "description": "...", "location": "Place", "coords": [lat, lng], "eventType": "founding"}}],
  "connections": [{{"entityId": "entity_id", "entityType": "tribe", "relationship": "descended_from", "context": "..."}}],
  "notableFigures": [{{"id": "fig_id", "name": "Full Name", "title": "Title/Role", "roleDescription": "What they did", "bornYear": 1900, "diedYear": 1970, "era": "20th century", "biography": "2-3 sentence bio", "achievements": ["achievement"], "birthPlace": "City", "birthCoords": [lat, lng]}}]
}}

coords=[lat,lng]. Gulf lat 20-30, lng 45-60.
eventType: migration|conflict|political|economic|founding|alliance|cultural
Empty arrays/null for anything not in research. ONLY JSON."""


# ── Main ────────────────────────────────────────────────────────────────────

def main():
    families = json.loads((DATA_DIR / "families.json").read_text())

    # Only process families without history (new/skeleton entries)
    work = [(i, f) for i, f in enumerate(families) if not f.get("history")]
    print(f"Total families: {len(families)}, needing enrichment: {len(work)}")

    # Shard
    my_work = [w for idx, w in enumerate(work) if idx % TOTAL_SHARDS == SHARD]
    print(f"[Shard {SHARD}/{TOTAL_SHARDS}] My share: {len(my_work)}")

    output_file = SHARD_DIR / f"new_{SHARD}.json"
    results = []
    if output_file.exists():
        try:
            results = json.loads(output_file.read_text())
            print(f"  Resuming from {len(results)} existing results")
        except Exception:
            results = []

    done_ids = {r["id"] for r in results}
    enriched = len(results)
    failed = 0

    for idx, (orig_idx, family) in enumerate(my_work):
        if family["id"] in done_ids:
            continue

        print(f"[S{SHARD}][{idx+1}/{len(my_work)}] {family['name']}...", end=" ", flush=True)

        research = research_family_deep(family["name"], family)
        research_len = len(research)
        if not research:
            print("NO RESEARCH")
            research = "No research found. Return minimal data with null for anything uncertain."

        prompt = family_prompt(family, research)
        response = call_claude(prompt, max_tokens=8000)
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

        results.append({"type": "family", "id": family["id"], "data": data})
        enriched += 1
        h_len = len(data.get("history", "") or "")
        print(f"OK ({research_len}r, {h_len}h, {len(data.get('notableFigures') or [])}fig)")

        if enriched % 5 == 0:
            output_file.write_text(json.dumps(results, indent=2, ensure_ascii=False))
            print(f"  [Saved {enriched}]")

        time.sleep(RATE_LIMIT_DELAY)

    output_file.write_text(json.dumps(results, indent=2, ensure_ascii=False))
    print(f"\n[Shard {SHARD}] DONE: {enriched} enriched, {failed} failed")


if __name__ == "__main__":
    main()
