import { Pool } from "pg";

const API_BASE = "https://recherche-entreprises.api.gouv.fr/search";
const BATCH_SIZE = 100;
const RATE_LIMIT_MS = 250; // 4 requests/sec to be polite

interface SireneResult {
  nom_complet: string;
  siege?: { siret?: string };
  matching_etablissements?: Array<{ siret?: string }>;
}

async function lookupSiret(siret: string): Promise<string | null> {
  try {
    const res = await fetch(`${API_BASE}?q=${siret}&mtm_campaign=decp`);
    if (!res.ok) return null;
    const data = await res.json();
    const results = data.results as SireneResult[] | undefined;
    if (!results || results.length === 0) return null;
    return results[0].nom_complet || null;
  } catch {
    return null;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function enrichBuyerNames(pool: Pool): Promise<number> {
  const { rows } = await pool.query(
    `SELECT siret FROM france_buyers WHERE name IS NULL ORDER BY total_amount_ht DESC`
  );

  if (rows.length === 0) {
    console.log("[enrich] All buyers already have names.");
    return 0;
  }

  console.log(`[enrich] Enriching ${rows.length} buyers from SIRENE...`);
  let enriched = 0;
  let failed = 0;

  for (let i = 0; i < rows.length; i++) {
    const siret = rows[i].siret.trim();
    const name = await lookupSiret(siret);

    if (name) {
      await pool.query(
        `UPDATE france_buyers SET name = $1 WHERE siret = $2 AND name IS NULL`,
        [name, rows[i].siret]
      );
      // Also update buyer_name on contracts for this buyer
      await pool.query(
        `UPDATE france_contracts SET buyer_name = $1 WHERE buyer_siret = $2 AND buyer_name IS NULL`,
        [name, rows[i].siret]
      );
      enriched++;
    } else {
      failed++;
    }

    if ((i + 1) % BATCH_SIZE === 0) {
      console.log(`[enrich] Buyers: ${i + 1}/${rows.length} (${enriched} enriched, ${failed} not found)`);
    }

    await sleep(RATE_LIMIT_MS);
  }

  console.log(`[enrich] Buyers done: ${enriched} enriched, ${failed} not found out of ${rows.length}`);
  return enriched;
}

export async function enrichVendorNames(pool: Pool): Promise<number> {
  const { rows } = await pool.query(
    `SELECT id FROM france_vendors WHERE name IS NULL ORDER BY total_amount_ht DESC`
  );

  if (rows.length === 0) {
    console.log("[enrich] All vendors already have names.");
    return 0;
  }

  console.log(`[enrich] Enriching ${rows.length} vendors from SIRENE...`);
  let enriched = 0;
  let failed = 0;

  for (let i = 0; i < rows.length; i++) {
    const id = rows[i].id.trim();
    // Only lookup if ID looks like a SIRET (14 digits) or SIREN (9 digits)
    if (!/^\d{9,14}$/.test(id)) {
      failed++;
      continue;
    }

    const name = await lookupSiret(id);

    if (name) {
      await pool.query(
        `UPDATE france_vendors SET name = $1 WHERE id = $2 AND name IS NULL`,
        [name, rows[i].id]
      );
      // Also update vendor_name on contract_vendors links
      await pool.query(
        `UPDATE france_contract_vendors SET vendor_name = $1 WHERE vendor_id = $2 AND vendor_name IS NULL`,
        [name, rows[i].id]
      );
      enriched++;
    } else {
      failed++;
    }

    if ((i + 1) % BATCH_SIZE === 0) {
      console.log(`[enrich] Vendors: ${i + 1}/${rows.length} (${enriched} enriched, ${failed} not found)`);
    }

    await sleep(RATE_LIMIT_MS);
  }

  console.log(`[enrich] Vendors done: ${enriched} enriched, ${failed} not found out of ${rows.length}`);
  return enriched;
}
