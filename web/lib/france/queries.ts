import { query } from "@/lib/db";
import {
  BuyerFlags,
  DashboardSummary,
  FlaggedBuyer,
  FlagStats,
  FranceBuyer,
  FranceContract,
  FranceModification,
  FranceVendor,
  InflatedContract,
  NoCompBuyer,
  ProcedureBreakdown,
  SectorCompetition,
  SpendByYear,
  TopEntity,
  VendorFlags,
} from "./types";

const CPV_LABELS: Record<string, string> = {
  "03": "Agriculture & farming",
  "09": "Petroleum & fuel",
  "14": "Mining & minerals",
  "15": "Food & beverages",
  "18": "Clothing & textiles",
  "22": "Printed matter",
  "24": "Chemical products",
  "30": "Office & computing",
  "31": "Electrical machinery",
  "32": "Radio & telecom",
  "33": "Medical equipment",
  "34": "Transport equipment",
  "35": "Security & defence",
  "37": "Musical & sporting",
  "38": "Lab & scientific",
  "39": "Furniture & furnishings",
  "42": "Industrial machinery",
  "43": "Mining machinery",
  "44": "Construction materials",
  "45": "Construction work",
  "48": "Software packages",
  "50": "Repair & maintenance",
  "51": "Installation services",
  "55": "Hotel & restaurant",
  "60": "Transport services",
  "63": "Transport support",
  "64": "Postal & telecom services",
  "65": "Utilities",
  "66": "Financial & insurance",
  "70": "Real estate",
  "71": "Architecture & engineering",
  "72": "IT services",
  "73": "R&D services",
  "75": "Administration & defence",
  "76": "Oil & gas services",
  "77": "Agriculture & forestry services",
  "79": "Business services",
  "80": "Education & training",
  "85": "Health & social",
  "90": "Sewage & waste",
  "92": "Recreation & culture",
  "98": "Other community services",
};

// Sanity filters for known data quality issues in DECP source
// Sentinels cluster at 999,999,999 and 9,999,999,999. Real contracts top out at ~500M€.
// Framework agreements list max ceilings (not actual spend) but keeping them at < 1B captures
// realistic totals (~300B€/year, matching known French procurement volume).
const SANE_AMOUNT = "amount_ht > 0 AND amount_ht < 999999999"; // 0 < amount < ~1B€
const SANE_DATE = "notification_date >= '2010-01-01' AND notification_date <= '2030-12-31'";
const SANE_BIDS = "bids_received < 1000";
const NO_COMP_FILTER = "(procedure ILIKE '%sans%concurrence%' OR procedure ILIKE '%sans publicite%' OR procedure ILIKE '%negocie sans%')";
const MAX_PLAUSIBLE_INFLATION_PCT = 100_000;

// In-memory cache for expensive aggregate queries.
// Data changes only on ingestion (daily at most), so 12hr TTL is safe.
const CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const cache = new Map<string, { data: unknown; expires: number }>();

function cached<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const entry = cache.get(key);
  if (entry && entry.expires > Date.now()) return Promise.resolve(entry.data as T);
  return fn().then((data) => {
    cache.set(key, { data, expires: Date.now() + CACHE_TTL_MS });
    return data;
  });
}

// Pre-warm cache on server startup so first visitor gets instant results.
let warmed = false;
export function warmCache(): Promise<void> {
  if (warmed) return Promise.resolve();
  warmed = true;
  // Fire-and-forget — don't block the caller
  Promise.all([
    getDashboardSummary(),
    getSpendByYear(),
    getTopBuyers(),
    getTopVendors(),
    getProcedureBreakdown(),
    getFlagStats(),
    getLowestCompetitionBuyers(10),
    getTopNoCompetitionSpenders(10),
    getWorstAmendmentInflations(10),
    getCompetitionByYear(),
    getSectorCompetition(),
  ]).catch(() => { warmed = false; }); // retry on next call if DB wasn't ready
  return Promise.resolve();
}

// --- Dashboard ---

export function getDashboardSummary(): Promise<DashboardSummary> {
  return cached("dashboard_summary", async () => {
  const rows = await query<{
    total_contracts: string;
    total_spend: string;
    unique_buyers: string;
    unique_vendors: string;
    avg_bids: string;
  }>(`
    SELECT
      COUNT(*)::text                                          AS total_contracts,
      COALESCE(SUM(CASE WHEN ${SANE_AMOUNT} THEN amount_ht END), 0)::text AS total_spend,
      COUNT(DISTINCT buyer_siret)::text                      AS unique_buyers,
      (SELECT COUNT(*)::text FROM france_vendors)            AS unique_vendors,
      COALESCE(AVG(NULLIF(bids_received, 0)) FILTER (WHERE ${SANE_BIDS}), 0)::text AS avg_bids
    FROM france_contracts
  `);
  const r = rows[0];
  return {
    total_contracts: Number(r.total_contracts),
    total_spend: Number(r.total_spend),
    unique_buyers: Number(r.unique_buyers),
    unique_vendors: Number(r.unique_vendors),
    avg_bids: Math.round(Number(r.avg_bids) * 10) / 10,
  };
  });
}

export function getSpendByYear(): Promise<SpendByYear[]> {
  return cached("spend_by_year", async () => {
  const rows = await query<{
    year: string;
    total_amount: string;
    contract_count: string;
  }>(`
    SELECT
      EXTRACT(YEAR FROM notification_date)::text  AS year,
      COALESCE(SUM(CASE WHEN ${SANE_AMOUNT} THEN amount_ht END), 0)::text AS total_amount,
      COUNT(*)::text                              AS contract_count
    FROM france_contracts
    WHERE notification_date IS NOT NULL AND ${SANE_DATE}
    GROUP BY EXTRACT(YEAR FROM notification_date)
    ORDER BY year
  `);
  return rows.map((r) => ({
    year: Number(r.year),
    total_amount: Number(r.total_amount),
    contract_count: Number(r.contract_count),
  }));
  });
}

export function getTopBuyers(limit = 10): Promise<TopEntity[]> {
  return cached(`top_buyers_${limit}`, async () => {
  const rows = await query<{
    siret: string;
    name: string;
    total_amount: string;
    contract_count: string;
  }>(
    `
    SELECT
      c.buyer_siret AS siret,
      COALESCE(b.name, c.buyer_siret) AS name,
      COALESCE(SUM(CASE WHEN ${SANE_AMOUNT} THEN c.amount_ht END), 0)::text AS total_amount,
      COUNT(*)::text AS contract_count
    FROM france_contracts c
    LEFT JOIN france_buyers b ON b.siret = c.buyer_siret
    WHERE c.buyer_siret IS NOT NULL
    GROUP BY c.buyer_siret, b.name
    ORDER BY SUM(CASE WHEN ${SANE_AMOUNT} THEN c.amount_ht END) DESC NULLS LAST
    LIMIT $1
  `,
    [limit]
  );
  return rows.map((r) => ({
    id: r.siret,
    name: r.name,
    total_amount: Number(r.total_amount),
    contract_count: Number(r.contract_count),
  }));
  });
}

export function getTopVendors(limit = 10): Promise<TopEntity[]> {
  return cached(`top_vendors_${limit}`, async () => {
  const rows = await query<{
    id: string;
    name: string;
    total_amount: string;
    contract_count: string;
  }>(
    `
    SELECT
      cv.vendor_id AS id,
      COALESCE(v.name, cv.vendor_id) AS name,
      COALESCE(SUM(CASE WHEN ${SANE_AMOUNT} THEN c.amount_ht END), 0)::text AS total_amount,
      COUNT(DISTINCT c.uid)::text AS contract_count
    FROM france_contract_vendors cv
    JOIN france_contracts c ON c.uid = cv.contract_uid
    LEFT JOIN france_vendors v ON v.id = cv.vendor_id
    GROUP BY cv.vendor_id, v.name
    ORDER BY SUM(CASE WHEN ${SANE_AMOUNT} THEN c.amount_ht END) DESC NULLS LAST
    LIMIT $1
  `,
    [limit]
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    total_amount: Number(r.total_amount),
    contract_count: Number(r.contract_count),
  }));
  });
}

export function getProcedureBreakdown(): Promise<ProcedureBreakdown[]> {
  return cached("procedure_breakdown", async () => {
  const rows = await query<{
    procedure: string;
    total_amount: string;
    contract_count: string;
    pct: string;
  }>(`
    WITH filtered AS (
      SELECT * FROM france_contracts WHERE ${SANE_AMOUNT}
    ),
    totals AS (
      SELECT SUM(amount_ht) AS grand_total FROM filtered
    )
    SELECT
      COALESCE(procedure, 'Non renseigné')                         AS procedure,
      COALESCE(SUM(amount_ht), 0)::text                            AS total_amount,
      COUNT(*)::text                                               AS contract_count,
      ROUND(
        COALESCE(SUM(amount_ht), 0) / NULLIF((SELECT grand_total FROM totals), 0) * 100,
        1
      )::text                                                      AS pct
    FROM filtered
    GROUP BY procedure
    ORDER BY SUM(amount_ht) DESC NULLS LAST
  `);
  return rows.map((r) => ({
    procedure: r.procedure,
    total_amount: Number(r.total_amount),
    contract_count: Number(r.contract_count),
    pct: Number(r.pct),
  }));
  });
}

// --- Contract explorer ---

export interface ContractFilters {
  yearFrom?: number;
  yearTo?: number;
  buyerSiret?: string;
  vendorId?: string;
  cpvDivision?: string;
  procedure?: string;
  amountMin?: number;
  amountMax?: number;
  search?: string;
  page?: number;
  pageSize?: number;
  singleBidOnly?: boolean;
  noCompetition?: boolean;
  nature?: "marche" | "accord-cadre";
  hasAmendments?: boolean;
}

export async function getContracts(
  filters: ContractFilters = {}
): Promise<{ rows: FranceContract[]; total: number }> {
  const {
    yearFrom,
    yearTo,
    buyerSiret,
    vendorId,
    cpvDivision,
    procedure,
    amountMin,
    amountMax,
    search,
    page = 1,
    pageSize = 50,
    singleBidOnly,
    noCompetition,
    nature,
    hasAmendments,
  } = filters;

  // Use c. prefix so conditions work in both COUNT and JOIN queries
  const conditions: string[] = [`c.amount_ht > 0 AND c.amount_ht < 999999999`];
  const params: unknown[] = [];

  if (yearFrom !== undefined) {
    params.push(yearFrom);
    conditions.push(`EXTRACT(YEAR FROM c.notification_date) >= $${params.length}`);
  }
  if (yearTo !== undefined) {
    params.push(yearTo);
    conditions.push(`EXTRACT(YEAR FROM c.notification_date) <= $${params.length}`);
  }
  if (buyerSiret) {
    params.push(buyerSiret);
    conditions.push(`c.buyer_siret = $${params.length}`);
  }
  if (vendorId) {
    params.push(vendorId);
    conditions.push(
      `c.uid IN (SELECT contract_uid FROM france_contract_vendors WHERE vendor_id = $${params.length})`
    );
  }
  if (cpvDivision) {
    params.push(cpvDivision);
    conditions.push(`c.cpv_division = $${params.length}`);
  }
  if (procedure) {
    params.push(procedure);
    conditions.push(`c.procedure = $${params.length}`);
  }
  if (amountMin !== undefined) {
    params.push(amountMin);
    conditions.push(`c.amount_ht >= $${params.length}`);
  }
  if (amountMax !== undefined) {
    params.push(amountMax);
    conditions.push(`c.amount_ht <= $${params.length}`);
  }
  if (search) {
    params.push(`%${search}%`);
    const idx = params.length;
    conditions.push(
      `(c.object ILIKE $${idx} OR c.buyer_name ILIKE $${idx} OR c.uid ILIKE $${idx})`
    );
  }
  if (singleBidOnly) {
    conditions.push("c.bids_received = 1");
  }
  if (noCompetition) {
    conditions.push(`(c.procedure ILIKE '%sans%concurrence%' OR c.procedure ILIKE '%sans publicite%' OR c.procedure ILIKE '%negocie sans%')`);
  }
  if (nature === "marche") {
    conditions.push("LOWER(c.nature) IN ('marché', 'marche')");
  } else if (nature === "accord-cadre") {
    conditions.push("LOWER(c.nature) IN ('accord-cadre')");
  }
  if (hasAmendments) {
    conditions.push("c.uid IN (SELECT contract_uid FROM france_modifications)");
  }

  const where = `WHERE ${conditions.join(" AND ")}`;

  const countRows = await query<{ total: string }>(
    `SELECT COUNT(*)::text AS total FROM france_contracts c ${where}`,
    params
  );
  const total = Number(countRows[0].total);

  const offset = (page - 1) * pageSize;
  params.push(pageSize);
  const limitIdx = params.length;
  params.push(offset);
  const offsetIdx = params.length;

  const rows = await query<FranceContract>(
    `
    SELECT c.*, COALESCE(b.name, c.buyer_name, c.buyer_siret) AS buyer_name
    FROM france_contracts c
    LEFT JOIN france_buyers b ON b.siret = c.buyer_siret
    ${where}
    ORDER BY c.amount_ht DESC NULLS LAST
    LIMIT $${limitIdx} OFFSET $${offsetIdx}
    `,
    params
  );

  return { rows, total };
}

// --- Contract detail ---

export async function getContractByUid(uid: string): Promise<FranceContract | null> {
  const rows = await query<FranceContract>(
    `SELECT * FROM france_contracts WHERE uid = $1`,
    [uid]
  );
  return rows[0] ?? null;
}

export async function getContractVendors(
  uid: string
): Promise<{ vendor_id: string; vendor_name: string }[]> {
  return query<{ vendor_id: string; vendor_name: string }>(
    `SELECT vendor_id, COALESCE(vendor_name, vendor_id) AS vendor_name FROM france_contract_vendors WHERE contract_uid = $1`,
    [uid]
  );
}

export async function getContractModifications(uid: string): Promise<FranceModification[]> {
  return query<FranceModification>(
    `SELECT * FROM france_modifications WHERE contract_uid = $1 ORDER BY publication_date`,
    [uid]
  );
}

// --- Vendor detail ---

export async function getVendorById(id: string): Promise<FranceVendor | null> {
  const rows = await query<FranceVendor>(`SELECT * FROM france_vendors WHERE id = $1`, [id]);
  return rows[0] ?? null;
}

export async function getVendorContracts(
  vendorId: string,
  limit = 50
): Promise<(FranceContract & { buyer_siret: string; buyer_name: string })[]> {
  return query<FranceContract & { buyer_siret: string; buyer_name: string }>(
    `
    SELECT c.*
    FROM france_contracts c
    JOIN france_contract_vendors cv ON cv.contract_uid = c.uid
    WHERE cv.vendor_id = $1 AND ${SANE_AMOUNT}
    ORDER BY c.amount_ht DESC NULLS LAST
    LIMIT $2
    `,
    [vendorId, limit]
  );
}

export async function getVendorTopBuyers(
  vendorId: string,
  limit = 10
): Promise<TopEntity[]> {
  const rows = await query<{
    siret: string;
    name: string;
    total_amount: string;
    contract_count: string;
  }>(
    `
    SELECT
      c.buyer_siret                     AS siret,
      COALESCE(b.name, c.buyer_name, c.buyer_siret) AS name,
      COALESCE(SUM(CASE WHEN ${SANE_AMOUNT} THEN c.amount_ht END), 0)::text AS total_amount,
      COUNT(*)::text                    AS contract_count
    FROM france_contracts c
    JOIN france_contract_vendors cv ON cv.contract_uid = c.uid
    LEFT JOIN france_buyers b ON b.siret = c.buyer_siret
    WHERE cv.vendor_id = $1
    GROUP BY c.buyer_siret, b.name, c.buyer_name
    ORDER BY SUM(CASE WHEN ${SANE_AMOUNT} THEN c.amount_ht END) DESC NULLS LAST
    LIMIT $2
    `,
    [vendorId, limit]
  );
  return rows.map((r) => ({
    id: r.siret,
    name: r.name,
    total_amount: Number(r.total_amount),
    contract_count: Number(r.contract_count),
  }));
}

// --- Buyer detail ---

export async function getBuyerBySiret(siret: string): Promise<FranceBuyer | null> {
  const rows = await query<FranceBuyer>(
    `SELECT * FROM france_buyers WHERE siret = $1`,
    [siret]
  );
  return rows[0] ?? null;
}

export async function getBuyerContracts(
  siret: string,
  limit = 50
): Promise<FranceContract[]> {
  return query<FranceContract>(
    `
    SELECT * FROM france_contracts
    WHERE buyer_siret = $1 AND ${SANE_AMOUNT}
    ORDER BY amount_ht DESC NULLS LAST
    LIMIT $2
    `,
    [siret, limit]
  );
}

export async function getBuyerTopVendors(
  siret: string,
  limit = 10
): Promise<TopEntity[]> {
  const rows = await query<{
    id: string;
    name: string;
    total_amount: string;
    contract_count: string;
  }>(
    `
    SELECT
      cv.vendor_id                        AS id,
      COALESCE(v.name, cv.vendor_name, cv.vendor_id) AS name,
      COALESCE(SUM(CASE WHEN ${SANE_AMOUNT} THEN c.amount_ht END), 0)::text AS total_amount,
      COUNT(*)::text                      AS contract_count
    FROM france_contracts c
    JOIN france_contract_vendors cv ON cv.contract_uid = c.uid
    LEFT JOIN france_vendors v ON v.id = cv.vendor_id
    WHERE c.buyer_siret = $1
    GROUP BY cv.vendor_id, v.name, cv.vendor_name
    ORDER BY SUM(CASE WHEN ${SANE_AMOUNT} THEN c.amount_ht END) DESC NULLS LAST
    LIMIT $2
    `,
    [siret, limit]
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    total_amount: Number(r.total_amount),
    contract_count: Number(r.contract_count),
  }));
}

export async function getBuyerProcedureBreakdown(
  siret: string
): Promise<ProcedureBreakdown[]> {
  const rows = await query<{
    procedure: string;
    total_amount: string;
    contract_count: string;
    pct: string;
  }>(
    `
    WITH filtered AS (
      SELECT * FROM france_contracts WHERE buyer_siret = $1 AND ${SANE_AMOUNT}
    ),
    totals AS (
      SELECT SUM(amount_ht) AS grand_total FROM filtered
    )
    SELECT
      COALESCE(procedure, 'Non renseigné')                         AS procedure,
      COALESCE(SUM(amount_ht), 0)::text                            AS total_amount,
      COUNT(*)::text                                               AS contract_count,
      ROUND(
        COALESCE(SUM(amount_ht), 0) / NULLIF((SELECT grand_total FROM totals), 0) * 100,
        1
      )::text                                                      AS pct
    FROM filtered
    GROUP BY procedure
    ORDER BY SUM(amount_ht) DESC NULLS LAST
    `,
    [siret]
  );
  return rows.map((r) => ({
    procedure: r.procedure,
    total_amount: Number(r.total_amount),
    contract_count: Number(r.contract_count),
    pct: Number(r.pct),
  }));
}

// --- Analytics ---

export function getVendorConcentration(
  cpvDivision?: string,
  limit = 20
): Promise<(TopEntity & { market_share: number })[]> {
  return cached(`vendor_conc_${cpvDivision}_${limit}`, async () => {
  const conditions = [`${SANE_AMOUNT}`];
  const params: unknown[] = [];

  if (cpvDivision) {
    params.push(cpvDivision);
    conditions.push(`c.cpv_division = $${params.length}`);
  }

  params.push(limit);
  const limitParam = `$${params.length}`;
  const where = `WHERE ${conditions.join(" AND ")}`;

  const rows = await query<{
    id: string;
    name: string;
    total_amount: string;
    contract_count: string;
    market_share: string;
  }>(
    `
    WITH vendor_spend AS (
      SELECT
        cv.vendor_id,
        COALESCE(v.name, cv.vendor_id) AS vendor_name,
        SUM(c.amount_ht) AS spend,
        COUNT(DISTINCT c.uid) AS cnt
      FROM france_contracts c
      JOIN france_contract_vendors cv ON cv.contract_uid = c.uid
      LEFT JOIN france_vendors v ON v.id = cv.vendor_id
      ${where}
      GROUP BY cv.vendor_id, v.name
    ),
    total AS (
      SELECT SUM(spend) AS grand_total FROM vendor_spend
    )
    SELECT
      vs.vendor_id                                                         AS id,
      vs.vendor_name                                                       AS name,
      COALESCE(vs.spend, 0)::text                                          AS total_amount,
      vs.cnt::text                                                         AS contract_count,
      ROUND(COALESCE(vs.spend, 0) / NULLIF((SELECT grand_total FROM total), 0) * 100, 2)::text
                                                                           AS market_share
    FROM vendor_spend vs
    ORDER BY vs.spend DESC NULLS LAST
    LIMIT ${limitParam}
    `,
    params
  );

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    total_amount: Number(r.total_amount),
    contract_count: Number(r.contract_count),
    market_share: Number(r.market_share),
  }));
  });
}

export function getAmendmentInflation(minPctIncrease = 50): Promise<
  {
    contract_uid: string;
    object: string;
    buyer_name: string;
    original_amount: number;
    final_amount: number;
    pct_increase: number;
    modification_count: number;
  }[]
> {
  return cached(`amendment_inflation_${minPctIncrease}`, async () => {
  const rows = await query<{
    contract_uid: string;
    object: string;
    buyer_name: string;
    original_amount: string;
    final_amount: string;
    pct_increase: string;
    modification_count: string;
  }>(
    `
    SELECT
      c.uid                                                        AS contract_uid,
      c.object,
      COALESCE(c.buyer_name, c.buyer_siret)                        AS buyer_name,
      c.amount_ht::text                                            AS original_amount,
      MAX(m.new_amount_ht)::text                                   AS final_amount,
      ROUND(
        (MAX(m.new_amount_ht) - c.amount_ht) / NULLIF(c.amount_ht, 0) * 100,
        1
      )::text                                                      AS pct_increase,
      COUNT(m.id)::text                                            AS modification_count
    FROM france_contracts c
    JOIN france_modifications m ON m.contract_uid = c.uid
    WHERE m.new_amount_ht IS NOT NULL
      AND c.amount_ht > 0 AND ${SANE_AMOUNT}
      AND m.new_amount_ht < 10000000000
    GROUP BY c.uid, c.object, c.buyer_name, c.buyer_siret, c.amount_ht
    HAVING
      (MAX(m.new_amount_ht) - c.amount_ht) / NULLIF(c.amount_ht, 0) * 100 >= $1
    ORDER BY (MAX(m.new_amount_ht) - c.amount_ht) DESC
    LIMIT 100
    `,
    [minPctIncrease]
  );

  return rows.map((r) => ({
    contract_uid: r.contract_uid,
    object: r.object,
    buyer_name: r.buyer_name,
    original_amount: Number(r.original_amount),
    final_amount: Number(r.final_amount),
    pct_increase: Number(r.pct_increase),
    modification_count: Number(r.modification_count),
  }));
  });
}

export function getCompetitionByYear(): Promise<
  {
    year: number;
    procedure: string;
    total_amount: number;
    contract_count: number;
    avg_bids: number;
  }[]
> {
  return cached("competition_by_year", async () => {
  const rows = await query<{
    year: string;
    procedure: string;
    total_amount: string;
    contract_count: string;
    avg_bids: string;
  }>(`
    SELECT
      EXTRACT(YEAR FROM notification_date)::text  AS year,
      COALESCE(procedure, 'Non renseigné')        AS procedure,
      COALESCE(SUM(CASE WHEN ${SANE_AMOUNT} THEN amount_ht END), 0)::text AS total_amount,
      COUNT(*)::text                              AS contract_count,
      ROUND(COALESCE(AVG(NULLIF(bids_received, 0)) FILTER (WHERE ${SANE_BIDS}), 0), 1)::text AS avg_bids
    FROM france_contracts
    WHERE notification_date IS NOT NULL AND ${SANE_DATE}
    GROUP BY EXTRACT(YEAR FROM notification_date), procedure
    ORDER BY year, procedure
  `);

  return rows.map((r) => ({
    year: Number(r.year),
    procedure: r.procedure,
    total_amount: Number(r.total_amount),
    contract_count: Number(r.contract_count),
    avg_bids: Number(r.avg_bids),
  }));
  });
}

export function getCpvLabel(division: string): string {
  return CPV_LABELS[division] ?? `CPV ${division}`;
}

// --- Sector competition ---

export function getSectorCompetition(): Promise<SectorCompetition[]> {
  return cached("sector_competition", async () => {
  const rows = await query<{
    cpv_division: string;
    contracts_with_bids: string;
    single_bid_pct: string;
    avg_bids: string;
    total_spend: string;
    no_comp_pct: string;
  }>(`
    SELECT
      c.cpv_division,
      COUNT(*) FILTER (WHERE c.bids_received > 0 AND ${SANE_BIDS})::text AS contracts_with_bids,
      ROUND(
        COUNT(*) FILTER (WHERE c.bids_received = 1)::numeric /
        NULLIF(COUNT(*) FILTER (WHERE c.bids_received > 0 AND ${SANE_BIDS}), 0) * 100, 1
      )::text AS single_bid_pct,
      ROUND(COALESCE(AVG(NULLIF(c.bids_received, 0)) FILTER (WHERE ${SANE_BIDS}), 0), 1)::text AS avg_bids,
      COALESCE(SUM(CASE WHEN ${SANE_AMOUNT} THEN c.amount_ht END), 0)::text AS total_spend,
      ROUND(
        COUNT(*) FILTER (WHERE ${NO_COMP_FILTER})::numeric /
        NULLIF(COUNT(*), 0) * 100, 1
      )::text AS no_comp_pct
    FROM france_contracts c
    WHERE c.cpv_division IS NOT NULL AND c.cpv_division <> ''
    GROUP BY c.cpv_division
    HAVING COUNT(*) FILTER (WHERE c.bids_received > 0 AND ${SANE_BIDS}) >= 50
    ORDER BY
      (COUNT(*) FILTER (WHERE c.bids_received = 1)::numeric /
       NULLIF(COUNT(*) FILTER (WHERE c.bids_received > 0 AND ${SANE_BIDS}), 0))
      * LN(GREATEST(COALESCE(SUM(CASE WHEN ${SANE_AMOUNT} THEN c.amount_ht END), 0), 1))
      DESC NULLS LAST
  `);
  return rows.map((r) => ({
    cpvDivision: r.cpv_division,
    label: CPV_LABELS[r.cpv_division] ?? `CPV ${r.cpv_division}`,
    contractsWithBids: Number(r.contracts_with_bids),
    singleBidPct: Number(r.single_bid_pct),
    avgBids: Number(r.avg_bids),
    totalSpend: Number(r.total_spend),
    noCompPct: Number(r.no_comp_pct),
  }));
  });
}

// --- Flags ---

export function getFlagStats(): Promise<FlagStats> {
  return cached("flag_stats", async () => {
  const rows = await query<{
    single_bid_rate: string;
    single_bid_rate_2019: string;
    no_comp_spend: string;
    no_comp_contracts: string;
    doubled_contracts: string;
    missing_bid_pct: string;
  }>(`
    WITH bid_stats AS (
      SELECT
        COUNT(*) FILTER (WHERE bids_received = 1)::numeric AS single_bid,
        COUNT(*) FILTER (WHERE bids_received > 0 AND ${SANE_BIDS})::numeric AS with_bids
      FROM france_contracts
      WHERE ${SANE_AMOUNT}
    ),
    bid_stats_2019 AS (
      SELECT
        COUNT(*) FILTER (WHERE bids_received = 1)::numeric AS single_bid,
        COUNT(*) FILTER (WHERE bids_received > 0 AND ${SANE_BIDS})::numeric AS with_bids
      FROM france_contracts
      WHERE ${SANE_AMOUNT} AND EXTRACT(YEAR FROM notification_date) = 2019
    ),
    no_comp AS (
      SELECT
        COALESCE(SUM(amount_ht), 0) AS spend,
        COUNT(*) AS cnt
      FROM france_contracts
      WHERE ${SANE_AMOUNT} AND ${NO_COMP_FILTER}
    ),
    doubled AS (
      SELECT COUNT(DISTINCT m.contract_uid) AS cnt
      FROM france_modifications m
      JOIN france_contracts c ON c.uid = m.contract_uid
      WHERE c.amount_ht > 0 AND ${SANE_AMOUNT}
        AND m.new_amount_ht > c.amount_ht * 2
        AND m.new_amount_ht < 999999999
    ),
    missing AS (
      SELECT
        COUNT(*) FILTER (WHERE bids_received IS NULL OR bids_received = 0)::numeric AS no_data,
        COUNT(*)::numeric AS total
      FROM france_contracts
    )
    SELECT
      ROUND(COALESCE(b.single_bid / NULLIF(b.with_bids, 0) * 100, 0), 1)::text AS single_bid_rate,
      ROUND(COALESCE(b19.single_bid / NULLIF(b19.with_bids, 0) * 100, 0), 1)::text AS single_bid_rate_2019,
      nc.spend::text AS no_comp_spend,
      nc.cnt::text AS no_comp_contracts,
      d.cnt::text AS doubled_contracts,
      ROUND(COALESCE(mi.no_data / NULLIF(mi.total, 0) * 100, 0), 1)::text AS missing_bid_pct
    FROM bid_stats b, bid_stats_2019 b19, no_comp nc, doubled d, missing mi
  `);
  const r = rows[0];
  return {
    singleBidRate: Number(r.single_bid_rate),
    singleBidRate2019: Number(r.single_bid_rate_2019),
    noCompetitionSpend: Number(r.no_comp_spend),
    noCompetitionContracts: Number(r.no_comp_contracts),
    doubledContracts: Number(r.doubled_contracts),
    missingBidDataPct: Number(r.missing_bid_pct),
  };
  });
}

export function getLowestCompetitionBuyers(
  limit = 10
): Promise<FlaggedBuyer[]> {
  return cached(`lowest_comp_buyers_${limit}`, async () => {
  const rows = await query<{
    siret: string;
    name: string;
    contracts_with_bids: string;
    single_bid_count: string;
    single_bid_pct: string;
    total_spend: string;
  }>(
    `
    SELECT
      c.buyer_siret AS siret,
      COALESCE(b.name, c.buyer_siret) AS name,
      COUNT(*) FILTER (WHERE c.bids_received > 0 AND ${SANE_BIDS})::text AS contracts_with_bids,
      COUNT(*) FILTER (WHERE c.bids_received = 1)::text AS single_bid_count,
      ROUND(
        COUNT(*) FILTER (WHERE c.bids_received = 1)::numeric /
        NULLIF(COUNT(*) FILTER (WHERE c.bids_received > 0 AND ${SANE_BIDS}), 0) * 100, 1
      )::text AS single_bid_pct,
      COALESCE(SUM(CASE WHEN ${SANE_AMOUNT} THEN c.amount_ht END), 0)::text AS total_spend
    FROM france_contracts c
    LEFT JOIN france_buyers b ON b.siret = c.buyer_siret
    WHERE c.buyer_siret IS NOT NULL
    GROUP BY c.buyer_siret, b.name
    HAVING COUNT(*) FILTER (WHERE c.bids_received > 0 AND ${SANE_BIDS}) >= 10
      AND COALESCE(SUM(CASE WHEN ${SANE_AMOUNT} THEN c.amount_ht END), 0) > 1000000
    ORDER BY
      (COUNT(*) FILTER (WHERE c.bids_received = 1)::numeric /
       NULLIF(COUNT(*) FILTER (WHERE c.bids_received > 0 AND ${SANE_BIDS}), 0))
      * LN(GREATEST(COALESCE(SUM(CASE WHEN ${SANE_AMOUNT} THEN c.amount_ht END), 0), 1))
      DESC NULLS LAST
    LIMIT $1
    `,
    [limit]
  );
  return rows.map((r) => ({
    siret: r.siret,
    name: r.name,
    contractsWithBids: Number(r.contracts_with_bids),
    singleBidCount: Number(r.single_bid_count),
    singleBidPct: Number(r.single_bid_pct),
    totalSpend: Number(r.total_spend),
  }));
  });
}

export function getTopNoCompetitionSpenders(
  limit = 10
): Promise<NoCompBuyer[]> {
  return cached(`top_no_comp_${limit}`, async () => {
  const rows = await query<{
    siret: string;
    name: string;
    no_comp_contracts: string;
    no_comp_spend: string;
  }>(
    `
    SELECT
      c.buyer_siret AS siret,
      COALESCE(b.name, c.buyer_siret) AS name,
      COUNT(*)::text AS no_comp_contracts,
      COALESCE(SUM(c.amount_ht), 0)::text AS no_comp_spend
    FROM france_contracts c
    LEFT JOIN france_buyers b ON b.siret = c.buyer_siret
    WHERE ${SANE_AMOUNT} AND ${NO_COMP_FILTER} AND c.buyer_siret IS NOT NULL
    GROUP BY c.buyer_siret, b.name
    HAVING COUNT(*) >= 5
    ORDER BY SUM(c.amount_ht) DESC
    LIMIT $1
    `,
    [limit]
  );
  return rows.map((r) => ({
    siret: r.siret,
    name: r.name,
    noCompContracts: Number(r.no_comp_contracts),
    noCompSpend: Number(r.no_comp_spend),
  }));
  });
}

export function getWorstAmendmentInflations(
  limit = 10
): Promise<InflatedContract[]> {
  return cached(`worst_inflations_${limit}`, async () => {
  const rows = await query<{
    uid: string;
    object: string;
    buyer_name: string;
    original_amount: string;
    final_amount: string;
    pct_increase: string;
  }>(
    `
    WITH last_mod AS (
      SELECT DISTINCT ON (contract_uid)
        contract_uid,
        new_amount_ht
      FROM france_modifications
      WHERE new_amount_ht IS NOT NULL
      ORDER BY contract_uid, publication_date DESC NULLS LAST
    )
    SELECT
      c.uid,
      c.object,
      COALESCE(c.buyer_name, c.buyer_siret) AS buyer_name,
      c.amount_ht::text AS original_amount,
      lm.new_amount_ht::text AS final_amount,
      ROUND(((lm.new_amount_ht - c.amount_ht) / NULLIF(c.amount_ht, 0) * 100)::numeric, 1)::text AS pct_increase
    FROM france_contracts c
    JOIN last_mod lm ON lm.contract_uid = c.uid
    WHERE c.amount_ht > 100000 AND ${SANE_AMOUNT}
      AND lm.new_amount_ht > c.amount_ht * 2
      AND lm.new_amount_ht < 999999999
      AND ((lm.new_amount_ht - c.amount_ht) / NULLIF(c.amount_ht, 0) * 100) < $1
    ORDER BY (lm.new_amount_ht - c.amount_ht) DESC
    LIMIT $2
    `,
    [MAX_PLAUSIBLE_INFLATION_PCT, limit]
  );
  return rows.map((r) => ({
    uid: r.uid,
    object: r.object,
    buyerName: r.buyer_name,
    originalAmount: Number(r.original_amount),
    finalAmount: Number(r.final_amount),
    pctIncrease: Number(r.pct_increase),
  }));
  });
}

export async function getBuyerFlags(siret: string): Promise<BuyerFlags> {
  const rows = await query<{
    single_bid_pct: string | null;
    no_comp_count: string;
    no_comp_spend: string;
    inflated_count: string;
  }>(
    `
    WITH buyer_bids AS (
      SELECT
        COUNT(*) FILTER (WHERE bids_received = 1) AS single_bid,
        COUNT(*) FILTER (WHERE bids_received > 0 AND ${SANE_BIDS}) AS with_bids
      FROM france_contracts
      WHERE buyer_siret = $1 AND ${SANE_AMOUNT}
    ),
    buyer_no_comp AS (
      SELECT COUNT(*) AS cnt, COALESCE(SUM(amount_ht), 0) AS spend
      FROM france_contracts
      WHERE buyer_siret = $1 AND ${SANE_AMOUNT} AND ${NO_COMP_FILTER}
    ),
    buyer_inflated AS (
      SELECT COUNT(DISTINCT m.contract_uid) AS cnt
      FROM france_modifications m
      JOIN france_contracts c ON c.uid = m.contract_uid
      WHERE c.buyer_siret = $1
        AND c.amount_ht > 0 AND ${SANE_AMOUNT}
        AND m.new_amount_ht > c.amount_ht * 2
        AND m.new_amount_ht < 999999999
    )
    SELECT
      CASE WHEN bb.with_bids >= 5 THEN
        ROUND(bb.single_bid::numeric / bb.with_bids * 100, 1)::text
      ELSE NULL END AS single_bid_pct,
      nc.cnt::text AS no_comp_count,
      nc.spend::text AS no_comp_spend,
      bi.cnt::text AS inflated_count
    FROM buyer_bids bb, buyer_no_comp nc, buyer_inflated bi
    `,
    [siret]
  );
  const r = rows[0];
  return {
    singleBidPct: r.single_bid_pct ? Number(r.single_bid_pct) : null,
    noCompetitionCount: Number(r.no_comp_count),
    noCompetitionSpend: Number(r.no_comp_spend),
    inflatedContractCount: Number(r.inflated_count),
  };
}

export async function getVendorFlags(vendorId: string): Promise<VendorFlags> {
  const rows = await query<{
    multi_vendor_contracts: string;
    top_buyer_pct: string;
    top_buyer_name: string;
    no_comp_awards: string;
  }>(
    `
    WITH vendor_contracts AS (
      SELECT cv.contract_uid, c.buyer_siret, c.buyer_name, c.amount_ht, c.procedure
      FROM france_contract_vendors cv
      JOIN france_contracts c ON c.uid = cv.contract_uid
      WHERE cv.vendor_id = $1 AND ${SANE_AMOUNT}
    ),
    multi AS (
      SELECT COUNT(*) AS cnt
      FROM vendor_contracts vc
      WHERE (SELECT COUNT(*) FROM france_contract_vendors cv2 WHERE cv2.contract_uid = vc.contract_uid) >= 3
    ),
    buyer_conc AS (
      SELECT
        COALESCE(b.name, vc.buyer_name, vc.buyer_siret) AS name,
        SUM(vc.amount_ht) AS buyer_spend,
        SUM(SUM(vc.amount_ht)) OVER () AS total_spend
      FROM vendor_contracts vc
      LEFT JOIN france_buyers b ON b.siret = vc.buyer_siret
      GROUP BY COALESCE(b.name, vc.buyer_name, vc.buyer_siret)
      ORDER BY SUM(vc.amount_ht) DESC
      LIMIT 1
    ),
    no_comp AS (
      SELECT COUNT(*) AS cnt
      FROM vendor_contracts vc
      WHERE ${NO_COMP_FILTER.replace(/procedure/g, "vc.procedure")}
    )
    SELECT
      m.cnt::text AS multi_vendor_contracts,
      ROUND(COALESCE(bc.buyer_spend / NULLIF(bc.total_spend, 0) * 100, 0), 1)::text AS top_buyer_pct,
      COALESCE(bc.name, '') AS top_buyer_name,
      nc.cnt::text AS no_comp_awards
    FROM multi m, no_comp nc
    LEFT JOIN buyer_conc bc ON true
    `,
    [vendorId]
  );
  const r = rows[0];
  return {
    multiVendorContracts: Number(r.multi_vendor_contracts),
    topBuyerConcentrationPct: Number(r.top_buyer_pct),
    topBuyerName: r.top_buyer_name,
    noCompetitionAwards: Number(r.no_comp_awards),
  };
}
