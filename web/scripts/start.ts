import { Pool } from "pg";
import { readFileSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { spawn } from "child_process";
import {
  checkForUpdates,
  ingestAllYears,
  updateSyncMeta,
} from "../lib/france/ingest";
import { enrichBuyerNames, enrichVendorNames } from "../lib/france/enrich";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, "..");

async function runMigrations() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const schema = readFileSync(join(rootDir, "lib/schema.sql"), "utf-8");
    await pool.query(schema);

    const migrationsDir = join(rootDir, "lib/migrations");
    const files = readdirSync(migrationsDir)
      .filter((f) => f.endsWith(".sql"))
      .sort();

    for (const file of files) {
      const sql = readFileSync(join(migrationsDir, file), "utf-8");
      await pool.query(sql);
      console.log(`Migration applied: ${file}`);
    }
    console.log("All migrations completed.");
  } finally {
    await pool.end();
  }
}

async function runIngestion() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const { shouldDownload, lastModified, contentLength } =
      await checkForUpdates(pool);

    if (shouldDownload) {
      console.log("[france-ingest] New data available, ingesting...");
      const stats = await ingestAllYears(pool);
      await updateSyncMeta(pool, lastModified, contentLength, stats);
      console.log("[france-ingest] Done:", JSON.stringify(stats));
    } else {
      console.log("[france-ingest] Data is up to date, skipping.");
    }

    // Always enrich — picks up where it left off (only queries WHERE name IS NULL)
    console.log("[france-enrich] Starting name enrichment from SIRENE...");
    const buyersEnriched = await enrichBuyerNames(pool);
    const vendorsEnriched = await enrichVendorNames(pool);
    console.log(
      `[france-enrich] Done: ${buyersEnriched} buyers, ${vendorsEnriched} vendors enriched`
    );
  } catch (err) {
    console.error("[france-ingest] Failed:", err);
  } finally {
    await pool.end();
  }
}

async function main() {
  // 1. Run migrations synchronously before anything else
  await runMigrations();

  // 2. Start Next.js server
  const next = spawn("node_modules/.bin/next", ["start"], {
    cwd: rootDir,
    stdio: "inherit",
    env: process.env,
  });

  next.on("exit", (code) => process.exit(code ?? 1));

  // 3. Run France data ingestion in background (non-blocking)
  runIngestion();
}

main().catch((err) => {
  console.error("Startup failed:", err);
  process.exit(1);
});
