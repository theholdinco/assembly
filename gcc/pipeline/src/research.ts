import { getDb, upsertSource, setPipelineStatus, getPendingEntities } from "./db/client.js";
import {
  fetchWikipediaFull,
  searchWikipedia,
  extractWikipediaTitleFromUrl,
  sleep,
} from "./web.js";

const MAX_RAW_TEXT_LENGTH = 10_000;

// Contextual suffixes used as fallback if plain name search yields no results
const SEARCH_SUFFIXES: Record<string, string> = {
  tribe: "tribe",
  family: "family",
  notable_figure: "sheikh",
  ethnic_group: "people",
  event: "history",
  region: "geography",
};

function getEntityName(
  db: ReturnType<typeof getDb>,
  entityType: string,
  entityId: string,
): string {
  const tableMap: Record<string, string> = {
    tribe: "tribes",
    family: "families",
    notable_figure: "notable_figures",
    ethnic_group: "ethnic_groups",
    event: "historical_events",
    region: "regions",
    connection: "cross_border_connections",
  };
  const table = tableMap[entityType];
  if (!table) return entityId;

  const nameCol = entityType === "event" || entityType === "connection" ? "title" : "name";
  const row = db
    .prepare(`SELECT ${nameCol} FROM ${table} WHERE id = ?`)
    .get(entityId) as Record<string, string> | undefined;
  return row?.[nameCol] ?? entityId;
}

function ensureResearchCacheTable(db: ReturnType<typeof getDb>) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS research_cache (
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      raw_text TEXT,
      fetched_at TEXT,
      PRIMARY KEY(entity_type, entity_id)
    );
  `);
}

function getExistingWikipediaUrl(
  db: ReturnType<typeof getDb>,
  entityType: string,
  entityId: string,
): string | null {
  const row = db
    .prepare(
      `SELECT url FROM sources WHERE entity_type = ? AND entity_id = ? AND source_type = 'wikipedia' AND url IS NOT NULL LIMIT 1`,
    )
    .get(entityType, entityId) as { url: string } | undefined;
  return row?.url ?? null;
}

interface FetchedSource {
  url: string;
  title: string;
  text: string;
}

async function researchEntity(
  db: ReturnType<typeof getDb>,
  entityType: string,
  entityId: string,
  entityName: string,
): Promise<{ chars: number; sourceCount: number }> {
  const fetched: FetchedSource[] = [];

  // Check for existing Wikipedia URL from seed data
  const existingUrl = getExistingWikipediaUrl(db, entityType, entityId);
  if (existingUrl) {
    const title = extractWikipediaTitleFromUrl(existingUrl);
    if (title) {
      const text = await fetchWikipediaFull(title);
      if (text) {
        fetched.push({ url: existingUrl, title, text });
      }
    }
  }

  // Search Wikipedia for the entity — try plain name first, then with context suffix
  let searchResults = await searchWikipedia(entityName);
  if (searchResults.length === 0) {
    const suffix = SEARCH_SUFFIXES[entityType] ?? "";
    if (suffix) {
      searchResults = await searchWikipedia(`${entityName} ${suffix}`);
    }
  }

  // Fetch top 2-3 search results (skip any we already fetched)
  const existingTitle = existingUrl ? extractWikipediaTitleFromUrl(existingUrl) : "";
  const toFetch = searchResults
    .filter((t) => t.toLowerCase() !== existingTitle.toLowerCase())
    .slice(0, fetched.length > 0 ? 2 : 3);

  for (const title of toFetch) {
    await sleep(100);
    const text = await fetchWikipediaFull(title);
    if (text) {
      const url = `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, "_"))}`;
      fetched.push({ url, title, text });
    }
  }

  // Combine all text, truncate to max length
  let combined = "";
  for (const src of fetched) {
    const header = `\n\n=== ${src.title} ===\n`;
    const remaining = MAX_RAW_TEXT_LENGTH - combined.length - header.length;
    if (remaining <= 0) break;
    combined += header + src.text.slice(0, remaining);
  }

  // Store each source
  const now = new Date().toISOString();
  for (const src of fetched) {
    upsertSource(db, {
      entity_type: entityType,
      entity_id: entityId,
      url: src.url,
      source_type: "wikipedia",
      title: src.title,
      retrieved_at: now,
      reliability: "moderate",
    });
  }

  // Cache the combined text
  db.prepare(
    `INSERT OR REPLACE INTO research_cache (entity_type, entity_id, raw_text, fetched_at)
     VALUES (?, ?, ?, ?)`,
  ).run(entityType, entityId, combined, now);

  // Update pipeline status
  setPipelineStatus(db, entityType, entityId, "researched");

  return { chars: combined.length, sourceCount: fetched.length };
}

// ── CLI ──────────────────────────────────────────────────────────────

function parseArgs(): {
  entityType?: string;
  id?: string;
  limit?: number;
  dryRun: boolean;
} {
  const args = process.argv.slice(2);
  let entityType: string | undefined;
  let id: string | undefined;
  let limit: number | undefined;
  let dryRun = false;

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--entity-type":
        entityType = args[++i];
        break;
      case "--id":
        id = args[++i];
        break;
      case "--limit":
        limit = parseInt(args[++i], 10);
        break;
      case "--dry-run":
        dryRun = true;
        break;
    }
  }
  return { entityType, id, limit, dryRun };
}

async function main() {
  const { entityType, id, limit, dryRun } = parseArgs();
  const db = getDb();
  ensureResearchCacheTable(db);

  // Get entities to research
  let entities = getPendingEntities(db, "seeded");

  if (entityType) {
    entities = entities.filter((e) => e.entity_type === entityType);
  }
  if (id) {
    entities = entities.filter((e) => e.entity_id === id);
  }
  if (limit) {
    entities = entities.slice(0, limit);
  }

  if (entities.length === 0) {
    console.log("No entities to research.");
    db.close();
    return;
  }

  console.log(`Found ${entities.length} entities to research.`);

  if (dryRun) {
    for (const e of entities) {
      const name = getEntityName(db, e.entity_type, e.entity_id);
      const suffix = SEARCH_SUFFIXES[e.entity_type] ?? "";
      console.log(
        `  [dry-run] ${e.entity_type}/${e.entity_id}: "${name}" → search: "${name}"${suffix ? ` (fallback: "${name} ${suffix}")` : ""}`,
      );
    }
    console.log(`\nDry run complete: ${entities.length} entities would be researched.`);
    db.close();
    return;
  }

  let researched = 0;
  let failed = 0;
  let skipped = 0;

  for (let i = 0; i < entities.length; i++) {
    const e = entities[i];
    const name = getEntityName(db, e.entity_type, e.entity_id);

    try {
      const result = await researchEntity(db, e.entity_type, e.entity_id, name);
      researched++;
      console.log(
        `Researching [${i + 1}/${entities.length}]: ${name}... (fetched ${result.chars} chars from ${result.sourceCount} sources)`,
      );
    } catch (err) {
      failed++;
      console.error(`Failed to research ${name}:`, (err as Error).message);
      setPipelineStatus(db, e.entity_type, e.entity_id, "failed", (err as Error).message);
    }
  }

  console.log(
    `\nResearch complete: ${researched} entities researched, ${failed} failed, ${skipped} skipped`,
  );
  db.close();
}

main();
