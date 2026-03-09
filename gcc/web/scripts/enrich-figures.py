#!/usr/bin/env python3
"""
Notable figures enrichment — Wikipedia research per family → Claude synthesis.
Usage: python enrich-figures.py <shard> <total_shards>
Each shard writes to src/data/shards/figures_N.json. Run merge-figures.py after all complete.
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

RATE_LIMIT_DELAY = 2.0


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


# ── Research pipeline ──────────────────────────────────────────────────────

def strip_family_prefix(name: str) -> str:
    """Strip common prefixes like 'Al ', 'House of ' to get the core name."""
    for prefix in ("Al ", "Al-", "House of ", "Bani ", "Banu "):
        if name.startswith(prefix):
            return name[len(prefix):]
    return name


def research_family_figures(family: dict) -> str:
    """Wikipedia research specifically targeting notable members of a family."""
    all_research = []
    seen_titles = set()
    articles_fetched = 0
    max_articles = 8

    name = family["name"]
    stripped = strip_family_prefix(name)
    rules_over = family.get("rulesOver")

    queries = [
        f"{name} family members",
        f"House of {stripped}",
        f"{name} notable people",
    ]
    if rules_over:
        queries.insert(2, f"List of rulers of {rules_over}")

    for q in queries:
        if articles_fetched >= max_articles:
            break
        results = wiki_search(q, limit=4)
        for r in results:
            title = r["title"]
            if title in seen_titles or articles_fetched >= max_articles:
                continue
            seen_titles.add(title)
            article_text = wiki_article(title)
            if article_text and len(article_text) > 200:
                all_research.append(f"[Wikipedia: {title}]\n{article_text}")
                articles_fetched += 1

    combined = "\n\n".join(all_research)
    return combined if combined else ""


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


def parse_json_array(text: str) -> list | None:
    """Extract a JSON array from Claude's response."""
    text = text.strip()
    if text.startswith("```"):
        text = text.split("\n", 1)[1] if "\n" in text else text[3:]
        text = text.rsplit("```", 1)[0]
    start, end = text.find("["), text.rfind("]") + 1
    if start >= 0 and end > start:
        try:
            return json.loads(text[start:end])
        except json.JSONDecodeError:
            fixed = re.sub(r',\s*}', '}', re.sub(r',\s*]', ']', text[start:end]))
            try: return json.loads(fixed)
            except: return None
    return None


# ── Prompt ─────────────────────────────────────────────────────────────────

def figures_prompt(family: dict, research: str) -> str:
    is_ruling = bool(family.get("isRuling"))
    name = family["name"]
    fid = family["id"]
    rules_over = family.get("rulesOver") or "N/A"

    if is_ruling:
        scope = f"""This is a RULING family (rules over: {rules_over}).
Provide ALL rulers in historical succession, plus current leadership, plus key political and business figures.
Target 15-25 figures. Be comprehensive — include every ruler you can find in the research."""
    else:
        scope = """This is a merchant/notable family (non-ruling).
Provide founders, patriarchs/matriarchs, current leaders, and prominent members.
Target 5-10 figures."""

    return f"""You are a historian specializing in GCC family genealogy and political history.

Based ONLY on the Wikipedia research below, identify notable figures from the {name} family (id: {fid}).

{scope}

RESEARCH:
{research}

CRITICAL ANTI-HALLUCINATION RULES:
- ONLY include people who appear in the Wikipedia research provided above.
- Do NOT invent figures, dates, or biographical details.
- If a birth/death year is not mentioned in the research, use null.
- If a birthplace is not mentioned, use null for birthPlace and birthCoords.
- Every person you list MUST have their name appear somewhere in the research text.

For each figure, return this structure:
{{
  "id": "lowercase_snake_case_id",
  "name": "Full Name",
  "nameAr": null,
  "familyId": "{fid}",
  "tribeId": null,
  "bornYear": 1900,
  "diedYear": 1970,
  "title": "Their title or role",
  "roleDescription": "Brief role description",
  "era": "20th century",
  "significance": "Why they are notable (1 sentence)",
  "biography": "2-3 paragraph biography based on the research. Include specific dates, events, and achievements mentioned in the Wikipedia articles.",
  "achievements": ["achievement 1", "achievement 2"],
  "birthPlace": "City, Country",
  "birthCoords": [lat, lng]
}}

Use null for any field you cannot determine from the research.
bornYear/diedYear: use integers or null.
birthCoords: [lat, lng] or null.
achievements: array of strings (empty array [] if none found).

Return ONLY a JSON array of figure objects. No other text."""


# ── Main ────────────────────────────────────────────────────────────────────

def main():
    families = json.loads((DATA_DIR / "families.json").read_text())

    # Shard the families
    my_families = [f for idx, f in enumerate(families) if idx % TOTAL_SHARDS == SHARD]
    print(f"[Shard {SHARD}/{TOTAL_SHARDS}] Total families: {len(families)}, my share: {len(my_families)}")

    results = []
    enriched = 0
    failed = 0
    no_research = 0

    for idx, family in enumerate(my_families):
        print(f"[S{SHARD}][{idx+1}/{len(my_families)}] {family['name']}...", end=" ", flush=True)

        research = research_family_figures(family)
        research_len = len(research)

        if not research:
            print("NO RESEARCH")
            no_research += 1
            results.append({"family_id": family["id"], "figures": []})
            time.sleep(RATE_LIMIT_DELAY)
            continue

        prompt = figures_prompt(family, research)
        response = call_claude(prompt)

        if not response:
            print("FAILED (API)")
            failed += 1
            results.append({"family_id": family["id"], "figures": []})
            time.sleep(RATE_LIMIT_DELAY)
            continue

        figures = parse_json_array(response)
        if not figures:
            print("BAD JSON")
            failed += 1
            results.append({"family_id": family["id"], "figures": []})
            time.sleep(RATE_LIMIT_DELAY)
            continue

        # Ensure all figures have the correct familyId
        for fig in figures:
            fig["familyId"] = family["id"]

        results.append({"family_id": family["id"], "figures": figures})
        enriched += 1
        print(f"OK ({research_len}r, {len(figures)} figures)")

        if enriched % 5 == 0:
            (SHARD_DIR / f"figures_{SHARD}.json").write_text(
                json.dumps(results, indent=2, ensure_ascii=False)
            )
            print(f"  [Saved {enriched} results]")

        time.sleep(RATE_LIMIT_DELAY)

    # Final save
    (SHARD_DIR / f"figures_{SHARD}.json").write_text(
        json.dumps(results, indent=2, ensure_ascii=False)
    )
    print(f"\n[Shard {SHARD}] DONE: {enriched} enriched, {failed} failed, {no_research} no research")


if __name__ == "__main__":
    main()
