import Database from "better-sqlite3";
import { getDb } from "./db/client.js";
import { writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Helpers ────────────────────────────────────────────────────────────

function snakeToCamel(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    const camelKey = key.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
    result[camelKey] = value;
  }
  return result;
}

function snakeToCamelRows(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  return rows.map(snakeToCamel);
}

function writeJson(outDir: string, filename: string, data: unknown, pretty: boolean): void {
  const content = pretty ? JSON.stringify(data, null, 2) : JSON.stringify(data);
  const path = join(outDir, filename);
  writeFileSync(path, content, "utf-8");
  const sizeKb = (Buffer.byteLength(content, "utf-8") / 1024).toFixed(1);
  const count = Array.isArray(data) ? data.length : (data as Record<string, unknown>).events
    ? (data as Record<string, unknown[]>).events.length
    : Object.keys(data as Record<string, unknown>).length;
  console.log(`  ${filename.padEnd(22)} ${String(sizeKb).padStart(6)} KB  (${count} entries)`);
}

// ── Export functions ───────────────────────────────────────────────────

function exportTribes(db: Database.Database, outDir: string, pretty: boolean): void {
  const tribes = db.prepare("SELECT * FROM tribes ORDER BY name").all() as Record<string, unknown>[];
  const ancestry = db.prepare("SELECT * FROM tribal_ancestry").all() as Record<string, unknown>[];
  const relations = db.prepare("SELECT * FROM tribal_relations").all() as Record<string, unknown>[];

  const subTribesByParent = new Map<string, Record<string, unknown>[]>();
  for (const row of ancestry) {
    const parentId = row.parent_id as string;
    const child = db.prepare("SELECT * FROM tribes WHERE id = ?").get(row.child_id as string) as Record<string, unknown> | undefined;
    if (!child) continue;
    const entry = { ...snakeToCamel(child), relationship: row.relationship };
    if (!subTribesByParent.has(parentId)) subTribesByParent.set(parentId, []);
    subTribesByParent.get(parentId)!.push(entry);
  }

  const relationsByTribe = new Map<string, Record<string, unknown>[]>();
  for (const row of relations) {
    const aId = row.tribe_a_id as string;
    const bId = row.tribe_b_id as string;
    const baseRelation = {
      type: row.relation_type,
      context: row.context,
      strength: row.strength,
    };
    if (!relationsByTribe.has(aId)) relationsByTribe.set(aId, []);
    relationsByTribe.get(aId)!.push({ tribeId: bId, ...baseRelation });
    if (!relationsByTribe.has(bId)) relationsByTribe.set(bId, []);
    relationsByTribe.get(bId)!.push({ tribeId: aId, ...baseRelation });
  }

  const result = tribes.map((t) => ({
    ...snakeToCamel(t),
    subTribes: subTribesByParent.get(t.id as string) ?? [],
    relations: relationsByTribe.get(t.id as string) ?? [],
  }));

  writeJson(outDir, "tribes.json", result, pretty);
}

function exportFamilies(db: Database.Database, outDir: string, pretty: boolean): void {
  const families = db.prepare("SELECT * FROM families ORDER BY name").all() as Record<string, unknown>[];
  const figures = db.prepare("SELECT * FROM notable_figures").all() as Record<string, unknown>[];

  const figuresByFamily = new Map<string, Record<string, unknown>[]>();
  for (const fig of figures) {
    const familyId = fig.family_id as string | null;
    if (!familyId) continue;
    if (!figuresByFamily.has(familyId)) figuresByFamily.set(familyId, []);
    figuresByFamily.get(familyId)!.push(snakeToCamel(fig));
  }

  const result = families.map((f) => ({
    ...snakeToCamel(f),
    notableFigures: figuresByFamily.get(f.id as string) ?? [],
  }));

  writeJson(outDir, "families.json", result, pretty);
}

function exportEthnicGroups(db: Database.Database, outDir: string, pretty: boolean): void {
  const groups = db.prepare("SELECT * FROM ethnic_groups ORDER BY name").all() as Record<string, unknown>[];
  const entityRegions = db.prepare(
    "SELECT er.*, r.name as region_name FROM entity_regions er JOIN regions r ON er.region_id = r.id WHERE er.entity_type = 'ethnic_group'"
  ).all() as Record<string, unknown>[];

  const regionsByGroup = new Map<string, Record<string, unknown>[]>();
  for (const er of entityRegions) {
    const groupId = er.entity_id as string;
    if (!regionsByGroup.has(groupId)) regionsByGroup.set(groupId, []);
    regionsByGroup.get(groupId)!.push({
      regionId: er.region_id,
      regionName: er.region_name,
      presenceType: er.presence_type,
      influenceLevel: er.influence_level,
    });
  }

  const result = groups.map((g) => ({
    ...snakeToCamel(g),
    regions: regionsByGroup.get(g.id as string) ?? [],
  }));

  writeJson(outDir, "ethnicGroups.json", result, pretty);
}

function exportEvents(db: Database.Database, outDir: string, pretty: boolean): void {
  const events = db.prepare("SELECT * FROM historical_events ORDER BY year").all() as Record<string, unknown>[];
  const participants = db.prepare("SELECT * FROM event_participants").all() as Record<string, unknown>[];

  const participantsByEvent = new Map<string, Record<string, unknown>[]>();
  for (const p of participants) {
    const eventId = p.event_id as string;
    if (!participantsByEvent.has(eventId)) participantsByEvent.set(eventId, []);
    participantsByEvent.get(eventId)!.push({
      entityType: p.entity_type,
      entityId: p.entity_id,
      role: p.role,
      action: p.action,
    });
  }

  const result = events.map((e) => ({
    ...snakeToCamel(e),
    participants: participantsByEvent.get(e.id as string) ?? [],
  }));

  writeJson(outDir, "events.json", result, pretty);
}

function exportRegions(db: Database.Database, outDir: string, pretty: boolean): void {
  const regions = db.prepare("SELECT * FROM regions ORDER BY name").all() as Record<string, unknown>[];
  const entityRegions = db.prepare("SELECT * FROM entity_regions").all() as Record<string, unknown>[];
  const territoryControl = db.prepare("SELECT * FROM territory_control").all() as Record<string, unknown>[];

  const entitiesByRegion = new Map<string, Record<string, unknown>[]>();
  for (const er of entityRegions) {
    const regionId = er.region_id as string;
    if (!entitiesByRegion.has(regionId)) entitiesByRegion.set(regionId, []);
    entitiesByRegion.get(regionId)!.push({
      type: er.entity_type,
      id: er.entity_id,
      presenceType: er.presence_type,
    });
  }

  const dominantTribesByRegion = new Map<string, string[]>();
  const rulingFamilyByRegion = new Map<string, string>();
  for (const er of entityRegions) {
    const regionId = er.region_id as string;
    const presenceType = er.presence_type as string;
    if (er.entity_type === "tribe" && (presenceType === "dominant" || presenceType === "significant")) {
      if (!dominantTribesByRegion.has(regionId)) dominantTribesByRegion.set(regionId, []);
      dominantTribesByRegion.get(regionId)!.push(er.entity_id as string);
    }
    if (er.entity_type === "family" && presenceType === "ruling") {
      rulingFamilyByRegion.set(regionId, er.entity_id as string);
    }
  }

  for (const tc of territoryControl) {
    const regionId = tc.region_id as string;
    if (tc.entity_type === "tribe" && tc.control_type === "dominant") {
      if (!dominantTribesByRegion.has(regionId)) dominantTribesByRegion.set(regionId, []);
      const existing = dominantTribesByRegion.get(regionId)!;
      if (!existing.includes(tc.entity_id as string)) existing.push(tc.entity_id as string);
    }
    if (tc.entity_type === "family" && (tc.control_type === "sovereign" || tc.control_type === "dominant")) {
      rulingFamilyByRegion.set(regionId, tc.entity_id as string);
    }
  }

  const result = regions.map((r) => ({
    ...snakeToCamel(r),
    dominantTribes: dominantTribesByRegion.get(r.id as string) ?? [],
    rulingFamily: rulingFamilyByRegion.get(r.id as string) ?? null,
    entities: entitiesByRegion.get(r.id as string) ?? [],
  }));

  writeJson(outDir, "regions.json", result, pretty);
}

function exportConnections(db: Database.Database, outDir: string, pretty: boolean): void {
  const connections = db.prepare("SELECT * FROM cross_border_connections ORDER BY title").all() as Record<string, unknown>[];
  const entities = db.prepare("SELECT * FROM cross_border_connection_entities").all() as Record<string, unknown>[];

  const entitiesByConnection = new Map<string, Record<string, unknown>[]>();
  for (const e of entities) {
    const connId = e.connection_id as string;
    if (!entitiesByConnection.has(connId)) entitiesByConnection.set(connId, []);
    entitiesByConnection.get(connId)!.push({
      entityType: e.entity_type,
      entityId: e.entity_id,
    });
  }

  const result = connections.map((c) => ({
    ...snakeToCamel(c),
    entities: entitiesByConnection.get(c.id as string) ?? [],
  }));

  writeJson(outDir, "connections.json", result, pretty);
}

function exportNameLookup(db: Database.Database, outDir: string, pretty: boolean): void {
  const names = db.prepare("SELECT * FROM name_origins ORDER BY surname").all() as Record<string, unknown>[];

  const result = names.map((n) => {
    const camel = snakeToCamel(n);
    // Parse variants from JSON string to array
    if (typeof camel.variants === "string") {
      try { camel.variants = JSON.parse(camel.variants as string); } catch { /* keep as string */ }
    }
    // Build linkedEntity from origin fields
    if (camel.originEntityType && camel.originEntityId) {
      camel.linkedEntity = { type: camel.originEntityType, id: camel.originEntityId };
    }
    delete camel.originEntityType;
    delete camel.originEntityId;
    return camel;
  });

  writeJson(outDir, "nameLookup.json", result, pretty);
}

function exportMigrations(db: Database.Database, outDir: string, pretty: boolean): void {
  const migrations = db.prepare(
    `SELECT m.*,
      r1.name as origin_name, r1.lat as origin_lat, r1.lng as origin_lng,
      r2.name as destination_name, r2.lat as destination_lat, r2.lng as destination_lng
    FROM migrations m
    LEFT JOIN regions r1 ON m.origin_region_id = r1.id
    LEFT JOIN regions r2 ON m.destination_region_id = r2.id
    ORDER BY m.start_year`
  ).all() as Record<string, unknown>[];

  const result = migrations.map((m) => {
    const camel = snakeToCamel(m);
    // Parse waypoints JSON
    if (typeof camel.waypoints === "string") {
      try { camel.waypoints = JSON.parse(camel.waypoints as string); } catch { /* keep as string */ }
    }
    // Parse route GeoJSON
    if (typeof camel.routeGeojson === "string") {
      try { camel.routeGeojson = JSON.parse(camel.routeGeojson as string); } catch { /* keep as string */ }
    }
    // Structure origin/destination for map
    camel.origin = {
      regionId: camel.originRegionId,
      name: camel.originName,
      lat: camel.originLat,
      lng: camel.originLng,
    };
    camel.destination = {
      regionId: camel.destinationRegionId,
      name: camel.destinationName,
      lat: camel.destinationLat,
      lng: camel.destinationLng,
    };
    delete camel.originRegionId; delete camel.originName; delete camel.originLat; delete camel.originLng;
    delete camel.destinationRegionId; delete camel.destinationName; delete camel.destinationLat; delete camel.destinationLng;
    return camel;
  });

  writeJson(outDir, "migrations.json", result, pretty);
}

function exportGraph(db: Database.Database, outDir: string, pretty: boolean): void {
  const tribes = db.prepare("SELECT id, name, lineage_root, color FROM tribes").all() as Record<string, unknown>[];
  const families = db.prepare("SELECT id, name, tribe_id FROM families").all() as Record<string, unknown>[];
  const relations = db.prepare("SELECT * FROM tribal_relations").all() as Record<string, unknown>[];
  const ancestry = db.prepare("SELECT * FROM tribal_ancestry").all() as Record<string, unknown>[];

  // Count connections per node
  const connectionCount = new Map<string, number>();
  const inc = (id: string) => connectionCount.set(id, (connectionCount.get(id) ?? 0) + 1);

  for (const r of relations) {
    inc(r.tribe_a_id as string);
    inc(r.tribe_b_id as string);
  }
  for (const a of ancestry) {
    inc(a.parent_id as string);
    inc(a.child_id as string);
  }
  for (const f of families) {
    if (f.tribe_id) {
      inc(f.id as string);
      inc(f.tribe_id as string);
    }
  }

  const nodes: Record<string, unknown>[] = [
    ...tribes.map((t) => ({
      id: t.id,
      name: t.name,
      type: "tribe",
      group: t.lineage_root ?? "unknown",
      color: t.color,
      size: connectionCount.get(t.id as string) ?? 1,
    })),
    ...families.map((f) => ({
      id: f.id,
      name: f.name,
      type: "family",
      group: "family",
      size: connectionCount.get(f.id as string) ?? 1,
    })),
  ];

  const strengthMap: Record<string, number> = {
    strong: 1.0,
    moderate: 0.6,
    weak: 0.3,
    historical_only: 0.1,
  };

  const links: Record<string, unknown>[] = [
    ...relations.map((r) => ({
      source: r.tribe_a_id,
      target: r.tribe_b_id,
      type: r.relation_type,
      strength: strengthMap[r.strength as string] ?? 0.5,
    })),
    ...ancestry.map((a) => ({
      source: a.parent_id,
      target: a.child_id,
      type: a.relationship ?? "ancestry",
      strength: 0.8,
    })),
    ...families.filter((f) => f.tribe_id).map((f) => ({
      source: f.tribe_id,
      target: f.id,
      type: "family_of",
      strength: 0.9,
    })),
  ];

  writeJson(outDir, "graph.json", { nodes, links }, pretty);
}

function exportTimeline(db: Database.Database, outDir: string, pretty: boolean): void {
  const events = db.prepare("SELECT * FROM historical_events ORDER BY year").all() as Record<string, unknown>[];
  const participants = db.prepare("SELECT * FROM event_participants").all() as Record<string, unknown>[];

  const participantsByEvent = new Map<string, Record<string, unknown>[]>();
  for (const p of participants) {
    const eventId = p.event_id as string;
    if (!participantsByEvent.has(eventId)) participantsByEvent.set(eventId, []);
    participantsByEvent.get(eventId)!.push({
      entityType: p.entity_type,
      entityId: p.entity_id,
      role: p.role,
      action: p.action,
    });
  }

  const eras = [
    { id: "portuguese", label: "Portuguese Period", startYear: 1500, endYear: 1650, color: "#8B4513" },
    { id: "qawasim", label: "Qawasim Maritime Power", startYear: 1700, endYear: 1820, color: "#1E90FF" },
    { id: "trucial", label: "British Trucial Era", startYear: 1820, endYear: 1971, color: "#DC143C" },
    { id: "oil", label: "Oil Discovery Era", startYear: 1930, endYear: 1971, color: "#2F4F4F" },
    { id: "federation", label: "Federation Era", startYear: 1968, endYear: 1972, color: "#228B22" },
    { id: "modern", label: "Modern Era", startYear: 1972, endYear: 2026, color: "#4169E1" },
  ];

  const eventList = events.map((e) => ({
    ...snakeToCamel(e),
    participants: participantsByEvent.get(e.id as string) ?? [],
  }));

  writeJson(outDir, "timeline.json", { eras, events: eventList }, pretty);
}

function exportStats(db: Database.Database, outDir: string, pretty: boolean): void {
  const count = (table: string) =>
    (db.prepare(`SELECT COUNT(*) as c FROM ${table}`).get() as { c: number }).c;

  const countWhere = (table: string, col: string) =>
    (db.prepare(`SELECT COUNT(*) as c FROM ${table} WHERE ${col} IS NOT NULL AND ${col} != ''`).get() as { c: number }).c;

  const counts = {
    tribes: count("tribes"),
    families: count("families"),
    notableFigures: count("notable_figures"),
    ethnicGroups: count("ethnic_groups"),
    regions: count("regions"),
    events: count("historical_events"),
    migrations: count("migrations"),
    connections: count("cross_border_connections"),
    nameOrigins: count("name_origins"),
    tribalRelations: count("tribal_relations"),
    tribalAncestry: count("tribal_ancestry"),
  };

  const coverage = {
    tribesWithDescription: countWhere("tribes", "description"),
    tribesWithArabicName: countWhere("tribes", "name_ar"),
    familiesWithDescription: countWhere("families", "description"),
    eventsWithDescription: countWhere("historical_events", "description"),
    regionsWithCoordinates: countWhere("regions", "lat"),
  };

  writeJson(outDir, "stats.json", { counts, coverage, lastUpdated: new Date().toISOString() }, pretty);
}

// ── CLI ────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const pretty = args.includes("--pretty");
const outIdx = args.indexOf("--out");
const outDir = outIdx !== -1 && args[outIdx + 1]
  ? args[outIdx + 1]
  : join(__dirname, "../data/export");

mkdirSync(outDir, { recursive: true });

console.log(`Exporting to ${outDir}${pretty ? " (pretty)" : ""}...\n`);

const db = getDb();

exportTribes(db, outDir, pretty);
exportFamilies(db, outDir, pretty);
exportEthnicGroups(db, outDir, pretty);
exportEvents(db, outDir, pretty);
exportRegions(db, outDir, pretty);
exportConnections(db, outDir, pretty);
exportNameLookup(db, outDir, pretty);
exportMigrations(db, outDir, pretty);
exportGraph(db, outDir, pretty);
exportTimeline(db, outDir, pretty);
exportStats(db, outDir, pretty);

db.close();
console.log("\nExport complete!");
