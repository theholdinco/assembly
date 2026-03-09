# GCC Data Quality & UX Overhaul — Design

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix data quality issues (missing families, thin notable figures, duplicates, transliteration variants) and UI gaps (View on Map broken, map shows only migrations, no date ranges) to make the GCC tribal genealogy app comprehensive and accurate.

**Architecture:** Layered approach — let current Wikipedia enrichment shards finish, then layer dedup/merge, missing families, and a dedicated notable figures enrichment pass on top. UI changes to MapView, DetailPanel, and App state to support unified entities and richer visualization.

**Tech Stack:** React 19 + TypeScript + Vite 7 + Tailwind v4 + Mapbox GL JS. Python enrichment scripts using Wikipedia API + Anthropic Claude Sonnet.

---

## 1. Entity Merging & Deduplication

### Problem
- Al Nahyan exists as both a tribe and family — info split between them
- Al Nuaimi has 2 family entries, Al Thani has 2, Al Qasimi has 4
- Different transliterations not merged (Al Qaz / Al Gaz, etc.)
- Many families still missing from the database

### Design
- **Unified entity model**: Add `entityClassification: 'tribe' | 'family' | 'tribe+family'` to Family type
- **Merge script** (`scripts/dedup-merge.py`):
  - Absorbs matching tribe data (subTribes, relations) into family record
  - Normalizes names: strip Al-/Bani/Banu prefixes, normalize Q↔G↔K, oo↔u, ei↔ay
  - Fuzzy-matches duplicates and merges (keep richer data)
  - Removes merged tribes from tribes.json to avoid duplication
- **Missing families**: Extensive web research to find 30-50+ additional GCC families, added via enrichment pipeline
- **Detail panel**: Shows "Tribe & Family" badge for merged entities

## 2. Migration Date Ranges

### Problem
`MigrationStep.year` is a single number — many migrations span decades.

### Design
- Add `endYear: number | null` to `MigrationStep` interface
- Map labels show "1790–1830" when endYear exists
- Enrichment prompts updated to ask for date ranges
- Timeline panel renders ranges as spans, not points

## 3. Notable Figures Enrichment

### Problem
- Al Nahyan has only 3-6 figures with thin descriptions
- Missing current rulers, key political/business figures
- No biographies, just one-line role descriptions

### Design
- **New script** `scripts/enrich-figures.py`:
  - Dedicated Wikipedia research per family for members
  - Targets: 15-25 figures for ruling families, 5-10 for major merchants, 3-5 for smaller
  - Searches: "List of rulers of [emirate]", "[family] members", individual figure Wikipedia pages
  - Anti-hallucination: only include figures found in research
- **Enhanced NotableFigure type**: Add `biography: string | null`, `achievements: string[]`, `birthPlace: string | null`, `birthCoords: [number, number] | null`
- **Detail panel**: Remove 8-figure cap, show scrollable list grouped by era
- Runs as 3 parallel shards (figure enrichment is more token-intensive)

## 4. "View on Map" Fix

### Problem
DetailPanel "Show in Map" button navigates to `/map` but doesn't pass entity context — nothing highlights on the map.

### Design
- Add `mapSelectedEntity` state in App.tsx (or URL search params)
- DetailPanel sets it on "Show in Map" click
- MapView reads on mount, auto-selects entity in combobox
- This triggers existing visualization logic (regions, migrations, events)

## 5. Map Shows All Data Layers

### Problem
Selecting an entity on map only shows migration arcs and region presence. Timeline events and figure locations not visualized.

### Design
- **Layer toggle** (top-right checkboxes): Presence | Migration | Events | Figures
- All layers on by default
- **Events layer**: colored markers by eventType (conflict=red, political=blue, economic=green, etc.)
- **Figures layer**: small markers at birthCoords for notable figures
- **Connections layer**: lines to related entities (alliances, rivalries from relations array)

## Sequencing

1. Current Wikipedia enrichment shards finish (~25 min)
2. Merge shard output into main JSON files
3. Run dedup-merge script (tribe↔family merge, transliteration dedup, duplicate cleanup)
4. Add newly discovered missing families
5. Targeted enrichment for new families only
6. Notable figures enrichment pass (all families, 3 shards)
7. UI changes: types update, View on Map fix, map layer toggle, detail panel improvements
8. Final data merge and verification
