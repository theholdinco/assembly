import Database from "better-sqlite3";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = join(__dirname, "schema.sql");
const DB_PATH = join(__dirname, "../../data/ansab.db");

// ── Row interfaces ──────────────────────────────────────────────────

export interface Tribe {
  id: string;
  name: string;
  name_ar?: string;
  formation_type?: string;
  legitimacy_notes?: string;
  ancestor_name?: string;
  ancestor_story?: string;
  lineage_root?: string;
  founding_era?: string;
  origin_region_id?: string;
  status?: string;
  peak_power_era?: string;
  traditional_economy?: string;
  alignment?: string;
  description?: string;
  color?: string;
}

export interface Family {
  id: string;
  name: string;
  name_ar?: string;
  tribe_id?: string;
  family_type?: string;
  is_ruling?: number;
  rules_over?: string;
  current_head?: string;
  founded_year?: number;
  origin_story?: string;
  legitimacy_basis?: string;
  description?: string;
}

export interface NotableFigure {
  id: string;
  name: string;
  name_ar?: string;
  family_id?: string;
  tribe_id?: string;
  born_year?: number;
  died_year?: number;
  title?: string;
  role_description?: string;
  era?: string;
  significance?: string;
}

export interface EthnicGroup {
  id: string;
  name: string;
  name_ar?: string;
  ethnicity?: string;
  religion?: string;
  identity_type?: string;
  pre_islamic_origins?: string;
  population_estimate?: string;
  traditional_economy?: string;
  origin_narrative?: string;
  key_tension?: string;
  description?: string;
}

export interface Region {
  id: string;
  name: string;
  name_ar?: string;
  type?: string;
  country?: string;
  parent_region_id?: string;
  lat?: number;
  lng?: number;
  boundary_geojson?: string;
  strategic_importance?: string;
}

export interface TribalAncestry {
  id?: number;
  parent_id: string;
  child_id: string;
  relationship?: string;
  split_year?: number;
  split_story?: string;
  is_contested?: number;
}

export interface TribalRelation {
  id?: number;
  tribe_a_id: string;
  tribe_b_id: string;
  relation_type?: string;
  strength?: string;
  start_era?: string;
  end_era?: string;
  is_current?: number;
  context?: string;
  turning_point?: string;
}

export interface Migration {
  id: string;
  entity_type: string;
  entity_id: string;
  origin_region_id?: string;
  destination_region_id?: string;
  waypoints?: string;
  route_geojson?: string;
  start_year?: number;
  end_year?: number;
  reason?: string;
  narrative?: string;
  population_estimate?: string;
}

export interface HistoricalEvent {
  id: string;
  title: string;
  title_ar?: string;
  year?: number;
  end_year?: number;
  event_type?: string;
  location_id?: string;
  description?: string;
  significance?: string;
  outcome?: string;
  surprise_factor?: string;
}

export interface EventParticipant {
  id?: number;
  event_id: string;
  entity_type: string;
  entity_id: string;
  role?: string;
  action?: string;
}

export interface TerritoryControl {
  id?: number;
  region_id: string;
  entity_type: string;
  entity_id: string;
  control_type?: string;
  start_year?: number;
  end_year?: number;
  notes?: string;
}

export interface EntityRegion {
  id?: number;
  entity_type: string;
  entity_id: string;
  region_id: string;
  presence_type?: string;
  influence_level?: number;
  start_era?: string;
  end_era?: string;
}

export interface CrossBorderConnection {
  id: string;
  title: string;
  connection_type?: string;
  narrative?: string;
  insight?: string;
}

export interface CrossBorderConnectionEntity {
  id?: number;
  connection_id: string;
  entity_type: string;
  entity_id: string;
}

export interface NameOrigin {
  id?: number;
  surname: string;
  surname_ar?: string;
  origin_type?: string;
  origin_entity_type?: string;
  origin_entity_id?: string;
  meaning?: string;
  variants?: string;
  fun_fact?: string;
}

export interface Source {
  id?: number;
  entity_type: string;
  entity_id: string;
  url?: string;
  source_type?: string;
  title?: string;
  retrieved_at?: string;
  reliability?: string;
}

// ── DB lifecycle ────────────────────────────────────────────────────

export function getDb(): Database.Database {
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  return db;
}

export function initDb(): Database.Database {
  const db = getDb();
  const schema = readFileSync(SCHEMA_PATH, "utf-8");
  db.exec(schema);
  return db;
}

// ── Upsert helpers ──────────────────────────────────────────────────

export function upsertRegion(db: Database.Database, r: Region) {
  db.prepare(`INSERT OR REPLACE INTO regions (id, name, name_ar, type, country, parent_region_id, lat, lng, boundary_geojson, strategic_importance)
    VALUES (@id, @name, @name_ar, @type, @country, @parent_region_id, @lat, @lng, @boundary_geojson, @strategic_importance)`).run(r);
}

export function upsertTribe(db: Database.Database, t: Tribe) {
  db.prepare(`INSERT OR REPLACE INTO tribes (id, name, name_ar, formation_type, legitimacy_notes, ancestor_name, ancestor_story, lineage_root, founding_era, origin_region_id, status, peak_power_era, traditional_economy, alignment, description, color)
    VALUES (@id, @name, @name_ar, @formation_type, @legitimacy_notes, @ancestor_name, @ancestor_story, @lineage_root, @founding_era, @origin_region_id, @status, @peak_power_era, @traditional_economy, @alignment, @description, @color)`).run(t);
}

export function upsertFamily(db: Database.Database, f: Family) {
  db.prepare(`INSERT OR REPLACE INTO families (id, name, name_ar, tribe_id, family_type, is_ruling, rules_over, current_head, founded_year, origin_story, legitimacy_basis, description)
    VALUES (@id, @name, @name_ar, @tribe_id, @family_type, @is_ruling, @rules_over, @current_head, @founded_year, @origin_story, @legitimacy_basis, @description)`).run(f);
}

export function upsertNotableFigure(db: Database.Database, n: NotableFigure) {
  db.prepare(`INSERT OR REPLACE INTO notable_figures (id, name, name_ar, family_id, tribe_id, born_year, died_year, title, role_description, era, significance)
    VALUES (@id, @name, @name_ar, @family_id, @tribe_id, @born_year, @died_year, @title, @role_description, @era, @significance)`).run(n);
}

export function upsertEthnicGroup(db: Database.Database, e: EthnicGroup) {
  db.prepare(`INSERT OR REPLACE INTO ethnic_groups (id, name, name_ar, ethnicity, religion, identity_type, pre_islamic_origins, population_estimate, traditional_economy, origin_narrative, key_tension, description)
    VALUES (@id, @name, @name_ar, @ethnicity, @religion, @identity_type, @pre_islamic_origins, @population_estimate, @traditional_economy, @origin_narrative, @key_tension, @description)`).run(e);
}

export function upsertTribalAncestry(db: Database.Database, a: TribalAncestry) {
  db.prepare(`INSERT OR REPLACE INTO tribal_ancestry (parent_id, child_id, relationship, split_year, split_story, is_contested)
    VALUES (@parent_id, @child_id, @relationship, @split_year, @split_story, @is_contested)`).run(a);
}

export function upsertTribalRelation(db: Database.Database, r: TribalRelation) {
  db.prepare(`INSERT OR REPLACE INTO tribal_relations (tribe_a_id, tribe_b_id, relation_type, strength, start_era, end_era, is_current, context, turning_point)
    VALUES (@tribe_a_id, @tribe_b_id, @relation_type, @strength, @start_era, @end_era, @is_current, @context, @turning_point)`).run(r);
}

export function upsertMigration(db: Database.Database, m: Migration) {
  db.prepare(`INSERT OR REPLACE INTO migrations (id, entity_type, entity_id, origin_region_id, destination_region_id, waypoints, route_geojson, start_year, end_year, reason, narrative, population_estimate)
    VALUES (@id, @entity_type, @entity_id, @origin_region_id, @destination_region_id, @waypoints, @route_geojson, @start_year, @end_year, @reason, @narrative, @population_estimate)`).run(m);
}

export function upsertHistoricalEvent(db: Database.Database, e: HistoricalEvent) {
  db.prepare(`INSERT OR REPLACE INTO historical_events (id, title, title_ar, year, end_year, event_type, location_id, description, significance, outcome, surprise_factor)
    VALUES (@id, @title, @title_ar, @year, @end_year, @event_type, @location_id, @description, @significance, @outcome, @surprise_factor)`).run(e);
}

export function upsertEventParticipant(db: Database.Database, p: EventParticipant) {
  db.prepare(`INSERT OR REPLACE INTO event_participants (event_id, entity_type, entity_id, role, action)
    VALUES (@event_id, @entity_type, @entity_id, @role, @action)`).run(p);
}

export function upsertTerritoryControl(db: Database.Database, t: TerritoryControl) {
  db.prepare(`INSERT INTO territory_control (region_id, entity_type, entity_id, control_type, start_year, end_year, notes)
    VALUES (@region_id, @entity_type, @entity_id, @control_type, @start_year, @end_year, @notes)`).run(t);
}

export function upsertEntityRegion(db: Database.Database, e: EntityRegion) {
  db.prepare(`INSERT OR REPLACE INTO entity_regions (entity_type, entity_id, region_id, presence_type, influence_level, start_era, end_era)
    VALUES (@entity_type, @entity_id, @region_id, @presence_type, @influence_level, @start_era, @end_era)`).run(e);
}

export function upsertCrossBorderConnection(db: Database.Database, c: CrossBorderConnection) {
  db.prepare(`INSERT OR REPLACE INTO cross_border_connections (id, title, connection_type, narrative, insight)
    VALUES (@id, @title, @connection_type, @narrative, @insight)`).run(c);
}

export function upsertCrossBorderConnectionEntity(db: Database.Database, e: CrossBorderConnectionEntity) {
  db.prepare(`INSERT OR REPLACE INTO cross_border_connection_entities (connection_id, entity_type, entity_id)
    VALUES (@connection_id, @entity_type, @entity_id)`).run(e);
}

export function upsertNameOrigin(db: Database.Database, n: NameOrigin) {
  db.prepare(`INSERT OR REPLACE INTO name_origins (surname, surname_ar, origin_type, origin_entity_type, origin_entity_id, meaning, variants, fun_fact)
    VALUES (@surname, @surname_ar, @origin_type, @origin_entity_type, @origin_entity_id, @meaning, @variants, @fun_fact)`).run(n);
}

export function upsertSource(db: Database.Database, s: Source) {
  db.prepare(`INSERT INTO sources (entity_type, entity_id, url, source_type, title, retrieved_at, reliability)
    VALUES (@entity_type, @entity_id, @url, @source_type, @title, @retrieved_at, @reliability)`).run(s);
}

// ── Pipeline status helpers ─────────────────────────────────────────

export function setPipelineStatus(
  db: Database.Database,
  entityType: string,
  entityId: string,
  status: string,
  errorMessage?: string,
) {
  db.prepare(`INSERT OR REPLACE INTO pipeline_status (entity_type, entity_id, status, last_updated, error_message)
    VALUES (@entity_type, @entity_id, @status, @last_updated, @error_message)`).run({
    entity_type: entityType,
    entity_id: entityId,
    status,
    last_updated: new Date().toISOString(),
    error_message: errorMessage ?? null,
  });
}

export function getPendingEntities(
  db: Database.Database,
  status = "pending",
): Array<{ entity_type: string; entity_id: string }> {
  return db
    .prepare("SELECT entity_type, entity_id FROM pipeline_status WHERE status = ?")
    .all(status) as Array<{ entity_type: string; entity_id: string }>;
}
