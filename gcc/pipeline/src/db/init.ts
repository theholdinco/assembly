import { initDb } from "./client.js";

const db = initDb();
const tables = db
  .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
  .all() as { name: string }[];
console.log(`Database initialized with ${tables.length} tables:`);
tables.forEach((t) => console.log(`  - ${t.name}`));
db.close();
