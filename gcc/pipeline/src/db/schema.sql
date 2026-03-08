-- Ansab: GCC Tribal Lineage Explorer — Full Schema

CREATE TABLE IF NOT EXISTS regions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  name_ar TEXT,
  type TEXT, -- emirate/country/oasis/island/coast/desert/city
  country TEXT,
  parent_region_id TEXT REFERENCES regions(id),
  lat REAL,
  lng REAL,
  boundary_geojson TEXT,
  strategic_importance TEXT
);

CREATE TABLE IF NOT EXISTS tribes (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  name_ar TEXT,
  formation_type TEXT, -- blood_lineage/confederation/geographic_group/political_alliance/claimed_name
  legitimacy_notes TEXT,
  ancestor_name TEXT,
  ancestor_story TEXT,
  lineage_root TEXT, -- adnani/qahtani/disputed/non_arab/unknown
  founding_era TEXT,
  origin_region_id TEXT REFERENCES regions(id),
  status TEXT, -- active/historical/absorbed/extinct
  peak_power_era TEXT,
  traditional_economy TEXT,
  alignment TEXT, -- ghafiri/hinawi/neutral/na
  description TEXT,
  color TEXT
);

CREATE TABLE IF NOT EXISTS families (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  name_ar TEXT,
  tribe_id TEXT REFERENCES tribes(id),
  family_type TEXT, -- ruling/merchant/scholarly/military/religious
  is_ruling INTEGER DEFAULT 0,
  rules_over TEXT,
  current_head TEXT,
  founded_year INTEGER,
  origin_story TEXT,
  legitimacy_basis TEXT, -- conquest/tribal_consensus/british_appointment/hereditary
  description TEXT
);

CREATE TABLE IF NOT EXISTS notable_figures (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  name_ar TEXT,
  family_id TEXT REFERENCES families(id),
  tribe_id TEXT REFERENCES tribes(id),
  born_year INTEGER,
  died_year INTEGER,
  title TEXT,
  role_description TEXT,
  era TEXT,
  significance TEXT
);

CREATE TABLE IF NOT EXISTS ethnic_groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  name_ar TEXT,
  ethnicity TEXT, -- arab/persian/baloch/african/mixed
  religion TEXT, -- sunni/shia/jewish/mixed
  identity_type TEXT, -- indigenous/diaspora/returnee/migrant/historical_minority
  pre_islamic_origins TEXT,
  population_estimate TEXT,
  traditional_economy TEXT,
  origin_narrative TEXT,
  key_tension TEXT,
  description TEXT
);

CREATE TABLE IF NOT EXISTS tribal_ancestry (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  parent_id TEXT NOT NULL REFERENCES tribes(id),
  child_id TEXT NOT NULL REFERENCES tribes(id),
  relationship TEXT, -- sub_tribe/offshoot/claimed_descent/absorbed_into/split_from
  split_year INTEGER,
  split_story TEXT,
  is_contested INTEGER DEFAULT 0,
  UNIQUE(parent_id, child_id)
);

CREATE TABLE IF NOT EXISTS tribal_relations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tribe_a_id TEXT NOT NULL REFERENCES tribes(id),
  tribe_b_id TEXT NOT NULL REFERENCES tribes(id),
  relation_type TEXT, -- alliance/rivalry/vassalage/intermarriage/trade_partnership/shared_migration
  strength TEXT, -- strong/moderate/weak/historical_only
  start_era TEXT,
  end_era TEXT,
  is_current INTEGER DEFAULT 1,
  context TEXT,
  turning_point TEXT,
  UNIQUE(tribe_a_id, tribe_b_id, relation_type)
);

CREATE TABLE IF NOT EXISTS migrations (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL, -- tribe/family/ethnic_group
  entity_id TEXT NOT NULL,
  origin_region_id TEXT REFERENCES regions(id),
  destination_region_id TEXT REFERENCES regions(id),
  waypoints TEXT, -- JSON array
  route_geojson TEXT,
  start_year INTEGER,
  end_year INTEGER,
  reason TEXT, -- conquest/water_discovery/trade/persecution/factional_split/british_pressure/economic
  narrative TEXT,
  population_estimate TEXT
);

CREATE TABLE IF NOT EXISTS historical_events (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  title_ar TEXT,
  year INTEGER,
  end_year INTEGER,
  event_type TEXT, -- coup/treaty/conquest/founding/migration/war/federation/discovery
  location_id TEXT REFERENCES regions(id),
  description TEXT,
  significance TEXT,
  outcome TEXT,
  surprise_factor TEXT
);

CREATE TABLE IF NOT EXISTS event_participants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL REFERENCES historical_events(id),
  entity_type TEXT NOT NULL, -- tribe/family/notable_figure/ethnic_group
  entity_id TEXT NOT NULL,
  role TEXT, -- instigator/defender/mediator/victim/beneficiary/negotiator
  action TEXT,
  UNIQUE(event_id, entity_type, entity_id)
);

CREATE TABLE IF NOT EXISTS territory_control (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  region_id TEXT NOT NULL REFERENCES regions(id),
  entity_type TEXT NOT NULL, -- tribe/family
  entity_id TEXT NOT NULL,
  control_type TEXT, -- sovereign/dominant/contested/minority
  start_year INTEGER,
  end_year INTEGER,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS entity_regions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT NOT NULL, -- tribe/family/ethnic_group
  entity_id TEXT NOT NULL,
  region_id TEXT NOT NULL REFERENCES regions(id),
  presence_type TEXT, -- dominant/significant/minority/historical_only/ruling
  influence_level REAL DEFAULT 0.5,
  start_era TEXT,
  end_era TEXT,
  UNIQUE(entity_type, entity_id, region_id)
);

CREATE TABLE IF NOT EXISTS cross_border_connections (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  connection_type TEXT, -- shared_lineage/ruling_family_cousins/split_migration/trade_network
  narrative TEXT,
  insight TEXT
);

CREATE TABLE IF NOT EXISTS cross_border_connection_entities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  connection_id TEXT NOT NULL REFERENCES cross_border_connections(id),
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  UNIQUE(connection_id, entity_type, entity_id)
);

CREATE TABLE IF NOT EXISTS name_origins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  surname TEXT NOT NULL,
  surname_ar TEXT,
  origin_type TEXT, -- tribal/ethnic/geographic/occupational/religious/ruling_family
  origin_entity_type TEXT,
  origin_entity_id TEXT,
  meaning TEXT,
  variants TEXT, -- JSON array
  fun_fact TEXT,
  UNIQUE(surname)
);

CREATE TABLE IF NOT EXISTS sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  url TEXT,
  source_type TEXT, -- wikipedia/academic/news/book/oral_tradition
  title TEXT,
  retrieved_at TEXT,
  reliability TEXT -- high/moderate/contested
);

CREATE TABLE IF NOT EXISTS pipeline_status (
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- pending/seeded/researched/extracted/failed
  last_updated TEXT,
  error_message TEXT,
  PRIMARY KEY(entity_type, entity_id)
);

-- Indexes

CREATE INDEX IF NOT EXISTS idx_tribes_lineage_root ON tribes(lineage_root);
CREATE INDEX IF NOT EXISTS idx_tribes_alignment ON tribes(alignment);
CREATE INDEX IF NOT EXISTS idx_tribes_origin_region ON tribes(origin_region_id);

CREATE INDEX IF NOT EXISTS idx_families_tribe ON families(tribe_id);
CREATE INDEX IF NOT EXISTS idx_families_ruling ON families(is_ruling);

CREATE INDEX IF NOT EXISTS idx_notable_figures_family ON notable_figures(family_id);
CREATE INDEX IF NOT EXISTS idx_notable_figures_tribe ON notable_figures(tribe_id);

CREATE INDEX IF NOT EXISTS idx_migrations_entity ON migrations(entity_type, entity_id);

CREATE INDEX IF NOT EXISTS idx_event_participants_event ON event_participants(event_id);
CREATE INDEX IF NOT EXISTS idx_event_participants_entity ON event_participants(entity_type, entity_id);

CREATE INDEX IF NOT EXISTS idx_entity_regions_entity ON entity_regions(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_entity_regions_region ON entity_regions(region_id);

CREATE INDEX IF NOT EXISTS idx_territory_control_region ON territory_control(region_id);
CREATE INDEX IF NOT EXISTS idx_territory_control_entity ON territory_control(entity_type, entity_id);

CREATE INDEX IF NOT EXISTS idx_sources_entity ON sources(entity_type, entity_id);

CREATE INDEX IF NOT EXISTS idx_pipeline_status_status ON pipeline_status(status);
