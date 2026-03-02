import { readFileSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { Pool } from "pg";
import { config } from "dotenv";

const __dirname = dirname(fileURLToPath(import.meta.url));
if (!process.env.DATABASE_URL) {
  config({ path: join(__dirname, "../.env.local") });
}

async function migrate() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
  });

  const schema = readFileSync(join(__dirname, "schema.sql"), "utf-8");

  try {
    await pool.query(schema);
    console.log("Schema applied.");

    // Run numbered migration files in order
    const migrationsDir = join(__dirname, "migrations");
    const files = readdirSync(migrationsDir)
      .filter((f) => f.endsWith(".sql"))
      .sort();

    for (const file of files) {
      const sql = readFileSync(join(migrationsDir, file), "utf-8");
      await pool.query(sql);
      console.log(`Migration applied: ${file}`);
    }

    console.log("All migrations completed successfully.");
  } finally {
    await pool.end();
  }
}

migrate();
