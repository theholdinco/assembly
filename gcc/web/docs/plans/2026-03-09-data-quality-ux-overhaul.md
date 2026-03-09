# GCC Data Quality & UX Overhaul — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix data quality (missing families, thin figures, duplicates) and UI gaps (View on Map broken, map only shows migrations, no date ranges) to make the GCC tribal genealogy app comprehensive and accurate.

**Architecture:** Data-first approach. Wait for current enrichment shards to finish, then layer scripts for dedup/merge, missing families, and dedicated figure enrichment. Then UI changes to types, App state, DetailPanel, and MapView.

**Tech Stack:** React 19 + TypeScript + Vite 7 + Tailwind v4 + Mapbox GL JS. Python scripts using Wikipedia API + Anthropic Claude Sonnet API.

---

### Task 1: Update TypeScript Types

**Files:**
- Modify: `src/types/index.ts:3-10` (MigrationStep)
- Modify: `src/types/index.ts:81-93` (NotableFigure)
- Modify: `src/types/index.ts:95-115` (Family)

**Step 1: Add `endYear` to MigrationStep**

In `src/types/index.ts`, change MigrationStep to:

```typescript
export interface MigrationStep {
  year: number | null;
  endYear: number | null; // null = single-year event
  from: string;
  fromCoords: [number, number] | null; // [lat, lng]
  to: string;
  toCoords: [number, number] | null;
  description: string;
}
```

**Step 2: Add fields to NotableFigure**

```typescript
export interface NotableFigure {
  id: string;
  name: string;
  nameAr: string | null;
  familyId: string | null;
  tribeId: string | null;
  bornYear: number | null;
  diedYear: number | null;
  title: string | null;
  roleDescription: string | null;
  era: string | null;
  significance: string | null;
  biography: string | null;
  achievements: string[];
  birthPlace: string | null;
  birthCoords: [number, number] | null; // [lat, lng]
}
```

**Step 3: Add fields to Family**

Add after line 114 (`connections: EntityConnection[];`):

```typescript
  entityClassification: 'tribe' | 'family' | 'tribe+family';
  subTribes: SubTribe[];
  relations: TribalRelation[];
```

**Step 4: Verify the app still compiles**

Run: `cd /Users/solal/Documents/GitHub/funzies/gcc/web && npx vite build 2>&1 | tail -20`

Fix any type errors that arise (existing data won't have the new fields — they'll be `undefined` which is fine for `| null` types, but arrays need defaults).

**Step 5: Commit**

```bash
git add src/types/index.ts
git commit -m "feat: extend types for entity merging, date ranges, richer figures"
```

---

### Task 2: Merge Shards & Run Dedup/Merge Script

**Files:**
- Run: `scripts/merge-shards.py` (already exists)
- Create: `scripts/dedup-merge.py`

**Step 1: Wait for enrichment shards to finish**

Check progress:
```bash
for i in 0 1 2 3 4; do count=$(grep -c "OK\|FAILED\|BAD JSON" /tmp/shard_$i.log 2>/dev/null || echo 0); total=$(head -1 /tmp/shard_$i.log | grep -o 'my share: [0-9]*' | grep -o '[0-9]*'); echo "Shard $i: $count/$total"; done
```

Wait until all 5 show completion (count == total). Check `ps aux | grep enrich-shard | grep -v grep` returns 0 processes.

**Step 2: Merge shard results into main JSON**

```bash
cd /Users/solal/Documents/GitHub/funzies/gcc/web
python3 scripts/merge-shards.py
```

Expected output: "Merged N enrichments" with counts for history, migration, events.

**Step 3: Create dedup-merge script**

Create `scripts/dedup-merge.py` that:

1. Loads `tribes.json` and `families.json`
2. **Normalizes names** for matching:
   - Strip prefixes: "Al ", "Al-", "Bani ", "Banu ", "House of "
   - Normalize transliterations: q↔g↔k in tribal names, oo↔u, ei↔ay, ou↔oo
   - Lowercase for comparison
3. **Finds tribe↔family matches** by normalized name or by `family.tribeId == tribe.id`
4. **Merges matched pairs**:
   - Family gets `entityClassification: "tribe+family"`
   - Family absorbs `tribe.subTribes`, `tribe.relations`
   - Pick longer `history`, union `migrationPath`, `timelineEvents`
   - Remove merged tribe from tribes.json
5. **Finds family↔family duplicates** (Al Nuaimi + Al Nuaimi Ajman, Al Thani + Al Thani Family):
   - Merge into the entry with more data
   - Remove the duplicate
6. **Adds `entityClassification: "family"` to all non-merged families** and `"tribe"` to remaining tribes (tribes keep their own classification)
7. **Sets default empty arrays** for new fields: `subTribes: []`, `relations: []` on families that don't have them
8. Writes updated files back

```python
#!/usr/bin/env python3
"""Deduplicate and merge tribe↔family entries."""
import json
import re
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parents[1] / "src" / "data"

def normalize(name: str) -> str:
    """Normalize a name for fuzzy matching."""
    n = name.lower().strip()
    for prefix in ("house of ", "banu ", "bani ", "al-", "al ", "aal "):
        if n.startswith(prefix):
            n = n[len(prefix):]
    # Common transliteration swaps
    n = re.sub(r"[_\-\s]+", "", n)
    return n

def merge_lists(a: list, b: list, key: str = "id") -> list:
    """Merge two lists, deduplicating by key."""
    seen = set()
    result = []
    for item in a + b:
        k = item.get(key, str(item))
        if isinstance(k, str) and k not in seen:
            seen.add(k)
            result.append(item)
        elif not isinstance(k, str):
            result.append(item)
    return result

def main():
    tribes = json.loads((DATA_DIR / "tribes.json").read_text())
    families = json.loads((DATA_DIR / "families.json").read_text())

    # Build normalized lookup for tribes
    tribe_by_norm = {}
    tribe_by_id = {}
    for t in tribes:
        tribe_by_norm[normalize(t["name"])] = t
        tribe_by_id[t["id"]] = t

    # Match families to tribes
    merged_tribe_ids = set()
    for f in families:
        matched_tribe = None
        # Match by tribeId
        if f.get("tribeId") and f["tribeId"] in tribe_by_id:
            matched_tribe = tribe_by_id[f["tribeId"]]
        # Match by normalized name
        if not matched_tribe:
            fn = normalize(f["name"])
            if fn in tribe_by_norm:
                matched_tribe = tribe_by_norm[fn]

        if matched_tribe:
            # Merge tribe data into family
            f["entityClassification"] = "tribe+family"
            f["subTribes"] = matched_tribe.get("subTribes", [])
            f["relations"] = matched_tribe.get("relations", [])
            # Pick longer history
            th = matched_tribe.get("history") or ""
            fh = f.get("history") or ""
            if len(th) > len(fh):
                f["history"] = th
            # Union migration paths and events
            f["migrationPath"] = merge_lists(
                f.get("migrationPath", []),
                matched_tribe.get("migrationPath", []),
                key="from"
            )
            f["timelineEvents"] = merge_lists(
                f.get("timelineEvents", []),
                matched_tribe.get("timelineEvents", []),
                key="title"
            )
            merged_tribe_ids.add(matched_tribe["id"])
            print(f"MERGED tribe+family: {f['name']} (absorbed tribe {matched_tribe['id']})")
        else:
            f.setdefault("entityClassification", "family")
            f.setdefault("subTribes", [])
            f.setdefault("relations", [])

    # Remove merged tribes
    tribes = [t for t in tribes if t["id"] not in merged_tribe_ids]
    print(f"\nRemoved {len(merged_tribe_ids)} merged tribes, {len(tribes)} tribes remain")

    # Deduplicate families (Al Nuaimi + Al Nuaimi Ajman, etc.)
    family_by_norm = {}
    dupes = []
    for i, f in enumerate(families):
        fn = normalize(f["name"])
        if fn in family_by_norm:
            existing_idx = family_by_norm[fn]
            existing = families[existing_idx]
            # Keep the one with more data
            e_score = len(existing.get("history") or "") + len(existing.get("notableFigures", []))
            f_score = len(f.get("history") or "") + len(f.get("notableFigures", []))
            if f_score > e_score:
                # New one is richer — replace
                dupes.append(existing_idx)
                family_by_norm[fn] = i
            else:
                dupes.append(i)
            print(f"DEDUP family: {f['name']} (keeping richer entry)")
        else:
            family_by_norm[fn] = i

    families = [f for i, f in enumerate(families) if i not in dupes]

    # Ensure all new fields have defaults
    for f in families:
        f.setdefault("entityClassification", "family")
        f.setdefault("subTribes", [])
        f.setdefault("relations", [])
        for fig in f.get("notableFigures", []):
            fig.setdefault("biography", None)
            fig.setdefault("achievements", [])
            fig.setdefault("birthPlace", None)
            fig.setdefault("birthCoords", None)
        for mig in f.get("migrationPath", []):
            mig.setdefault("endYear", None)

    for t in tribes:
        for mig in t.get("migrationPath", []):
            mig.setdefault("endYear", None)

    # Write
    (DATA_DIR / "tribes.json").write_text(json.dumps(tribes, indent=2, ensure_ascii=False) + "\n")
    (DATA_DIR / "families.json").write_text(json.dumps(families, indent=2, ensure_ascii=False) + "\n")

    print(f"\nFinal: {len(tribes)} tribes, {len(families)} families")

if __name__ == "__main__":
    main()
```

**Step 4: Run the dedup-merge script**

```bash
python3 scripts/dedup-merge.py
```

Review output — check which entities were merged, which were deduped.

**Step 5: Commit**

```bash
git add scripts/dedup-merge.py src/data/tribes.json src/data/families.json
git commit -m "feat: merge tribe+family duplicates, deduplicate entries, add new fields"
```

---

### Task 3: Add Missing Families

**Files:**
- Modify: `scripts/enrich-shard.py` (MISSING_GCC_FAMILIES list)
- Modify: `scripts/dedup-merge.py` (if needed)

**Step 1: Add newly discovered families to MISSING_GCC_FAMILIES**

Based on web research, add families like Al Gaz, Al Fakhro, Al Jaidah, Al Mannai, Abdul Latif Jameel, Al Kazim, Galadari, Al Naboodah, etc. (full list from research agent).

Update the `MISSING_GCC_FAMILIES` list in `scripts/enrich-shard.py` with the new entries.

**Step 2: Create a small script to add them to families.json**

```python
#!/usr/bin/env python3
"""Add newly discovered families to families.json."""
import json
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parents[1] / "src" / "data"

NEW_FAMILIES = [
    # Add the researched families here — format:
    # {"id": "al_gaz", "name": "Al Gaz", "country": "UAE", "tribal_affiliation": None},
    # ... full list from research
]

def make_empty_family(info):
    return {
        "id": info["id"], "name": info["name"], "nameAr": None,
        "familyType": "merchant", "tribeId": None, "isRuling": False,
        "rulesOver": None, "foundedYear": None, "currentHead": None,
        "legitimacyBasis": None, "originStory": None, "description": None,
        "notableFigures": [], "history": None, "modernStatus": None,
        "tribalOrigin": info.get("tribal_affiliation"),
        "migrationPath": [], "timelineEvents": [], "connections": [],
        "entityClassification": "family", "subTribes": [], "relations": [],
    }

def main():
    families = json.loads((DATA_DIR / "families.json").read_text())
    existing = {f["id"] for f in families}
    added = 0
    for nf in NEW_FAMILIES:
        if nf["id"] not in existing:
            families.append(make_empty_family(nf))
            existing.add(nf["id"])
            added += 1
            print(f"Added: {nf['name']}")
    (DATA_DIR / "families.json").write_text(json.dumps(families, indent=2, ensure_ascii=False) + "\n")
    print(f"\nAdded {added} families, total: {len(families)}")

if __name__ == "__main__":
    main()
```

**Step 3: Run it**

```bash
python3 scripts/add-families.py
```

**Step 4: Run targeted enrichment for new families only**

Modify `enrich-shard.py` work list to only include families without history, then run 3 shards:

```bash
nohup python3 -u scripts/enrich-shard.py 0 3 > /tmp/shard_new_0.log 2>&1 &
nohup python3 -u scripts/enrich-shard.py 1 3 > /tmp/shard_new_1.log 2>&1 &
nohup python3 -u scripts/enrich-shard.py 2 3 > /tmp/shard_new_2.log 2>&1 &
```

Wait for completion, then merge shards.

**Step 5: Commit**

```bash
git add scripts/add-families.py src/data/families.json
git commit -m "feat: add missing GCC families from web research"
```

---

### Task 4: Notable Figures Enrichment

**Files:**
- Create: `scripts/enrich-figures.py`

**Step 1: Create the figure enrichment script**

This is a dedicated script that does Wikipedia research specifically for notable figures per family. Key differences from main enrichment:

- Searches for "List of rulers of [emirate/country]", "[Family] members Wikipedia", individual figure names
- Prompt specifically asks for **all rulers in succession**, current leadership, key figures
- Targets 15-25 figures for ruling families, 5-10 for major merchants
- Each figure gets: full name, title, role, born/died, 2-3 paragraph biography, achievements, birthplace+coords
- Strong anti-hallucination: only include figures found in Wikipedia research
- Merges into existing notableFigures (dedup by fuzzy name match)

```python
#!/usr/bin/env python3
"""
Enrich notable figures for all families. Usage: python enrich-figures.py <shard> <total>
"""
import json, os, re, sys, time, urllib.request, urllib.parse
from pathlib import Path

SHARD = int(sys.argv[1])
TOTAL = int(sys.argv[2])

ENV_PATH = Path(__file__).resolve().parents[3] / "web" / ".env.local"
if ENV_PATH.exists():
    for line in ENV_PATH.read_text().splitlines():
        if line.startswith("ANTHROPIC_API_KEY="):
            os.environ["ANTHROPIC_API_KEY"] = line.split("=", 1)[1].strip()

API_KEY = os.environ.get("ANTHROPIC_API_KEY")
DATA_DIR = Path(__file__).resolve().parents[1] / "src" / "data"
SHARD_DIR = DATA_DIR / "shards"
SHARD_DIR.mkdir(exist_ok=True)

def wiki_search(query, limit=5):
    url = "https://en.wikipedia.org/w/api.php?" + urllib.parse.urlencode({
        "action": "query", "list": "search", "srsearch": query,
        "format": "json", "srlimit": str(limit),
    })
    req = urllib.request.Request(url, headers={"User-Agent": "GCCFigures/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return json.loads(resp.read()).get("query", {}).get("search", [])
    except Exception:
        return []

def wiki_article(title):
    url = "https://en.wikipedia.org/w/api.php?" + urllib.parse.urlencode({
        "action": "query", "titles": title, "prop": "extracts",
        "explaintext": "1", "format": "json",
    })
    req = urllib.request.Request(url, headers={"User-Agent": "GCCFigures/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            pages = json.loads(resp.read()).get("query", {}).get("pages", {})
            for pid, page in pages.items():
                return page.get("extract", "")
    except Exception:
        return ""
    return ""

def research_figures(family_name, rules_over, is_ruling):
    """Research notable figures for a family."""
    all_text = []
    seen = set()

    queries = [f"{family_name} family members"]
    if is_ruling and rules_over:
        queries += [
            f"List of rulers of {rules_over}",
            f"{rules_over} royal family members",
            f"House of {family_name.replace('Al ', '')}",
        ]
    queries += [f"{family_name} notable people", f"{family_name} businessman"]

    fetched = 0
    for q in queries:
        if fetched >= 8:
            break
        for r in wiki_search(q, limit=3):
            if r["title"] in seen or fetched >= 8:
                continue
            seen.add(r["title"])
            text = wiki_article(r["title"])
            if text and len(text) > 300:
                all_text.append(f"[Wikipedia: {r['title']}]\n{text}")
                fetched += 1

    return "\n\n".join(all_text)[:80000]

def call_claude(prompt, max_tokens=6000):
    data = json.dumps({
        "model": "claude-sonnet-4-20250514",
        "max_tokens": max_tokens,
        "messages": [{"role": "user", "content": prompt}]
    }).encode()
    req = urllib.request.Request(
        "https://api.anthropic.com/v1/messages", data=data,
        headers={"Content-Type": "application/json", "x-api-key": API_KEY,
                 "anthropic-version": "2023-06-01"},
    )
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                return json.loads(resp.read())["content"][0]["text"]
        except Exception as e:
            if attempt < 2:
                time.sleep(15 * (attempt + 1))
            continue
    return None

def parse_json(text):
    text = text.strip()
    if text.startswith("```"):
        text = text.split("\n", 1)[1] if "\n" in text else text[3:]
        text = text.rsplit("```", 1)[0]
    start, end = text.find("["), text.rfind("]") + 1
    if start < 0:
        start, end = text.find("{"), text.rfind("}") + 1
    if start >= 0 and end > start:
        try:
            return json.loads(text[start:end])
        except json.JSONDecodeError:
            fixed = re.sub(r',\s*}', '}', re.sub(r',\s*]', ']', text[start:end]))
            try:
                return json.loads(fixed)
            except:
                return None
    return None

def figure_prompt(family, research):
    target = "15-25" if family.get("isRuling") else "5-10"
    existing_names = [f.get("name", "") for f in family.get("notableFigures", [])]

    return f"""You are a historian. Research the notable figures of this family using ONLY the research provided.

FAMILY: {family['name']}
{"RULING FAMILY of " + (family.get('rulesOver') or 'unknown') if family.get('isRuling') else 'Merchant/business family'}
EXISTING FIGURES (do not duplicate): {json.dumps(existing_names)}

RESEARCH:
{research}

Return a JSON ARRAY of {target} notable figures. For ruling families, include ALL rulers in historical succession plus current key figures.

CRITICAL: Only include people actually mentioned in the research. Do NOT invent figures.

Return format:
[
  {{
    "id": "snake_case_id",
    "name": "Full Name",
    "nameAr": null,
    "familyId": "{family['id']}",
    "tribeId": null,
    "bornYear": 1918,
    "diedYear": 2004,
    "title": "Ruler of Abu Dhabi",
    "roleDescription": "Brief 1-sentence role",
    "era": "20th century",
    "significance": "1-2 sentence significance",
    "biography": "2-3 paragraph detailed biography covering early life, rise to power/prominence, key achievements, and legacy. Be specific with dates and events from the research.",
    "achievements": ["Achievement 1", "Achievement 2"],
    "birthPlace": "Al Ain",
    "birthCoords": [24.2, 55.7]
  }}
]

ONLY JSON array. No commentary."""

def main():
    families = json.loads((DATA_DIR / "families.json").read_text())

    # Prioritize ruling families, then by existing figure count (ascending)
    work = sorted(families, key=lambda f: (0 if f.get("isRuling") else 1, len(f.get("notableFigures", []))))
    my_work = [w for i, w in enumerate(work) if i % TOTAL == SHARD]

    print(f"[Shard {SHARD}/{TOTAL}] Total: {len(work)}, my share: {len(my_work)}")

    results = []
    for idx, family in enumerate(my_work):
        print(f"[S{SHARD}][{idx+1}/{len(my_work)}] {family['name']}...", end=" ", flush=True)

        research = research_figures(
            family["name"],
            family.get("rulesOver"),
            family.get("isRuling")
        )

        if not research:
            print("NO RESEARCH")
            time.sleep(1)
            continue

        prompt = figure_prompt(family, research)
        response = call_claude(prompt, max_tokens=6000)
        if not response:
            print("FAILED")
            time.sleep(2)
            continue

        figures = parse_json(response)
        if not figures or not isinstance(figures, list):
            print("BAD JSON")
            time.sleep(2)
            continue

        results.append({
            "family_id": family["id"],
            "figures": figures,
        })
        print(f"OK ({len(figures)} figures)")

        if len(results) % 5 == 0:
            (SHARD_DIR / f"figures_{SHARD}.json").write_text(
                json.dumps(results, indent=2, ensure_ascii=False))

        time.sleep(2)

    (SHARD_DIR / f"figures_{SHARD}.json").write_text(
        json.dumps(results, indent=2, ensure_ascii=False))
    print(f"\n[Shard {SHARD}] DONE: {len(results)} families enriched")

if __name__ == "__main__":
    main()
```

**Step 2: Run 3 parallel shards**

```bash
nohup python3 -u scripts/enrich-figures.py 0 3 > /tmp/figures_0.log 2>&1 &
nohup python3 -u scripts/enrich-figures.py 1 3 > /tmp/figures_1.log 2>&1 &
nohup python3 -u scripts/enrich-figures.py 2 3 > /tmp/figures_2.log 2>&1 &
```

**Step 3: Create merge script for figures**

```python
#!/usr/bin/env python3
"""Merge enriched figures into families.json."""
import json
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parents[1] / "src" / "data"
SHARD_DIR = DATA_DIR / "shards"

def normalize_name(name):
    return name.lower().strip().replace("sheikh ", "").replace("bin ", "").replace("  ", " ")

def main():
    families = json.loads((DATA_DIR / "families.json").read_text())
    family_idx = {f["id"]: i for i, f in enumerate(families)}

    total_added = 0
    for shard_file in sorted(SHARD_DIR.glob("figures_*.json")):
        data = json.loads(shard_file.read_text())
        print(f"Loading {shard_file.name}: {len(data)} families")

        for item in data:
            fid = item["family_id"]
            if fid not in family_idx:
                continue

            family = families[family_idx[fid]]
            existing_names = {normalize_name(f["name"]) for f in family.get("notableFigures", [])}

            added = 0
            for fig in item["figures"]:
                if not isinstance(fig, dict) or not fig.get("name"):
                    continue
                if normalize_name(fig["name"]) in existing_names:
                    continue
                # Ensure all fields exist
                fig.setdefault("biography", None)
                fig.setdefault("achievements", [])
                fig.setdefault("birthPlace", None)
                fig.setdefault("birthCoords", None)
                fig.setdefault("nameAr", None)
                fig.setdefault("familyId", fid)
                fig.setdefault("tribeId", None)
                family.setdefault("notableFigures", []).append(fig)
                existing_names.add(normalize_name(fig["name"]))
                added += 1

            if added:
                total_added += added
                print(f"  {family['name']}: +{added} figures (total: {len(family['notableFigures'])})")

    (DATA_DIR / "families.json").write_text(json.dumps(families, indent=2, ensure_ascii=False) + "\n")
    print(f"\nTotal figures added: {total_added}")

if __name__ == "__main__":
    main()
```

**Step 4: Wait for figure shards to complete, then merge**

```bash
python3 scripts/merge-figures.py
```

**Step 5: Commit**

```bash
git add scripts/enrich-figures.py scripts/merge-figures.py src/data/families.json
git commit -m "feat: enrich notable figures with biographies and achievements"
```

---

### Task 5: Fix "View on Map" — Pass Entity Context

**Files:**
- Modify: `src/App.tsx:54-89`
- Modify: `src/components/layout/DetailPanel.tsx:240-248`
- Modify: `src/views/MapView.tsx` (add URL param reading)

**Step 1: Add URL search params for map entity selection**

In `src/components/layout/DetailPanel.tsx`, change the "Show in Map" button (line 243) to pass entity info via URL:

```typescript
// Change this (line 241-248):
{(entity.type === 'tribe' || entity.type === 'region' || entity.type === 'ethnic') && (
  <button
    onClick={() => { onClose(); navigate('/map'); }}
    ...

// To this — also include 'family' type:
{(entity.type === 'tribe' || entity.type === 'family' || entity.type === 'region' || entity.type === 'ethnic') && (
  <button
    onClick={() => {
      const id = entity.type === 'event' ? entity.data.id : entity.data.id;
      onClose();
      navigate(`/map?entity=${entity.type}:${id}`);
    }}
    ...
```

**Step 2: Read URL params in MapView**

In `src/views/MapView.tsx`, at the top of the component, add:

```typescript
import { useSearchParams } from 'react-router-dom';

// Inside the component:
const [searchParams] = useSearchParams();

// After data loads, check for entity param:
useEffect(() => {
  const entityParam = searchParams.get('entity');
  if (entityParam) {
    const [type, id] = entityParam.split(':');
    // Find the entity in families/tribes data and set it as selected
    if (type === 'family') {
      const family = familiesData.find(f => f.id === id);
      if (family) setSelectedEntity({ type: 'family', id, name: family.name });
    } else if (type === 'tribe') {
      const tribe = tribesData.find(t => t.id === id);
      if (tribe) setSelectedEntity({ type: 'tribe', id, name: tribe.name });
    }
  }
}, [searchParams]);
```

This hooks into the existing entity selection logic that already handles map visualization.

**Step 3: Verify it works**

Run: `npx vite dev`
- Click a family in search results → detail panel opens
- Click "Show in Map" → navigates to map with entity highlighted
- Migration paths, region presence, events all visible

**Step 4: Commit**

```bash
git add src/components/layout/DetailPanel.tsx src/views/MapView.tsx
git commit -m "fix: View on Map now passes entity context and auto-selects"
```

---

### Task 6: Map Layer Toggle & All Data Layers

**Files:**
- Modify: `src/views/MapView.tsx`

**Step 1: Add layer state**

Near the top of MapView component, add:

```typescript
const [visibleLayers, setVisibleLayers] = useState({
  presence: true,
  migration: true,
  events: true,
  figures: true,
});
```

**Step 2: Add layer toggle UI**

Add a small panel (top-right, below the search combobox or in a corner) with checkboxes:

```tsx
{selectedEntity && (
  <div className="absolute top-4 right-4 bg-white/90 backdrop-blur-sm rounded-lg shadow-md p-3 z-10 text-sm space-y-1">
    {['presence', 'migration', 'events', 'figures'].map(layer => (
      <label key={layer} className="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={visibleLayers[layer as keyof typeof visibleLayers]}
          onChange={() => setVisibleLayers(prev => ({ ...prev, [layer]: !prev[layer as keyof typeof visibleLayers] }))}
          className="rounded"
        />
        <span className="capitalize">{layer}</span>
      </label>
    ))}
  </div>
)}
```

**Step 3: Gate existing layers on toggle state**

Wrap the existing migration arc rendering in `if (visibleLayers.migration)`.
Wrap region highlighting in `if (visibleLayers.presence)`.
Wrap event markers in `if (visibleLayers.events)`.

**Step 4: Add figures layer**

When a family is selected and `visibleLayers.figures` is true, render birthCoords of notable figures as small markers:

```typescript
// After the event markers section, add:
if (visibleLayers.figures && selectedFamily) {
  const figureFeatures = selectedFamily.notableFigures
    .filter(f => f.birthCoords)
    .map(f => ({
      type: 'Feature' as const,
      geometry: {
        type: 'Point' as const,
        coordinates: [f.birthCoords![1], f.birthCoords![0]], // lng, lat
      },
      properties: { name: f.name, title: f.title || '' },
    }));

  // Add as a GeoJSON source + circle layer + label layer
}
```

**Step 5: Verify and commit**

```bash
git add src/views/MapView.tsx
git commit -m "feat: map layer toggle for presence, migration, events, figures"
```

---

### Task 7: Detail Panel — Better Notable Figures Display

**Files:**
- Modify: `src/components/layout/DetailPanel.tsx:218-235`

**Step 1: Remove 8-figure cap and add scrollable list**

Change the notable figures section (lines 218-235) from `.slice(0, 8)` to show all figures in a scrollable container:

```tsx
{entity.type === 'family' && entity.data.notableFigures.length > 0 && (
  <div className="mb-6">
    <h3 className="font-display text-lg font-semibold text-text mb-2">
      Notable Figures
      <span className="text-sm font-normal text-text-tertiary ml-2">
        ({entity.data.notableFigures.length})
      </span>
    </h3>
    <div className="max-h-80 overflow-y-auto space-y-3 pr-1">
      {entity.data.notableFigures.map((fig) => (
        <button
          key={fig.id}
          onClick={() => { onClose(); navigate(`/figure/${fig.id}`); }}
          className="w-full text-left p-2 rounded-lg hover:bg-bg-subtle transition-colors"
        >
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-plum flex-shrink-0" />
            <span className="text-sm font-medium text-text">{fig.name}</span>
          </div>
          {fig.title && (
            <p className="text-xs text-text-tertiary ml-4 mt-0.5">{fig.title}</p>
          )}
          {fig.biography && (
            <p className="text-xs text-text-secondary ml-4 mt-1 line-clamp-2">{fig.biography}</p>
          )}
        </button>
      ))}
    </div>
  </div>
)}
```

**Step 2: Add tribe+family badge**

In the header section of DetailPanel, after the existing badge, add:

```tsx
{entity.type === 'family' && entity.data.entityClassification === 'tribe+family' && (
  <span className="badge-tribe ml-1">Tribe</span>
)}
```

**Step 3: Show relations for tribe+family entities**

Add after the notable figures section: if the family has `relations` (absorbed from tribe), show them the same way tribes show relations.

**Step 4: Verify and commit**

```bash
git add src/components/layout/DetailPanel.tsx
git commit -m "feat: better notable figures display, tribe+family badge, scrollable list"
```

---

### Task 8: Update Enrichment Prompts for Date Ranges

**Files:**
- Modify: `scripts/enrich-shard.py` (tribe_prompt and family_prompt functions)

**Step 1: Update migration path schema in prompts**

In both `tribe_prompt` and `family_prompt`, change the migrationPath example to include endYear:

```python
"migrationPath": [{"year":1790,"endYear":1830,"from":"Liwa","fromCoords":[23.1,53.8],"to":"Abu Dhabi","toCoords":[24.45,54.38],"description":"..."}]
```

Add to the rules: `"endYear: null if single event, otherwise end of migration period."`

**Step 2: Commit**

```bash
git add scripts/enrich-shard.py
git commit -m "feat: enrichment prompts now ask for migration date ranges"
```

---

### Task 9: Migration Timeline — Render Date Ranges

**Files:**
- Modify: `src/views/MapView.tsx` (migration label rendering)

**Step 1: Update labels to show ranges**

Wherever migration year labels are rendered on the map or in the sidebar panel, change from just showing `year` to showing `year–endYear` when endYear exists:

```typescript
const yearLabel = mig.endYear
  ? `${mig.year}–${mig.endYear}`
  : `${mig.year}`;
```

Apply this in:
- Migration waypoint labels on the map
- Migration info panel sidebar
- Timeline event markers

**Step 2: Commit**

```bash
git add src/views/MapView.tsx
git commit -m "feat: migration labels show date ranges when endYear exists"
```

---

### Task 10: Final Verification & Cleanup

**Step 1: Build check**

```bash
cd /Users/solal/Documents/GitHub/funzies/gcc/web
npx vite build
```

Fix any type errors or build failures.

**Step 2: Visual verification**

```bash
npx vite dev
```

Check:
- Search for "Al Nahyan" → shows as "Tribe & Family" → detail panel has 15+ notable figures with bios
- Click "Show in Map" → map highlights with all layers visible
- Toggle layers on/off
- Search for "Al Khoory" → accurate Persian merchant origin
- Migration paths show date ranges
- Newly added families (Al Gaz, etc.) appear in search

**Step 3: Final commit**

```bash
git add -A
git commit -m "feat: complete data quality and UX overhaul"
```
