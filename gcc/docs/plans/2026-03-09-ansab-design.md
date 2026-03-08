# Ansab — GCC Tribal Lineage Explorer: Design Document

## Overview

An interactive web application for exploring the tribes, families, ethnic groups, and historical events of the Arabian Gulf. Two-phase architecture: (1) AI-powered research pipeline that builds a rich SQLite knowledge base, (2) React frontend that visualizes the data across five interconnected views.

## Architecture

```
gcc/
├── pipeline/              # Phase 1: Research & data processing (Node.js + TypeScript)
│   ├── src/
│   │   ├── seed.ts        # Parse reference doc into seed entities
│   │   ├── research.ts    # AI-powered research orchestrator
│   │   ├── extract.ts     # Claude API structured data extraction
│   │   ├── resolve.ts     # Cross-reference resolution & dedup
│   │   ├── export.ts      # SQLite → JSON export for frontend
│   │   └── db/
│   │       ├── schema.sql  # Full schema
│   │       └── client.ts   # DB access layer
│   ├── data/
│   │   └── ansab.db       # SQLite database (gitignored, rebuild from pipeline)
│   └── package.json
├── web/                   # Phase 2: React frontend
│   ├── src/
│   │   ├── components/    # Map, Tree, Timeline, Search, Connections views
│   │   ├── data/          # Exported JSON bundles from pipeline
│   │   ├── hooks/
│   │   ├── types/
│   │   └── utils/
│   ├── package.json
│   └── vite.config.ts
├── reference/
│   └── gcc_tribal_lineages_reference.md
└── docs/plans/
```

## Phase 1: Data Pipeline

### Tech Stack
- Node.js + TypeScript
- better-sqlite3 (SQLite driver)
- Anthropic SDK (Claude API for research + extraction)
- node-fetch (web fetching)

### Research Pipeline Flow
1. **Seed**: Parse reference doc → ~150 seed entities with names, types, basic info
2. **Research**: For each entity, fetch Wikipedia page + web search for additional sources
3. **Extract**: Claude API extracts structured data from raw text into schema-conforming records
4. **Discover**: During extraction, Claude identifies NEW entities/relationships not in the seed list → queue for research
5. **Resolve**: Cross-reference pass — deduplicate, link related entities, validate consistency
6. **Export**: Generate optimized JSON bundles per frontend view

### Database Schema

#### Core Entity Tables

**`tribes`**
| Column | Type | Purpose |
|--------|------|---------|
| id | TEXT PK | Slug identifier |
| name | TEXT | English name |
| name_ar | TEXT | Arabic name |
| formation_type | TEXT | blood_lineage / confederation / geographic_group / political_alliance / claimed_name |
| legitimacy_notes | TEXT | Explains formation context — "real lineage or group of people from an area?" |
| ancestor_name | TEXT | Claimed progenitor |
| ancestor_story | TEXT | Narrative around the ancestor claim |
| lineage_root | TEXT | adnani / qahtani / disputed / non_arab / unknown |
| founding_era | TEXT | Approximate century/period |
| origin_region_id | TEXT FK | Where they originally formed |
| status | TEXT | active / historical / absorbed / extinct |
| peak_power_era | TEXT | When most influential |
| traditional_economy | TEXT | Pearling, herding, farming, trade, raiding |
| alignment | TEXT | ghafiri / hinawi / neutral / na |
| description | TEXT | Rich narrative paragraph |
| color | TEXT | Hex color for visualization |

**`families`**
| Column | Type | Purpose |
|--------|------|---------|
| id | TEXT PK | |
| name | TEXT | |
| name_ar | TEXT | |
| tribe_id | TEXT FK | Parent tribe/sub-tribe |
| family_type | TEXT | ruling / merchant / scholarly / military / religious |
| is_ruling | BOOLEAN | |
| rules_over | TEXT | Emirate, country, region |
| current_head | TEXT | Name + title |
| founded_year | INTEGER | |
| origin_story | TEXT | How they came to prominence |
| legitimacy_basis | TEXT | conquest / tribal_consensus / british_appointment / hereditary |
| description | TEXT | |

**`notable_figures`**
| Column | Type | Purpose |
|--------|------|---------|
| id | TEXT PK | |
| name | TEXT | |
| name_ar | TEXT | |
| family_id | TEXT FK | |
| tribe_id | TEXT FK | |
| born_year | INTEGER | Approximate OK |
| died_year | INTEGER | |
| title | TEXT | Sheikh, Emir, Ambassador, etc. |
| role_description | TEXT | What they're known for |
| era | TEXT | Which period they shaped |
| significance | TEXT | The "wow factor" line |

**`ethnic_groups`**
| Column | Type | Purpose |
|--------|------|---------|
| id | TEXT PK | |
| name | TEXT | |
| name_ar | TEXT | |
| ethnicity | TEXT | arab / persian / baloch / african / mixed |
| religion | TEXT | sunni / shia / jewish / mixed |
| identity_type | TEXT | indigenous / diaspora / returnee / migrant / historical_minority |
| pre_islamic_origins | TEXT | Pre-Islam identity (Christian, Zoroastrian, Jewish, etc.) |
| population_estimate | TEXT | |
| traditional_economy | TEXT | |
| origin_narrative | TEXT | Deep story of origins |
| key_tension | TEXT | Political/social friction point |
| description | TEXT | |

**`regions`**
| Column | Type | Purpose |
|--------|------|---------|
| id | TEXT PK | |
| name | TEXT | |
| name_ar | TEXT | |
| type | TEXT | emirate / country / oasis / island / coast / desert / city |
| country | TEXT | |
| parent_region_id | TEXT FK | Nesting: oasis → emirate → country |
| lat | REAL | Center point latitude |
| lng | REAL | Center point longitude |
| boundary_geojson | TEXT | GeoJSON polygon for territory rendering |
| strategic_importance | TEXT | Why this place matters |

#### Relationship Tables

**`tribal_ancestry`** — Lineage tree: who descends from whom
| Column | Type | Purpose |
|--------|------|---------|
| parent_id | TEXT FK | |
| child_id | TEXT FK | |
| relationship | TEXT | sub_tribe / offshoot / claimed_descent / absorbed_into / split_from |
| split_year | INTEGER | When the split/absorption happened |
| split_story | TEXT | WHY — the narrative behind the split |
| is_contested | BOOLEAN | Is this lineage claim disputed by scholars? |

**`tribal_relations`** — Alliances, rivalries with CONTEXT
| Column | Type | Purpose |
|--------|------|---------|
| tribe_a_id | TEXT FK | |
| tribe_b_id | TEXT FK | |
| relation_type | TEXT | alliance / rivalry / vassalage / intermarriage / trade_partnership / shared_migration |
| strength | TEXT | strong / moderate / weak / historical_only |
| start_era | TEXT | |
| end_era | TEXT | |
| is_current | BOOLEAN | |
| context | TEXT | The STORY — why allies? What's the rivalry about? |
| turning_point | TEXT | The event/moment that defined this relationship |

**`migrations`** — First-class journey tracking
| Column | Type | Purpose |
|--------|------|---------|
| id | TEXT PK | |
| entity_type | TEXT | tribe / family / ethnic_group |
| entity_id | TEXT FK | |
| origin_region_id | TEXT FK | |
| destination_region_id | TEXT FK | |
| waypoints | TEXT | JSON array of intermediate region IDs |
| route_geojson | TEXT | LineString for animated map paths |
| start_year | INTEGER | |
| end_year | INTEGER | |
| reason | TEXT | conquest / water_discovery / trade / persecution / factional_split / british_pressure / economic |
| narrative | TEXT | Full story of the journey |
| population_estimate | TEXT | How many people moved |

**`historical_events`**
| Column | Type | Purpose |
|--------|------|---------|
| id | TEXT PK | |
| title | TEXT | |
| title_ar | TEXT | |
| year | INTEGER | |
| end_year | INTEGER | |
| event_type | TEXT | coup / treaty / conquest / founding / migration / war / federation / discovery |
| location_id | TEXT FK | Region where it happened |
| description | TEXT | Rich narrative |
| significance | TEXT | The "so what" — why this still echoes today |
| outcome | TEXT | What changed |
| surprise_factor | TEXT | The "did you know" angle |

**`event_participants`** — Who did what in each event
| Column | Type | Purpose |
|--------|------|---------|
| event_id | TEXT FK | |
| entity_type | TEXT | tribe / family / notable_figure / ethnic_group |
| entity_id | TEXT FK | |
| role | TEXT | instigator / defender / mediator / victim / beneficiary / negotiator |
| action | TEXT | What they specifically did |

**`territory_control`** — Who controlled what, when (for animated map)
| Column | Type | Purpose |
|--------|------|---------|
| region_id | TEXT FK | |
| entity_type | TEXT | tribe / family |
| entity_id | TEXT FK | |
| control_type | TEXT | sovereign / dominant / contested / minority |
| start_year | INTEGER | |
| end_year | INTEGER | |
| notes | TEXT | |

**`entity_regions`** — Presence mapping with intensity
| Column | Type | Purpose |
|--------|------|---------|
| entity_type | TEXT | tribe / family / ethnic_group |
| entity_id | TEXT FK | |
| region_id | TEXT FK | |
| presence_type | TEXT | dominant / significant / minority / historical_only / ruling |
| influence_level | REAL | 0.0-1.0 for heat-map rendering |
| start_era | TEXT | |
| end_era | TEXT | |

**`cross_border_connections`** — The "aha" moments
| Column | Type | Purpose |
|--------|------|---------|
| id | TEXT PK | |
| title | TEXT | e.g. "The Anizzah Super-Tribe Connection" |
| connection_type | TEXT | shared_lineage / ruling_family_cousins / split_migration / trade_network |
| narrative | TEXT | Full story |
| insight | TEXT | One-liner that makes someone go "wait, really?" |

**`cross_border_connection_entities`** — Links connections to entities
| Column | Type | Purpose |
|--------|------|---------|
| connection_id | TEXT FK | |
| entity_type | TEXT | |
| entity_id | TEXT FK | |

#### Search & Discovery

**`name_origins`** — Surname lookup
| Column | Type | Purpose |
|--------|------|---------|
| surname | TEXT | |
| surname_ar | TEXT | |
| origin_type | TEXT | tribal / ethnic / geographic / occupational / religious / ruling_family |
| origin_entity_type | TEXT | |
| origin_entity_id | TEXT FK | |
| meaning | TEXT | What the name literally means |
| variants | TEXT | JSON array of spelling variations |
| fun_fact | TEXT | |

**`sources`** — Provenance tracking
| Column | Type | Purpose |
|--------|------|---------|
| id | TEXT PK | |
| entity_type | TEXT | |
| entity_id | TEXT FK | |
| url | TEXT | |
| source_type | TEXT | wikipedia / academic / news / book / oral_tradition |
| title | TEXT | |
| retrieved_at | TEXT | ISO timestamp |
| reliability | TEXT | high / moderate / contested |

## Phase 2: Frontend (Future)

React 18 + TypeScript + Tailwind + D3.js + Vite

Five views: Map, Tree, Timeline, Search, Connections — all interconnected. JSON data bundles exported from SQLite power the frontend. Design aesthetic: "desert modernism meets museum exhibit."

Frontend design will be planned separately after the data pipeline is complete and we have real data to visualize.

## Key Design Decisions

1. **Two-phase split**: Pipeline and frontend are separate packages. Data flows one-way: pipeline → SQLite → JSON → frontend.
2. **AI research pipeline**: Claude API researches each seed entity, extracts structured data, and discovers new entities. Not just parsing a doc — actively building knowledge.
3. **Rich narratives everywhere**: Every relationship, migration, and event carries a story, not just a type label.
4. **Formation types on tribes**: Explicitly models whether a group is blood lineage, confederation, geographic, or claimed — answers "is this real?"
5. **Contested flags**: Lineage claims can be marked as disputed.
6. **Geographic first-class**: GeoJSON boundaries, route polylines, territory control over time, influence heat-maps — all baked into the schema.
7. **Temporal depth**: Territory control, relationships, and presence all have time ranges for historical scrubbing.
