import { config } from "dotenv";
import { Pool } from "pg";
import { decryptApiKey } from "../lib/crypto.js";
import { runPipeline } from "./pipeline.js";
import { getUserGithubToken, buildCodeContext } from "../lib/github.js";
import {
  runCommitteePipeline,
  runEvaluationPipeline,
  runIdeaPipeline,
} from "./ic-pipeline.js";
import {
  runPanelPipeline,
  runAnalysisPipeline,
  runScreeningPipeline,
} from "./clo-pipeline.js";
import { runSectionPpmExtraction } from "../lib/clo/extraction/ppm-extraction.js";
import { runExtraction, runSectionExtraction } from "../lib/clo/extraction/runner.js";
import { runPortfolioExtraction } from "../lib/clo/extraction/portfolio-extraction.js";
import { normalizeClassName } from "../lib/clo/api.js";
import type { CapitalStructureEntry } from "../lib/clo/types.js";
import { getApiKeyForUser, resetFreeTrial } from "../lib/trial.js";

if (!process.env.DATABASE_URL) {
  config({ path: ".env.local" });
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const POLL_INTERVAL_MS = 5000;

// ─── Daily Briefing ──────────────────────────────────────────────────
const BRIEFING_INTERVAL_MS = 20 * 60 * 60 * 1000; // 20 hours
let lastBriefingFetch = 0;

async function maybeFetchBriefing() {
  if (!process.env.BRIEF_API_KEY) return;
  const now = Date.now();
  if (now - lastBriefingFetch < BRIEFING_INTERVAL_MS) return;
  lastBriefingFetch = now;

  for (const briefType of ["general", "clo"] as const) {
    const existing = await pool.query(
      "SELECT id FROM daily_briefings WHERE brief_type = $1 AND fetched_at > now() - interval '20 hours' LIMIT 1",
      [briefType]
    );
    if (existing.rows.length > 0) continue;

    const res = await fetch(`http://89.167.78.232:3000/briefing/${briefType}?id=-1`, {
      headers: { Authorization: `Bearer ${process.env.BRIEF_API_KEY}` },
    });
    if (!res.ok) {
      console.error(`[worker] ${briefType} briefing fetch failed:`, res.status);
      continue;
    }
    const content = await res.text();

    await pool.query(
      "INSERT INTO daily_briefings (brief_type, content) VALUES ($1, $2)",
      [briefType, content]
    );
    console.log(`[worker] Daily ${briefType} briefing fetched and stored`);
  }
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/[\s]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

async function claimJob(): Promise<{
  id: string;
  topic_input: string;
  user_id: string;
  raw_files: Record<string, string>;
  attachments: Array<{ name: string; type: string; size: number; base64: string; textContent?: string }>;
  slug: string;
  github_repo_owner: string | null;
  github_repo_name: string | null;
  github_repo_branch: string | null;
  saved_character_ids: string[];
} | null> {
  const result = await pool.query(
    `UPDATE assemblies SET status = 'running', current_phase = 'domain-analysis'
     WHERE id = (
       SELECT id FROM assemblies WHERE status = 'queued'
       ORDER BY created_at LIMIT 1
       FOR UPDATE SKIP LOCKED
     )
     RETURNING id, topic_input, user_id, raw_files, attachments, slug, github_repo_owner, github_repo_name, github_repo_branch, saved_character_ids`
  );
  return result.rows[0] ?? null;
}

async function getUserApiKey(
  userId: string
): Promise<{ encrypted: Buffer; iv: Buffer }> {
  const result = await pool.query(
    `SELECT encrypted_api_key, api_key_iv FROM users WHERE id = $1`,
    [userId]
  );
  const row = result.rows[0];
  if (!row?.encrypted_api_key || !row?.api_key_iv) {
    throw new Error(`No API key found for user ${userId}`);
  }
  return {
    encrypted: Buffer.from(row.encrypted_api_key),
    iv: Buffer.from(row.api_key_iv),
  };
}

async function processJob(job: {
  id: string;
  topic_input: string;
  user_id: string;
  raw_files: Record<string, string>;
  attachments: Array<{ name: string; type: string; size: number; base64: string; textContent?: string }>;
  slug: string;
  github_repo_owner: string | null;
  github_repo_name: string | null;
  github_repo_branch: string | null;
  saved_character_ids: string[];
}) {
  const { apiKey } = await getApiKeyForUser(job.user_id);
  const slug = job.slug || slugify(job.topic_input);

  if (!job.slug) {
    await pool.query(`UPDATE assemblies SET slug = $1 WHERE id = $2`, [
      slug,
      job.id,
    ]);
  }

  let codeContext: string | undefined;
  if (job.github_repo_owner && job.github_repo_name) {
    try {
      await pool.query(
        `UPDATE assemblies SET current_phase = 'code-analysis' WHERE id = $1`,
        [job.id]
      );
      const githubToken = await getUserGithubToken(job.user_id);
      if (githubToken) {
        codeContext = await buildCodeContext(
          githubToken,
          job.github_repo_owner,
          job.github_repo_name,
          job.github_repo_branch || "main",
          job.topic_input,
          apiKey
        );
        console.log(`[worker] Code context fetched: ${codeContext.length} chars`);
      }
    } catch (err) {
      console.warn("[worker] Failed to fetch code context:", err);
    }
  }

  const attachments = Array.isArray(job.attachments) && job.attachments.length > 0
    ? job.attachments
    : undefined;
  if (attachments) {
    console.log(`[worker] Assembly ${job.id}: ${attachments.length} attachment(s)`);
  }

  let savedCharacters: Array<{
    name: string; tag: string; biography: string; framework: string;
    frameworkName: string; blindSpot: string; heroes: string[];
    rhetoricalTendencies: string; debateStyle: string; avatarUrl?: string;
  }> | undefined;

  const savedIds: string[] = Array.isArray(job.saved_character_ids) ? job.saved_character_ids : [];
  if (savedIds.length > 0) {
    const result = await pool.query(
      `SELECT name, tag, biography, framework, framework_name, blind_spot,
              heroes, rhetorical_tendencies, debate_style, avatar_url
       FROM saved_characters WHERE id = ANY($1)`,
      [savedIds]
    );
    savedCharacters = result.rows.map((r: Record<string, unknown>) => ({
      name: r.name as string,
      tag: r.tag as string,
      biography: r.biography as string,
      framework: r.framework as string,
      frameworkName: r.framework_name as string,
      blindSpot: r.blind_spot as string,
      heroes: (r.heroes || []) as string[],
      rhetoricalTendencies: r.rhetorical_tendencies as string,
      debateStyle: r.debate_style as string,
      avatarUrl: (r.avatar_url || undefined) as string | undefined,
    }));
    console.log(`[worker] Assembly ${job.id}: ${savedCharacters.length} saved character(s)`);
  }

  await runPipeline({
    assemblyId: job.id,
    topic: job.topic_input,
    slug,
    apiKey,
    codeContext,
    attachments,
    savedCharacters,
    initialRawFiles: job.raw_files || {},
    updatePhase: async (phase: string) => {
      await pool.query(
        `UPDATE assemblies SET current_phase = $1 WHERE id = $2`,
        [phase, job.id]
      );
    },
    updateRawFiles: async (files: Record<string, string>) => {
      await pool.query(
        `UPDATE assemblies SET raw_files = $1::jsonb WHERE id = $2`,
        [JSON.stringify(files), job.id]
      );
    },
    updateParsedData: async (data: unknown) => {
      await pool.query(
        `UPDATE assemblies SET parsed_data = $1::jsonb WHERE id = $2`,
        [JSON.stringify(data), job.id]
      );
    },
  });

  await pool.query(
    `UPDATE assemblies SET status = 'complete', completed_at = NOW() WHERE id = $1`,
    [job.id]
  );
  console.log(`[worker] Assembly ${job.id} completed`);
}

// ─── IC Jobs ────────────────────────────────────────────────────────

const IC_ALLOWED_TABLES = new Set(["ic_committees", "ic_evaluations", "ic_ideas"]);

async function handleIcJobError(table: string, jobId: string, userId: string, err: unknown) {
  const message = err instanceof Error ? err.message : "Unknown error";
  console.error(`[worker] IC ${table} ${jobId} failed: ${message}`);
  if (!IC_ALLOWED_TABLES.has(table)) throw new Error(`Invalid table name: ${table}`);
  await pool.query(`UPDATE ${table} SET status = 'error', error_message = $1 WHERE id = $2`, [message, jobId]);
  if (message.includes("Invalid API key")) {
    await pool.query("UPDATE users SET api_key_valid = false WHERE id = $1", [userId]);
  }
}

async function claimCommitteeJob() {
  const result = await pool.query(
    `UPDATE ic_committees SET status = 'generating', updated_at = NOW()
     WHERE id = (
       SELECT c.id FROM ic_committees c
       JOIN investor_profiles p ON c.profile_id = p.id
       WHERE c.status = 'queued'
       ORDER BY c.created_at LIMIT 1
       FOR UPDATE SKIP LOCKED
     )
     RETURNING id, profile_id,
       (SELECT p.user_id FROM investor_profiles p WHERE p.id = ic_committees.profile_id) as user_id,
       raw_files`
  );
  return result.rows[0] ?? null;
}

async function claimEvaluationJob() {
  const result = await pool.query(
    `UPDATE ic_evaluations SET status = 'running', current_phase = 'opportunity-analysis'
     WHERE id = (
       SELECT e.id FROM ic_evaluations e
       JOIN ic_committees c ON e.committee_id = c.id
       JOIN investor_profiles p ON c.profile_id = p.id
       WHERE e.status = 'queued'
       ORDER BY e.created_at LIMIT 1
       FOR UPDATE SKIP LOCKED
     )
     RETURNING id, committee_id,
       (SELECT p.user_id FROM investor_profiles p
        JOIN ic_committees c ON c.profile_id = p.id
        WHERE c.id = ic_evaluations.committee_id) as user_id,
       raw_files`
  );
  return result.rows[0] ?? null;
}

async function claimIdeaJob() {
  const result = await pool.query(
    `UPDATE ic_ideas SET status = 'running', current_phase = 'gap-analysis'
     WHERE id = (
       SELECT i.id FROM ic_ideas i
       JOIN ic_committees c ON i.committee_id = c.id
       JOIN investor_profiles p ON c.profile_id = p.id
       WHERE i.status = 'queued'
       ORDER BY i.created_at LIMIT 1
       FOR UPDATE SKIP LOCKED
     )
     RETURNING id, committee_id,
       (SELECT p.user_id FROM investor_profiles p
        JOIN ic_committees c ON c.profile_id = p.id
        WHERE c.id = ic_ideas.committee_id) as user_id,
       raw_files`
  );
  return result.rows[0] ?? null;
}

async function pollIcJobs() {
  // Committee jobs
  const committeeJob = await claimCommitteeJob();
  if (committeeJob) {
    console.log(`[worker] Claimed IC committee job ${committeeJob.id}`);
    try {
      const { encrypted, iv } = await getUserApiKey(committeeJob.user_id);
      const apiKey = decryptApiKey(encrypted, iv);
      const { members } = await runCommitteePipeline(pool, committeeJob.profile_id, apiKey, committeeJob.raw_files || {}, {
        updatePhase: async (phase) => { console.log(`[worker] IC committee ${committeeJob.id}: ${phase}`); },
        updateRawFiles: async (files) => {
          await pool.query("UPDATE ic_committees SET raw_files = $1::jsonb, updated_at = NOW() WHERE id = $2", [JSON.stringify(files), committeeJob.id]);
        },
        updateParsedData: async (data) => {
          const parsed = data as { members: unknown[] };
          await pool.query("UPDATE ic_committees SET members = $1::jsonb, updated_at = NOW() WHERE id = $2", [JSON.stringify(parsed.members || []), committeeJob.id]);
        },
      });
      await pool.query("UPDATE ic_committees SET status = 'active', members = $1::jsonb, updated_at = NOW() WHERE id = $2", [JSON.stringify(members), committeeJob.id]);
      console.log(`[worker] IC committee ${committeeJob.id} completed with ${members.length} members`);
    } catch (err) {
      await handleIcJobError("ic_committees", committeeJob.id, committeeJob.user_id, err);
    }
  }

  // Evaluation jobs
  const evalJob = await claimEvaluationJob();
  if (evalJob) {
    console.log(`[worker] Claimed IC evaluation job ${evalJob.id}`);
    try {
      const { encrypted, iv } = await getUserApiKey(evalJob.user_id);
      const apiKey = decryptApiKey(encrypted, iv);
      await runEvaluationPipeline(pool, evalJob.id, apiKey, evalJob.raw_files || {}, {
        updatePhase: async (phase) => {
          console.log(`[worker] IC evaluation ${evalJob.id}: ${phase}`);
          await pool.query("UPDATE ic_evaluations SET current_phase = $1 WHERE id = $2", [phase, evalJob.id]);
        },
        updateRawFiles: async (files) => {
          await pool.query("UPDATE ic_evaluations SET raw_files = $1::jsonb WHERE id = $2", [JSON.stringify(files), evalJob.id]);
        },
        updateParsedData: async (data) => {
          await pool.query("UPDATE ic_evaluations SET parsed_data = $1::jsonb WHERE id = $2", [JSON.stringify(data), evalJob.id]);
        },
      });
      await pool.query("UPDATE ic_evaluations SET status = 'complete', completed_at = NOW() WHERE id = $1", [evalJob.id]);
      console.log(`[worker] IC evaluation ${evalJob.id} completed`);
    } catch (err) {
      await handleIcJobError("ic_evaluations", evalJob.id, evalJob.user_id, err);
    }
  }

  // Idea jobs
  const ideaJob = await claimIdeaJob();
  if (ideaJob) {
    console.log(`[worker] Claimed IC idea job ${ideaJob.id}`);
    try {
      const { encrypted, iv } = await getUserApiKey(ideaJob.user_id);
      const apiKey = decryptApiKey(encrypted, iv);
      await runIdeaPipeline(pool, ideaJob.id, apiKey, ideaJob.raw_files || {}, {
        updatePhase: async (phase) => {
          console.log(`[worker] IC idea ${ideaJob.id}: ${phase}`);
          await pool.query("UPDATE ic_ideas SET current_phase = $1 WHERE id = $2", [phase, ideaJob.id]);
        },
        updateRawFiles: async (files) => {
          await pool.query("UPDATE ic_ideas SET raw_files = $1::jsonb WHERE id = $2", [JSON.stringify(files), ideaJob.id]);
        },
        updateParsedData: async (data) => {
          await pool.query("UPDATE ic_ideas SET parsed_data = $1::jsonb WHERE id = $2", [JSON.stringify(data), ideaJob.id]);
        },
      });
      await pool.query("UPDATE ic_ideas SET status = 'complete', completed_at = NOW() WHERE id = $1", [ideaJob.id]);
      console.log(`[worker] IC idea ${ideaJob.id} completed`);
    } catch (err) {
      await handleIcJobError("ic_ideas", ideaJob.id, ideaJob.user_id, err);
    }
  }
}

// ─── CLO Jobs ────────────────────────────────────────────────────────

const CLO_ALLOWED_TABLES = new Set(["clo_panels", "clo_analyses", "clo_screenings"]);

async function handleCloJobError(table: string, jobId: string, userId: string, err: unknown) {
  const message = err instanceof Error ? err.message : "Unknown error";
  console.error(`[worker] CLO ${table} ${jobId} failed: ${message}`);
  if (!CLO_ALLOWED_TABLES.has(table)) throw new Error(`Invalid table name: ${table}`);
  await pool.query(`UPDATE ${table} SET status = 'error', error_message = $1 WHERE id = $2`, [message, jobId]);
  if (message.includes("Invalid API key")) {
    await pool.query("UPDATE users SET api_key_valid = false WHERE id = $1", [userId]);
  }
}

async function claimPanelJob() {
  const result = await pool.query(
    `UPDATE clo_panels SET status = 'generating', updated_at = NOW()
     WHERE id = (
       SELECT p.id FROM clo_panels p
       JOIN clo_profiles pr ON p.profile_id = pr.id
       WHERE p.status = 'queued'
       ORDER BY p.created_at LIMIT 1
       FOR UPDATE SKIP LOCKED
     )
     RETURNING id, profile_id,
       (SELECT pr.user_id FROM clo_profiles pr WHERE pr.id = clo_panels.profile_id) as user_id,
       raw_files`
  );
  return result.rows[0] ?? null;
}

async function claimAnalysisJob() {
  const result = await pool.query(
    `UPDATE clo_analyses SET status = 'running', current_phase = 'credit-analysis'
     WHERE id = (
       SELECT a.id FROM clo_analyses a
       JOIN clo_panels p ON a.panel_id = p.id
       JOIN clo_profiles pr ON p.profile_id = pr.id
       WHERE a.status = 'queued'
       ORDER BY a.created_at LIMIT 1
       FOR UPDATE SKIP LOCKED
     )
     RETURNING id, panel_id,
       (SELECT pr.user_id FROM clo_profiles pr
        JOIN clo_panels p ON p.profile_id = pr.id
        WHERE p.id = clo_analyses.panel_id) as user_id,
       raw_files`
  );
  return result.rows[0] ?? null;
}

async function claimScreeningJob() {
  const result = await pool.query(
    `UPDATE clo_screenings SET status = 'running', current_phase = 'gap-analysis'
     WHERE id = (
       SELECT s.id FROM clo_screenings s
       JOIN clo_panels p ON s.panel_id = p.id
       JOIN clo_profiles pr ON p.profile_id = pr.id
       WHERE s.status = 'queued'
       ORDER BY s.created_at LIMIT 1
       FOR UPDATE SKIP LOCKED
     )
     RETURNING id, panel_id,
       (SELECT pr.user_id FROM clo_profiles pr
        JOIN clo_panels p ON p.profile_id = pr.id
        WHERE p.id = clo_screenings.panel_id) as user_id,
       raw_files`
  );
  return result.rows[0] ?? null;
}

async function pollCloJobs() {
  // Panel jobs
  const panelJob = await claimPanelJob();
  if (panelJob) {
    console.log(`[worker] Claimed CLO panel job ${panelJob.id}`);
    try {
      const { encrypted, iv } = await getUserApiKey(panelJob.user_id);
      const apiKey = decryptApiKey(encrypted, iv);
      const { members } = await runPanelPipeline(pool, panelJob.profile_id, apiKey, panelJob.raw_files || {}, {
        updatePhase: async (phase) => { console.log(`[worker] CLO panel ${panelJob.id}: ${phase}`); },
        updateRawFiles: async (files) => {
          await pool.query("UPDATE clo_panels SET raw_files = $1::jsonb, updated_at = NOW() WHERE id = $2", [JSON.stringify(files), panelJob.id]);
        },
        updateParsedData: async (data) => {
          const parsed = data as { members: unknown[] };
          await pool.query("UPDATE clo_panels SET members = $1::jsonb, updated_at = NOW() WHERE id = $2", [JSON.stringify(parsed.members || []), panelJob.id]);
        },
      });
      await pool.query("UPDATE clo_panels SET status = 'active', members = $1::jsonb, updated_at = NOW() WHERE id = $2", [JSON.stringify(members), panelJob.id]);
      console.log(`[worker] CLO panel ${panelJob.id} completed with ${members.length} members`);
    } catch (err) {
      await handleCloJobError("clo_panels", panelJob.id, panelJob.user_id, err);
    }
  }

  // Analysis jobs
  const analysisJob = await claimAnalysisJob();
  if (analysisJob) {
    console.log(`[worker] Claimed CLO analysis job ${analysisJob.id}`);
    try {
      const { encrypted, iv } = await getUserApiKey(analysisJob.user_id);
      const apiKey = decryptApiKey(encrypted, iv);
      await runAnalysisPipeline(pool, analysisJob.id, apiKey, analysisJob.raw_files || {}, {
        updatePhase: async (phase) => {
          console.log(`[worker] CLO analysis ${analysisJob.id}: ${phase}`);
          await pool.query("UPDATE clo_analyses SET current_phase = $1 WHERE id = $2", [phase, analysisJob.id]);
        },
        updateRawFiles: async (files) => {
          await pool.query("UPDATE clo_analyses SET raw_files = $1::jsonb WHERE id = $2", [JSON.stringify(files), analysisJob.id]);
        },
        updateParsedData: async (data) => {
          await pool.query("UPDATE clo_analyses SET parsed_data = $1::jsonb WHERE id = $2", [JSON.stringify(data), analysisJob.id]);
        },
      });
      await pool.query("UPDATE clo_analyses SET status = 'complete', completed_at = NOW() WHERE id = $1", [analysisJob.id]);
      console.log(`[worker] CLO analysis ${analysisJob.id} completed`);
    } catch (err) {
      await handleCloJobError("clo_analyses", analysisJob.id, analysisJob.user_id, err);
    }
  }

  // Screening jobs
  const screeningJob = await claimScreeningJob();
  if (screeningJob) {
    console.log(`[worker] Claimed CLO screening job ${screeningJob.id}`);
    try {
      const { encrypted, iv } = await getUserApiKey(screeningJob.user_id);
      const apiKey = decryptApiKey(encrypted, iv);
      await runScreeningPipeline(pool, screeningJob.id, apiKey, screeningJob.raw_files || {}, {
        updatePhase: async (phase) => {
          console.log(`[worker] CLO screening ${screeningJob.id}: ${phase}`);
          await pool.query("UPDATE clo_screenings SET current_phase = $1 WHERE id = $2", [phase, screeningJob.id]);
        },
        updateRawFiles: async (files) => {
          await pool.query("UPDATE clo_screenings SET raw_files = $1::jsonb WHERE id = $2", [JSON.stringify(files), screeningJob.id]);
        },
        updateParsedData: async (data) => {
          await pool.query("UPDATE clo_screenings SET parsed_data = $1::jsonb WHERE id = $2", [JSON.stringify(data), screeningJob.id]);
        },
      });
      await pool.query("UPDATE clo_screenings SET status = 'complete', completed_at = NOW() WHERE id = $1", [screeningJob.id]);
      console.log(`[worker] CLO screening ${screeningJob.id} completed`);
    } catch (err) {
      await handleCloJobError("clo_screenings", screeningJob.id, screeningJob.user_id, err);
    }
  }
}

// ─── PPM → Relational Sync ──────────────────────────────────────────

function parseAmount(s: string | undefined | null): number | null {
  if (!s) return null;
  const cleaned = String(s).replace(/[$,\s]/g, "");
  const n = parseFloat(cleaned);
  return isNaN(n) ? null : n;
}

function parseSpreadBps(s: string | undefined | null): number | null {
  if (!s) return null;
  const str = String(s).trim();
  if (str === "N/A" || str === "-" || str === "") return null;
  // Match patterns like "SOFR + 145bps", "E + 1.50%", "145 bps", "1.45%"
  const bpsMatch = str.match(/(\d+(?:\.\d+)?)\s*bps/i);
  if (bpsMatch) return parseFloat(bpsMatch[1]);
  const pctMatch = str.match(/[+]\s*(\d+(?:\.\d+)?)\s*%/);
  if (pctMatch) return parseFloat(pctMatch[1]) * 100;
  const perCentMatch = str.match(/(\d+(?:\.\d+)?)\s*per\s*cent/i);
  if (perCentMatch) return parseFloat(perCentMatch[1]) * 100;
  // Fallback: plain number (e.g., "145" from a column labeled "Spread (bps)")
  const plainNum = parseFloat(str.replace(/[,\s]/g, ""));
  if (!isNaN(plainNum) && plainNum > 0) return plainNum;
  return null;
}

async function syncPpmToRelationalTables(
  profileId: string,
  extractedConstraints: Record<string, unknown>,
) {
  const isNullish = (v: unknown) => v == null || v === "null";

  // Look up or create deal
  let deals = await pool.query<{ id: string }>(
    "SELECT id FROM clo_deals WHERE profile_id = $1",
    [profileId],
  );
  if (deals.rows.length === 0) {
    // Deal doesn't exist yet (PPM extraction ran before compliance report).
    // Create it from the extracted constraints so tranches can be linked.
    const di = (extractedConstraints.dealIdentity ?? {}) as Record<string, string>;
    const kd = (extractedConstraints.keyDates ?? {}) as Record<string, string>;
    const cm = (extractedConstraints.cmDetails ?? {}) as Record<string, string>;
    deals = await pool.query<{ id: string }>(
      `INSERT INTO clo_deals (
        profile_id, deal_name, issuer_legal_entity, jurisdiction, deal_currency,
        closing_date, effective_date, reinvestment_period_end, non_call_period_end,
        stated_maturity_date, collateral_manager, governing_law, ppm_constraints
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
      RETURNING id`,
      [
        profileId,
        di.dealName ?? null,
        di.issuerLegalName ?? null,
        di.jurisdiction ?? null,
        di.currency ?? null,
        kd.originalIssueDate ?? null,
        kd.currentIssueDate ?? null,
        kd.reinvestmentPeriodEnd ?? null,
        kd.nonCallPeriodEnd ?? null,
        kd.maturityDate ?? null,
        cm.name ?? (extractedConstraints.collateralManager as string) ?? null,
        di.governingLaw ?? null,
        JSON.stringify(extractedConstraints),
      ],
    );
    console.log(`[worker] syncPpm: created deal ${deals.rows[0].id} for profile ${profileId}`);
  }
  const dealId = deals.rows[0].id;

  // Sync capital structure → clo_tranches
  const capitalStructure = (extractedConstraints.capitalStructure ?? []) as CapitalStructureEntry[];
  if (capitalStructure.length === 0) {
    console.log(`[worker] syncPpm: no capital structure entries, skipping tranche sync`);
    return;
  }

  // Sort: non-subordinated first (by array order), subordinated last
  const sorted = [...capitalStructure];
  sorted.sort((a, b) => {
    if (a.isSubordinated && !b.isSubordinated) return 1;
    if (!a.isSubordinated && b.isSubordinated) return -1;
    return 0;
  });

  for (let i = 0; i < sorted.length; i++) {
    const entry = sorted[i];
    const normalizedName = normalizeClassName(entry.class);

    // Find or create tranche
    const allTranches = await pool.query<{ id: string; class_name: string }>(
      "SELECT id, class_name FROM clo_tranches WHERE deal_id = $1",
      [dealId],
    );
    let tranche = allTranches.rows.find((t) => normalizeClassName(t.class_name) === normalizedName);

    if (!tranche) {
      const inserted = await pool.query<{ id: string; class_name: string }>(
        `INSERT INTO clo_tranches (deal_id, class_name) VALUES ($1, $2) RETURNING id, class_name`,
        [dealId, entry.class],
      );
      tranche = inserted.rows[0];
    }

    // Build update
    const setClauses: string[] = [];
    const values: unknown[] = [];
    let pi = 1;

    // Detect subordinated/equity tranches by flag OR name pattern (needed before spread default)
    const isSub = entry.isSubordinated ??
      (/\b(sub|equity|income|residual)\b/i.test(entry.class) ||
       /\b(sub|equity|income|residual)\b/i.test(entry.designation ?? ""));

    let spreadBps = entry.spreadBps ?? parseSpreadBps(entry.spread);
    // Guard: if AI returned percentage (e.g., 1.45) instead of bps (145), convert
    if (spreadBps != null && spreadBps > 0 && spreadBps < 20) {
      spreadBps = Math.round(spreadBps * 100);
    }
    // Income notes (sub/equity) get residual cash flows, default spread to 0
    if (spreadBps == null && isSub) spreadBps = 0;
    if (spreadBps != null) {
      setClauses.push(`spread_bps = $${pi++}`);
      values.push(spreadBps);
    }

    const balance = parseAmount(entry.principalAmount);
    if (balance != null) {
      setClauses.push(`original_balance = $${pi++}`);
      values.push(balance);
    }

    if (entry.rateType) {
      setClauses.push(`is_floating = $${pi++}`);
      values.push(entry.rateType.toLowerCase() === "floating");
    } else if (isSub) {
      // Income notes are not floating-rate
      setClauses.push(`is_floating = $${pi++}`);
      values.push(false);
    }
    setClauses.push(`is_subordinate = $${pi++}`);
    values.push(!!isSub);
    setClauses.push(`is_income_note = $${pi++}`);
    values.push(!!isSub);

    console.log(`[worker] syncPpm: tranche "${entry.class}" → normalized="${normalizedName}", spreadBps=${spreadBps}, balance=${balance}, isSub=${isSub}, isFloating=${entry.rateType}`);

    if (entry.deferrable != null) {
      setClauses.push(`is_deferrable = $${pi++}`);
      values.push(entry.deferrable);
    }

    if (entry.rating?.sp) {
      setClauses.push(`rating_sp = $${pi++}`);
      values.push(entry.rating.sp);
    }

    if (entry.rating?.fitch) {
      setClauses.push(`rating_fitch = $${pi++}`);
      values.push(entry.rating.fitch);
    }

    if (entry.referenceRate) {
      setClauses.push(`reference_rate = $${pi++}`);
      values.push(entry.referenceRate);
    }

    setClauses.push(`seniority_rank = $${pi++}`);
    values.push(i + 1);

    if (setClauses.length > 0) {
      values.push(tranche.id);
      await pool.query(
        `UPDATE clo_tranches SET ${setClauses.join(", ")} WHERE id = $${pi}`,
        values,
      );
    }
  }

  // Clean up duplicate tranches that now normalize to the same name (from pre-alias-fix runs)
  const allTranchesFinal = await pool.query<{ id: string; class_name: string }>(
    "SELECT id, class_name FROM clo_tranches WHERE deal_id = $1 ORDER BY id",
    [dealId],
  );
  const seenNorm = new Map<string, string>(); // normalizedName → first tranche id
  for (const t of allTranchesFinal.rows) {
    const norm = normalizeClassName(t.class_name);
    if (seenNorm.has(norm)) {
      // Duplicate — reassign snapshots then delete
      const keepId = seenNorm.get(norm)!;
      await pool.query(
        "UPDATE clo_tranche_snapshots SET tranche_id = $1 WHERE tranche_id = $2",
        [keepId, t.id],
      );
      await pool.query("DELETE FROM clo_tranches WHERE id = $1", [t.id]);
      console.log(`[worker] syncPpm: removed duplicate tranche "${t.class_name}" (${t.id}), kept ${keepId}`);
    } else {
      seenNorm.set(norm, t.id);
    }
  }

  console.log(`[worker] syncPpm: synced ${sorted.length} tranches to clo_tranches`);

  // Sync dates → clo_deals
  const firstEntry = capitalStructure[0];
  const maturityDate = firstEntry?.maturityDate;
  const keyDates = extractedConstraints.keyDates as Record<string, unknown> | undefined;

  const reinvestmentEnd = keyDates && !isNullish(keyDates.reinvestmentPeriodEnd)
    ? keyDates.reinvestmentPeriodEnd as string
    : null;
  const nonCallEnd = keyDates && !isNullish(keyDates.nonCallPeriodEnd)
    ? keyDates.nonCallPeriodEnd as string
    : null;

  if (maturityDate || reinvestmentEnd || nonCallEnd) {
    const dateClauses: string[] = [];
    const dateValues: unknown[] = [];
    let di = 1;

    if (maturityDate) {
      dateClauses.push(`stated_maturity_date = $${di++}`);
      dateValues.push(maturityDate);
    }
    if (reinvestmentEnd) {
      dateClauses.push(`reinvestment_period_end = $${di++}`);
      dateValues.push(reinvestmentEnd);
    }
    if (nonCallEnd) {
      dateClauses.push(`non_call_period_end = $${di++}`);
      dateValues.push(nonCallEnd);
    }

    dateValues.push(dealId);
    await pool.query(
      `UPDATE clo_deals SET ${dateClauses.join(", ")} WHERE id = $${di}`,
      dateValues,
    );
    console.log(`[worker] syncPpm: updated deal dates (maturity=${maturityDate}, reinvEnd=${reinvestmentEnd}, nonCallEnd=${nonCallEnd})`);
  }

  // Sync collateral manager name
  const cmDetails = extractedConstraints.cmDetails as Record<string, unknown> | undefined;
  const keyPartiesArray = Array.isArray(extractedConstraints.keyParties)
    ? extractedConstraints.keyParties as Array<{ role?: string; entity?: string }>
    : [];
  const cmFromKeyParties = keyPartiesArray.find(
    (p) => p.role?.toLowerCase().includes("collateral manager"),
  )?.entity;
  const cmName = (cmDetails?.name as string) ?? cmFromKeyParties ?? null;
  if (cmName) {
    await pool.query(
      `UPDATE clo_deals SET collateral_manager = $1 WHERE id = $2 AND (collateral_manager IS NULL OR collateral_manager = '')`,
      [cmName, dealId],
    );
    console.log(`[worker] syncPpm: updated collateral_manager=${cmName}`);
  }
}

// ─── CLO Extraction Jobs ─────────────────────────────────────────────

async function pollCloExtractionJobs() {
  // Recover stale PPM 'extracting' jobs (stuck > 10 min)
  await pool.query(
    `UPDATE clo_profiles SET ppm_extraction_status = 'queued'
     WHERE ppm_extraction_status = 'extracting'
       AND updated_at < NOW() - INTERVAL '10 minutes'`
  );

  // PPM extraction
  const ppmJob = await pool.query<{
    id: string;
    user_id: string;
    documents: Array<{ name: string; type: string; size: number; base64: string; docType?: "ppm" | "compliance" }>;
  }>(
    `UPDATE clo_profiles SET ppm_extraction_status = 'extracting',
       ppm_extraction_progress = '{"step":"starting","detail":"Starting PPM extraction..."}'::jsonb,
       updated_at = NOW()
     WHERE id = (
       SELECT id FROM clo_profiles
       WHERE ppm_extraction_status = 'queued'
       ORDER BY updated_at LIMIT 1
       FOR UPDATE SKIP LOCKED
     )
     RETURNING id, user_id, documents`
  );

  if (ppmJob.rows.length > 0) {
    const job = ppmJob.rows[0];
    console.log(`[worker] Claimed PPM extraction job for profile ${job.id}`);
    try {
      const { encrypted, iv } = await getUserApiKey(job.user_id);
      const apiKey = decryptApiKey(encrypted, iv);
      // Filter to only PPM documents (backwards compat: no docType = ppm)
      const ppmDocs = (job.documents || []).filter((d) => (d.docType || "ppm") === "ppm");
      const ppmProgress = async (step: string, detail?: string) => {
        await pool.query(
          `UPDATE clo_profiles SET ppm_extraction_progress = $1::jsonb, updated_at = now() WHERE id = $2`,
          [JSON.stringify({ step, detail, updatedAt: new Date().toISOString() }), job.id]
        );
      };
      const { extractedConstraints, rawOutputs } = await runSectionPpmExtraction(apiKey, ppmDocs, ppmProgress);

      await pool.query(
        `UPDATE clo_profiles
         SET extracted_constraints = $1::jsonb,
             ppm_raw_extraction = $2::jsonb,
             ppm_extracted_at = now(),
             ppm_extraction_status = 'complete',
             ppm_extraction_error = NULL,
             ppm_extraction_progress = $3::jsonb,
             updated_at = now()
         WHERE id = $4`,
        [JSON.stringify(extractedConstraints), JSON.stringify(rawOutputs), JSON.stringify({ step: "complete", detail: "Extraction complete", updatedAt: new Date().toISOString() }), job.id]
      );

      // Sync PPM data to relational tables (tranches, deals)
      try {
        await syncPpmToRelationalTables(job.id, extractedConstraints);
      } catch (syncErr) {
        console.error(`[worker] PPM relational sync failed for profile ${job.id}:`, syncErr instanceof Error ? syncErr.message : syncErr);
      }

      console.log(`[worker] PPM extraction complete for profile ${job.id}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      console.error(`[worker] PPM extraction failed for profile ${job.id}: ${message}`);
      await pool.query(
        `UPDATE clo_profiles
         SET ppm_extraction_status = 'error',
             ppm_extraction_error = $1,
             ppm_extraction_progress = $2::jsonb,
             updated_at = now()
         WHERE id = $3`,
        [message, JSON.stringify({ step: "error", detail: message, updatedAt: new Date().toISOString() }), job.id]
      );
    }
  }

  // Compliance report extraction — also recover stale 'extracting' jobs (stuck > 10 min)
  await pool.query(
    `UPDATE clo_profiles SET report_extraction_status = 'queued'
     WHERE report_extraction_status = 'extracting'
       AND updated_at < NOW() - INTERVAL '10 minutes'`
  );

  const reportJob = await pool.query<{
    id: string;
    user_id: string;
    documents: Array<{ name: string; type: string; size: number; base64: string; docType?: "ppm" | "compliance" }>;
  }>(
    `UPDATE clo_profiles SET report_extraction_status = 'extracting',
       report_extraction_progress = '{"step":"starting","detail":"Starting report extraction..."}'::jsonb,
       updated_at = NOW()
     WHERE id = (
       SELECT id FROM clo_profiles
       WHERE report_extraction_status = 'queued'
       ORDER BY updated_at LIMIT 1
       FOR UPDATE SKIP LOCKED
     )
     RETURNING id, user_id, documents`
  );

  if (reportJob.rows.length > 0) {
    const job = reportJob.rows[0];
    console.log(`[worker] Claimed report extraction job for profile ${job.id}`);
    try {
      const { encrypted, iv } = await getUserApiKey(job.user_id);
      const apiKey = decryptApiKey(encrypted, iv);
      const complianceDocs = (job.documents || []).filter((d) => d.docType === "compliance");
      if (complianceDocs.length === 0) {
        console.log(`[worker] No compliance docs for profile ${job.id}, skipping report extraction`);
        await pool.query(
          `UPDATE clo_profiles SET report_extraction_status = 'complete', report_extraction_error = NULL, updated_at = now() WHERE id = $1`,
          [job.id]
        );
      } else {
        await runSectionExtraction(job.id, apiKey, complianceDocs, async (step, detail) => {
          await pool.query(
            `UPDATE clo_profiles SET report_extraction_progress = $1::jsonb, updated_at = now() WHERE id = $2`,
            [JSON.stringify({ step, detail, updatedAt: new Date().toISOString() }), job.id],
          );
        });
        await pool.query(
          `UPDATE clo_profiles
           SET report_extraction_status = 'complete',
               report_extraction_error = NULL,
               report_extraction_progress = $1::jsonb,
               updated_at = now()
           WHERE id = $2`,
          [JSON.stringify({ step: "complete", detail: "Extraction complete", updatedAt: new Date().toISOString() }), job.id]
        );
        console.log(`[worker] Report extraction complete for profile ${job.id}`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      console.error(`[worker] Report extraction failed for profile ${job.id}: ${message}`);
      await pool.query(
        `UPDATE clo_profiles
         SET report_extraction_status = 'error',
             report_extraction_error = $1,
             report_extraction_progress = $2::jsonb,
             updated_at = now()
         WHERE id = $3`,
        [message, JSON.stringify({ step: "error", detail: message, updatedAt: new Date().toISOString() }), job.id]
      );
    }
  }

  // Portfolio extraction
  const portfolioJob = await pool.query<{
    id: string;
    user_id: string;
    documents: Array<{ name: string; type: string; size: number; base64: string; docType?: "ppm" | "compliance" }>;
  }>(
    `UPDATE clo_profiles SET portfolio_extraction_status = 'extracting', updated_at = NOW()
     WHERE id = (
       SELECT id FROM clo_profiles
       WHERE portfolio_extraction_status = 'queued'
       ORDER BY updated_at LIMIT 1
       FOR UPDATE SKIP LOCKED
     )
     RETURNING id, user_id, documents`
  );

  if (portfolioJob.rows.length > 0) {
    const job = portfolioJob.rows[0];
    console.log(`[worker] Claimed portfolio extraction job for profile ${job.id}`);
    try {
      const { encrypted, iv } = await getUserApiKey(job.user_id);
      const apiKey = decryptApiKey(encrypted, iv);
      // Filter to only compliance documents; skip if none exist
      const complianceDocs = (job.documents || []).filter((d) => d.docType === "compliance");
      if (complianceDocs.length === 0) {
        console.log(`[worker] No compliance docs for profile ${job.id}, skipping portfolio extraction`);
        await pool.query(
          `UPDATE clo_profiles SET portfolio_extraction_status = 'complete', portfolio_extraction_error = NULL, updated_at = now() WHERE id = $1`,
          [job.id]
        );
        return;
      }
      const extractedPortfolio = await runPortfolioExtraction(apiKey, complianceDocs);

      await pool.query(
        `UPDATE clo_profiles
         SET extracted_portfolio = $1::jsonb,
             portfolio_extraction_status = 'complete',
             portfolio_extraction_error = NULL,
             updated_at = now()
         WHERE id = $2`,
        [JSON.stringify(extractedPortfolio), job.id]
      );
      console.log(`[worker] Portfolio extraction complete for profile ${job.id}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      console.error(`[worker] Portfolio extraction failed for profile ${job.id}: ${message}`);
      await pool.query(
        `UPDATE clo_profiles
         SET portfolio_extraction_status = 'error',
             portfolio_extraction_error = $1,
             updated_at = now()
         WHERE id = $2`,
        [message, job.id]
      );
    }
  }
}

// ─── Poll Loop ──────────────────────────────────────────────────────

async function pollLoop() {
  console.log("[worker] Starting poll loop");

  while (true) {
    try {
      // Assembly jobs
      const job = await claimJob();
      if (job) {
        console.log(
          `[worker] Claimed job ${job.id}: "${job.topic_input.slice(0, 80)}"`
        );
        try {
          await processJob(job);
        } catch (err) {
          const message =
            err instanceof Error ? err.message : "Unknown error";
          console.error(`[worker] Job ${job.id} failed: ${message}`);
          await pool.query(
            `UPDATE assemblies SET status = 'error', error_message = $1 WHERE id = $2`,
            [message, job.id]
          );
          if (message.includes("Invalid API key")) {
            await pool.query(
              "UPDATE users SET api_key_valid = false WHERE id = $1",
              [job.user_id]
            );
          }
          // Reset free trial if this was a trial assembly that failed
          const trialCheck = await pool.query(
            "SELECT is_free_trial FROM assemblies WHERE id = $1",
            [job.id]
          );
          if (trialCheck.rows[0]?.is_free_trial) {
            await resetFreeTrial(job.user_id);
            await pool.query("DELETE FROM assemblies WHERE id = $1", [job.id]);
            console.log(`[worker] Reset free trial for user ${job.user_id} after assembly failure`);
          }
        }
      }

      // IC jobs
      await pollIcJobs();

      // CLO jobs
      await pollCloJobs();

      // CLO extraction jobs (PPM + portfolio)
      await pollCloExtractionJobs();

      // Daily briefing
      await maybeFetchBriefing();
    } catch (err) {
      console.error("[worker] Poll error:", err);
    }

    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

pollLoop();
