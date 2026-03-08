# Ansab Data Pipeline — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build an AI-powered research pipeline that takes a seed list of GCC tribal entities, researches each via web + Claude API, and populates a rich SQLite knowledge base with tribes, families, people, events, migrations, and relationships.

**Architecture:** Node.js + TypeScript pipeline with three stages: (1) seed parsing from reference doc, (2) AI-powered research + extraction loop, (3) cross-reference resolution. SQLite stores everything with a domain-specific schema optimized for tribal lineage data.

**Tech Stack:** Node.js 20+, TypeScript, better-sqlite3, @anthropic-ai/sdk, tsx (runner)

---

### Task 1: Scaffold Pipeline Package

**Files:**
- Create: `gcc/pipeline/package.json`
- Create: `gcc/pipeline/tsconfig.json`
- Create: `gcc/pipeline/src/index.ts` (empty entry point)
- Create: `gcc/.gitignore`

**Step 1: Create package.json**

```json
{
  "name": "ansab-pipeline",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "seed": "tsx src/seed.ts",
    "research": "tsx src/research.ts",
    "resolve": "tsx src/resolve.ts",
    "export": "tsx src/export.ts",
    "pipeline": "tsx src/index.ts",
    "db:reset": "rm -f data/ansab.db && tsx src/db/init.ts"
  },
  "dependencies": {
    "@anthropic-ai/sdk": "^0.39.0",
    "better-sqlite3": "^11.7.0"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.12",
    "@types/node": "^22.0.0",
    "tsx": "^4.19.0",
    "typescript": "^5.7.0"
  }
}
```

**Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "outDir": "dist",
    "rootDir": "src",
    "skipLibCheck": true
  },
  "include": ["src"]
}
```

**Step 3: Create .gitignore**

```
pipeline/data/ansab.db
pipeline/node_modules/
pipeline/dist/
web/node_modules/
web/dist/
.env
```

**Step 4: Create empty entry point**

`gcc/pipeline/src/index.ts` — just a placeholder:
```ts
console.log("Ansab pipeline — use individual scripts: seed, research, resolve, export");
```

**Step 5: Install dependencies**

Run: `cd gcc/pipeline && npm install`

**Step 6: Verify**

Run: `cd gcc/pipeline && npx tsx src/index.ts`
Expected: prints the placeholder message

**Step 7: Commit**

```bash
git add gcc/pipeline gcc/.gitignore
git commit -m "feat(ansab): scaffold pipeline package with deps"
```

---

### Task 2: Create SQLite Schema + DB Client

**Files:**
- Create: `gcc/pipeline/src/db/schema.sql`
- Create: `gcc/pipeline/src/db/client.ts`
- Create: `gcc/pipeline/src/db/init.ts`
- Create: `gcc/pipeline/data/` (directory)

**Step 1: Write the full schema SQL**

`gcc/pipeline/src/db/schema.sql` — the complete schema from the design doc. All tables, foreign keys, indexes. Key points:
- Use `TEXT` for IDs (slug-based like `bani_yas`, `al_nahyan`)
- Use `CREATE TABLE IF NOT EXISTS` for idempotency
- Add indexes on frequent lookup columns (entity_type + entity_id pairs, foreign keys)
- Add a `pipeline_status` table to track which entities have been researched

Full SQL includes these tables:
1. `tribes` — with formation_type, legitimacy_notes, ancestor fields, lineage_root, alignment
2. `families` — with tribe_id FK, family_type, origin_story, legitimacy_basis
3. `notable_figures` — with family_id/tribe_id FKs, significance
4. `ethnic_groups` — with identity_type, pre_islamic_origins, key_tension
5. `regions` — with boundary_geojson, parent_region_id, strategic_importance
6. `tribal_ancestry` — parent/child with split_story, is_contested
7. `tribal_relations` — with context, turning_point, strength
8. `migrations` — with waypoints JSON, route_geojson, reason, narrative
9. `historical_events` — with significance, outcome, surprise_factor
10. `event_participants` — with role, action
11. `territory_control` — with control_type, start/end year
12. `entity_regions` — with influence_level float
13. `cross_border_connections` + `cross_border_connection_entities`
14. `name_origins` — with variants JSON, meaning, fun_fact
15. `sources` — with reliability, source_type
16. `pipeline_status` — tracks research progress per entity (entity_type, entity_id, status: pending/researched/extracted/failed, last_updated)

**Step 2: Write the DB client**

`gcc/pipeline/src/db/client.ts`:
- Opens/creates SQLite DB at `gcc/pipeline/data/ansab.db`
- `initDb()` — reads schema.sql and executes it
- Typed insert/query helpers for each table using `better-sqlite3` prepared statements
- `upsertTribe(data)`, `upsertFamily(data)`, etc. — use `INSERT OR REPLACE`
- `getEntityByType(type, id)` — generic lookup
- `setPipelineStatus(entityType, entityId, status)` — track research progress
- `getPendingEntities()` — get all entities not yet researched

**Step 3: Write the init script**

`gcc/pipeline/src/db/init.ts`:
```ts
import { initDb } from "./client.js";
const db = initDb();
console.log("Database initialized successfully");
db.close();
```

**Step 4: Create data directory**

Run: `mkdir -p gcc/pipeline/data`

**Step 5: Verify**

Run: `cd gcc/pipeline && npx tsx src/db/init.ts`
Expected: "Database initialized successfully" + `data/ansab.db` file created

Run: `cd gcc/pipeline && npx tsx -e "import Database from 'better-sqlite3'; const db = new Database('data/ansab.db'); console.log(db.prepare(\"SELECT name FROM sqlite_master WHERE type='table'\").all())"`
Expected: lists all 16+ tables

**Step 6: Commit**

```bash
git add gcc/pipeline/src/db gcc/pipeline/data/.gitkeep
git commit -m "feat(ansab): add SQLite schema and DB client layer"
```

---

### Task 3: Create Reference Doc + Seed Parser

**Files:**
- Create: `gcc/reference/gcc_tribal_lineages_reference.md` (copy the reference document provided by user)
- Create: `gcc/pipeline/src/seed.ts`
- Create: `gcc/pipeline/src/types.ts`

**Step 1: Save the reference document**

Copy the full GCC tribal lineages reference markdown into `gcc/reference/gcc_tribal_lineages_reference.md`.

**Step 2: Define TypeScript types**

`gcc/pipeline/src/types.ts` — interfaces matching the DB schema:
- `SeedEntity` — `{ type: EntityType, id: string, name: string, nameAr?: string, hints: Record<string, string> }` where hints carry any info from the reference doc
- `EntityType` = `'tribe' | 'family' | 'notable_figure' | 'ethnic_group' | 'region' | 'event' | 'name_origin' | 'connection'`
- DB row types: `TribeRow`, `FamilyRow`, `NotableFigureRow`, `EthnicGroupRow`, `RegionRow`, etc.

**Step 3: Write the seed parser**

`gcc/pipeline/src/seed.ts`:
- Reads the reference markdown file
- Parses it section by section using regex/string matching to extract:
  - Every tribe name mentioned (with Arabic names where given)
  - Every family name
  - Every notable figure
  - Every ethnic group
  - Every region/emirate/country
  - Every historical event
  - Every surname in the naming conventions section
  - Every Wikipedia URL (stored as source hints)
- For each extracted entity, creates a `SeedEntity` with all available hints from the reference text
- Inserts each seed into the appropriate DB table with whatever fields are available from the reference doc
- Sets pipeline_status to 'seeded' for each entity
- Prints summary: "Seeded X tribes, Y families, Z figures, ..."

The parser should be thorough — extract EVERY entity mentioned in the reference doc, even if only briefly mentioned. The hints field carries forward any context from the reference doc that the research step can use.

**Step 4: Verify**

Run: `cd gcc/pipeline && npm run db:reset && npm run seed`
Expected: prints counts of all seeded entities, at least:
- ~40+ tribes
- ~15+ families
- ~10+ ethnic groups
- ~20+ regions
- ~10+ events

**Step 5: Commit**

```bash
git add gcc/reference gcc/pipeline/src/seed.ts gcc/pipeline/src/types.ts
git commit -m "feat(ansab): add reference doc and seed parser"
```

---

### Task 4: Build the Research Module

**Files:**
- Create: `gcc/pipeline/src/research.ts`
- Create: `gcc/pipeline/src/web.ts` (web fetching utilities)

**Step 1: Write web fetching utilities**

`gcc/pipeline/src/web.ts`:
- `fetchWikipedia(url: string): Promise<string>` — fetches a Wikipedia page, strips HTML to plain text (use Wikipedia's REST API for plain text extract: `https://en.wikipedia.org/api/rest_v1/page/summary/{title}` for summary, and `/page/html/{title}` for full content)
- `fetchWikipediaFull(title: string): Promise<string>` — gets the full article text via the MediaWiki API `action=query&prop=extracts&explaintext=true`
- `searchWeb(query: string): Promise<string[]>` — uses a simple approach: fetch Wikipedia search API to find related articles
- Rate limiting: wait 500ms between requests to be polite
- Error handling: return empty string on failure, log the error

**Step 2: Write the research orchestrator**

`gcc/pipeline/src/research.ts`:
- Gets all entities with pipeline_status = 'seeded' or 'pending'
- For each entity:
  1. If it has a Wikipedia URL hint, fetch that article's full text
  2. Also search Wikipedia for `"{entity name} tribe Arabia"` or similar queries based on entity type
  3. Collect all fetched text into a `rawResearch` string
  4. Call the extraction module (Task 5) with the raw research + entity hints
  5. Store extracted structured data into the appropriate DB tables
  6. Update pipeline_status to 'researched'
- Process entities in batches of 5 with concurrency control
- Resume capability: skip entities already marked 'researched'
- Progress logging: "Researching [N/total]: entity_name..."
- CLI flag: `--entity-type tribe` to only research tribes, `--id bani_yas` to research a single entity
- Save raw fetched text to `sources` table for provenance

**Step 3: Verify**

Run: `cd gcc/pipeline && npx tsx src/research.ts --id bani_yas`
Expected: fetches Wikipedia content for Bani Yas, prints progress, stores raw text in sources table

**Step 4: Commit**

```bash
git add gcc/pipeline/src/research.ts gcc/pipeline/src/web.ts
git commit -m "feat(ansab): add research orchestrator with Wikipedia fetching"
```

---

### Task 5: Build the Claude API Extraction Module

**Files:**
- Create: `gcc/pipeline/src/extract.ts`
- Modify: `gcc/pipeline/src/research.ts` (wire in extraction)

**Step 1: Write the extraction module**

`gcc/pipeline/src/extract.ts`:

This is the brain of the pipeline. For each entity + its raw research text, it calls Claude API to extract structured data.

- `extractEntity(entity: SeedEntity, rawText: string, db: Database): Promise<void>`
- Uses Anthropic SDK with tool use / structured output
- Different extraction prompts per entity type:

**For tribes**, the Claude prompt asks to extract:
- formation_type, legitimacy_notes (is this a real blood lineage or just a geographic grouping?)
- ancestor_name, ancestor_story
- lineage_root (adnani/qahtani/disputed)
- founding_era, peak_power_era, status
- traditional_economy, alignment (ghafiri/hinawi)
- Sub-tribes and parent tribe relationships (→ inserts into tribal_ancestry)
- Alliances and rivalries (→ inserts into tribal_relations with CONTEXT and turning points)
- Migrations (→ inserts into migrations with reasons and narratives)
- Key historical events involving this tribe (→ inserts into historical_events + event_participants)
- Notable figures (→ inserts into notable_figures)
- Regions where present (→ inserts into entity_regions)
- NEW entities discovered that aren't in the DB yet (→ seed them for future research)
- A rich description paragraph

**For families**, similar but focused on:
- Origin story, legitimacy_basis, how they rose to power
- Connection to parent tribe
- Notable members with their significance
- Key events they participated in

**For ethnic groups**: identity_type, pre_islamic_origins, key_tension, origin_narrative

**For events**: all participants with roles/actions, significance, outcome, surprise_factor

**For regions**: strategic_importance, which entities are present, territory_control records

The Claude API call should use a structured JSON schema (via tool_use) to ensure consistent output. Each extraction prompt should:
1. Provide the raw research text as context
2. Provide existing DB context (what entities/relationships already exist) to avoid duplicates
3. Ask Claude to output structured JSON matching the DB schema
4. Ask Claude to identify any NEW entities/relationships discovered in the text

**Step 2: Wire extraction into research.ts**

After fetching raw text for an entity, call `extractEntity()` to process it. Update pipeline_status to 'extracted' on success.

**Step 3: Set up .env for API key**

Create: `gcc/pipeline/.env.example`:
```
ANTHROPIC_API_KEY=your-key-here
```

The extraction module reads `process.env.ANTHROPIC_API_KEY`.

**Step 4: Verify**

Run: `cd gcc/pipeline && ANTHROPIC_API_KEY=<key> npx tsx src/research.ts --id bani_yas`
Expected: researches Bani Yas, extracts structured data, populates tribes table + tribal_ancestry + tribal_relations + migrations + notable_figures. Prints extracted data summary.

**Step 5: Commit**

```bash
git add gcc/pipeline/src/extract.ts gcc/pipeline/.env.example
git commit -m "feat(ansab): add Claude API extraction module with per-entity-type prompts"
```

---

### Task 6: Build the Resolution Module

**Files:**
- Create: `gcc/pipeline/src/resolve.ts`

**Step 1: Write the resolver**

`gcc/pipeline/src/resolve.ts`:

After all entities are researched + extracted, this pass cleans up the data:

1. **Deduplicate entities**: Find tribes/families/figures with similar names, merge them (keep the richer record)
2. **Resolve dangling references**: tribal_ancestry, tribal_relations, entity_regions etc. may reference entity IDs that don't exist — log warnings, attempt to match by name
3. **Validate relationships**: Ensure every parent_id in tribal_ancestry actually exists in tribes table
4. **Fill gaps**: For entities discovered during extraction but not yet researched, decide if they need research or can be filled from existing context
5. **Consistency check**: No tribe should be both ghafiri and hinawi. Ruling families should have is_ruling=true. Events should have at least one participant.
6. **Cross-border connections**: Identify tribes/families present in multiple countries and auto-generate cross_border_connections records
7. **Name origins**: For each family/tribe name, generate name_origins records with spelling variants

Print a resolution report: "Resolved X duplicates, Y dangling refs, Z new connections discovered"

**Step 2: Verify**

Run: `cd gcc/pipeline && npx tsx src/resolve.ts`
Expected: prints resolution report with counts

**Step 3: Commit**

```bash
git add gcc/pipeline/src/resolve.ts
git commit -m "feat(ansab): add resolution module for dedup and cross-reference validation"
```

---

### Task 7: Build the Export Module

**Files:**
- Create: `gcc/pipeline/src/export.ts`

**Step 1: Write the exporter**

`gcc/pipeline/src/export.ts`:

Exports SQLite data to optimized JSON bundles for the frontend:

1. **`tribes.json`** — All tribes with their sub-tribe relationships inlined (tree structure)
2. **`families.json`** — All families with notable figures inlined
3. **`ethnic_groups.json`** — All ethnic groups
4. **`events.json`** — All events with participants inlined
5. **`regions.json`** — All regions with entity presence data, territory control, GeoJSON
6. **`connections.json`** — All cross-border connections with linked entities
7. **`name_lookup.json`** — All name origins with variants (optimized for fuse.js search)
8. **`migrations.json`** — All migrations with route data for map animation
9. **`graph.json`** — Pre-computed graph data for D3 force layout (nodes + edges from tribal_relations)
10. **`timeline.json`** — Events sorted chronologically with era bands pre-computed
11. **`stats.json`** — Summary statistics (counts, coverage, last updated)

Each JSON file is written to `gcc/web/src/data/` (will be created when web project is scaffolded).
For now, export to `gcc/pipeline/data/export/`.

**Step 2: Verify**

Run: `cd gcc/pipeline && npx tsx src/export.ts`
Expected: creates JSON files in `data/export/`, prints file sizes and entity counts per file

**Step 3: Commit**

```bash
git add gcc/pipeline/src/export.ts
git commit -m "feat(ansab): add JSON export module for frontend data bundles"
```

---

### Task 8: Wire Up Full Pipeline + Run

**Files:**
- Modify: `gcc/pipeline/src/index.ts`

**Step 1: Wire up the full pipeline**

`gcc/pipeline/src/index.ts`:
```ts
// Full pipeline: seed → research → resolve → export
// With CLI flags: --step seed|research|resolve|export|all
// --entity-type, --id for targeted runs
// --dry-run to preview without writing
```

Steps:
1. Parse CLI args
2. If step=all or seed: run seed parser
3. If step=all or research: run research loop (with progress bar)
4. If step=all or resolve: run resolver
5. If step=all or export: run exporter
6. Print final summary

**Step 2: Run the full pipeline on a small subset first**

Run: `cd gcc/pipeline && npm run db:reset && npm run pipeline -- --step seed`
Then: `npm run pipeline -- --step research --entity-type tribe --id bani_yas`
Then: `npm run pipeline -- --step research --entity-type tribe --id al_qasimi`
Then: `npm run pipeline -- --step resolve`
Then: `npm run pipeline -- --step export`

Verify the exported JSON files look correct and contain rich data.

**Step 3: Run the full pipeline**

Run: `cd gcc/pipeline && npm run db:reset && npm run pipeline -- --step all`

This will take a while (100+ entities × Wikipedia fetch + Claude API call each). Monitor progress.

**Step 4: Commit**

```bash
git add gcc/pipeline/src/index.ts
git commit -m "feat(ansab): wire up full pipeline with CLI interface"
```

---

### Task 9: Data Quality Review + Enrichment Pass

**Files:**
- No new files — this is a data review task

**Step 1: Inspect the populated database**

Run queries to check:
- How many tribes, families, figures, events, etc.?
- Do all tribes have descriptions, formation_types, lineage_roots?
- Do tribal_ancestry records form a proper tree (no cycles)?
- Do migrations have origin and destination regions?
- Are there orphaned entities (referenced but not in DB)?
- How many cross-border connections were discovered?

**Step 2: Identify gaps**

Run: `SELECT * FROM pipeline_status WHERE status = 'failed' OR status = 'seeded'`
These entities need re-research or manual attention.

**Step 3: Enrichment re-run if needed**

For entities with thin data, re-run research with additional search queries.

**Step 4: Final export**

Run: `npm run pipeline -- --step export`
Verify JSON files are complete and well-structured.

**Step 5: Commit data export**

```bash
git add gcc/pipeline/data/export
git commit -m "feat(ansab): complete initial data population with 150+ entities"
```

---

## Execution Notes

- **API key**: Set `ANTHROPIC_API_KEY` env var before running research step
- **Cost estimate**: ~150 entities × ~1 Claude API call each ≈ ~150 calls. At ~2K tokens per extraction, roughly $3-5 total with Sonnet.
- **Rate limiting**: Pipeline should wait between API calls. 1-2 requests/second is safe.
- **Resumability**: Pipeline tracks status per entity. If interrupted, re-run picks up where it left off.
- **The reference doc is a SEED, not the truth**: The AI research step should validate, correct, and enrich beyond what the reference doc contains.
