import type { SectionText } from "./text-extractor";
import { callAnthropicWithTool } from "../api";
import { zodToToolSchema } from "./schema-utils";
import * as schemas from "./section-schemas";
import * as prompts from "./section-prompts";
import type { PageTableData } from "./table-extractor";
import {
  parseComplianceSummaryTables,
  parseComplianceTestTables,
  parseHoldingsTables,
  parseConcentrationFromTests,
  type TableParseResult,
  type ParsedComplianceTest,
} from "./table-parser";
import { addAuditEntry, type ExtractionAuditLog } from "./audit-logger";

export interface SectionExtractionResult {
  sectionType: string;
  data: Record<string, unknown> | null;
  truncated: boolean;
  error?: string;
}

interface SectionConfig {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  schema: any;
  prompt: () => { system: string; user: string };
}

function getSectionConfig(
  sectionType: string,
  documentType: "compliance_report" | "ppm",
): SectionConfig | null {
  if (documentType === "compliance_report") {
    const map: Record<string, SectionConfig> = {
      compliance_summary: { schema: schemas.complianceSummarySchema, prompt: prompts.complianceSummaryPrompt },
      par_value_tests: { schema: schemas.parValueTestsSchema, prompt: prompts.parValueTestsPrompt },
      interest_coverage_tests: { schema: schemas.interestCoverageTestsSchema, prompt: prompts.interestCoverageTestsPrompt },
      asset_schedule: { schema: schemas.assetScheduleSchema, prompt: prompts.assetSchedulePrompt },
      concentration_tables: { schema: schemas.concentrationSchema, prompt: prompts.concentrationPrompt },
      waterfall: { schema: schemas.waterfallSchema, prompt: prompts.waterfallPrompt },
      trading_activity: { schema: schemas.tradingActivitySchema, prompt: prompts.tradingActivityPrompt },
      interest_accrual: { schema: schemas.interestAccrualSchema, prompt: prompts.interestAccrualPrompt },
      account_balances: { schema: schemas.accountBalancesSchema, prompt: prompts.accountBalancesPrompt },
      supplementary: { schema: schemas.supplementarySchema, prompt: prompts.supplementaryPrompt },
    };
    return map[sectionType] ?? null;
  }

  if (documentType === "ppm") {
    const map: Record<string, SectionConfig> = {
      transaction_overview: { schema: schemas.transactionOverviewSchema, prompt: prompts.ppmTransactionOverviewPrompt },
      capital_structure: { schema: schemas.ppmCapitalStructureSchema, prompt: prompts.ppmCapitalStructurePrompt },
      coverage_tests: { schema: schemas.ppmCoverageTestsSchema, prompt: prompts.ppmCoverageTestsPrompt },
      eligibility_criteria: { schema: schemas.ppmEligibilityCriteriaSchema, prompt: prompts.ppmEligibilityCriteriaPrompt },
      portfolio_constraints: { schema: schemas.ppmPortfolioConstraintsSchema, prompt: prompts.ppmPortfolioConstraintsPrompt },
      waterfall_rules: { schema: schemas.ppmWaterfallRulesSchema, prompt: prompts.ppmWaterfallRulesPrompt },
      fees_and_expenses: { schema: schemas.ppmFeesSchema, prompt: prompts.ppmFeesPrompt },
      key_dates: { schema: schemas.ppmKeyDatesSchema, prompt: prompts.ppmKeyDatesPrompt },
      key_parties: { schema: schemas.ppmKeyPartiesSchema, prompt: prompts.ppmKeyPartiesPrompt },
    };
    return map[sectionType] ?? null;
  }

  return null;
}

function needsRepair(sectionType: string, data: Record<string, unknown> | null): boolean {
  if (!data) return false;

  if (sectionType === "capital_structure") {
    const cap = data.capitalStructure;
    if (!Array.isArray(cap) || cap.length === 0) return false;
    const broken = cap.filter((t: Record<string, unknown>) => !t.class || !t.designation);
    if (broken.length > 0) {
      console.log(`[section-extractor] capital_structure has ${broken.length}/${cap.length} tranches with missing class/designation — scheduling repair`);
      return true;
    }
  }

  return false;
}

async function repairExtraction(
  apiKey: string,
  sectionText: SectionText,
  brokenData: Record<string, unknown>,
  config: SectionConfig,
): Promise<Record<string, unknown> | null> {
  const brokenJson = JSON.stringify(brokenData, null, 2);
  const tool = {
    name: `repair_${sectionText.sectionType}`,
    description: `Return the repaired structured data for the ${sectionText.sectionType.replace(/_/g, " ")} section`,
    inputSchema: zodToToolSchema(config.schema),
  };

  const system = `You are a JSON repair specialist. You receive garbled/malformed extracted data from a CLO document along with the original source text. Your job is to produce clean, correct structured data.

Common issues:
- Array entries with interleaved fields from different objects (e.g., tranche A's fields mixed into tranche B)
- Missing required fields (class, designation)
- Duplicated entries that should be merged

Rules:
- Use the ORIGINAL SOURCE TEXT as ground truth — re-extract from it if the JSON is too garbled
- Every array entry must be a complete, self-contained object
- Do not fabricate data — use null for fields not in the source text
- Percentages as numbers, monetary amounts as raw numbers, dates as YYYY-MM-DD`;

  const content: Array<Record<string, unknown>> = [
    { type: "text", text: `The following extracted JSON is garbled. Please repair it using the original source text.\n\n## Garbled JSON:\n\`\`\`json\n${brokenJson}\n\`\`\`\n\n## Original source text:\n${sectionText.markdown}` },
  ];

  const label = `repair:${sectionText.sectionType}`;
  console.log(`[section-extractor] running repair for ${sectionText.sectionType}`);
  const result = await callAnthropicWithTool(apiKey, system, content, 16000, tool, label);

  if (result.error) {
    console.error(`[section-extractor] repair failed for ${sectionText.sectionType}: ${result.error.slice(0, 200)}`);
    return null;
  }

  console.log(`[section-extractor] repair succeeded for ${sectionText.sectionType}`);
  return result.data;
}

// ---------------------------------------------------------------------------
// Table extraction + merge logic
// ---------------------------------------------------------------------------

// Sections where we run both table + Claude and merge results
const TABLE_ELIGIBLE_SECTIONS = new Set([
  "compliance_summary",
  "par_value_tests",
  "interest_coverage_tests",
  "asset_schedule",
  "concentration_tables",
]);

let cachedParsedTests: ParsedComplianceTest[] | null = null;

function tryTableExtraction(
  sectionType: string,
  tablePages: PageTableData[],
  pageStart: number,
  pageEnd: number,
): TableParseResult<unknown> | null {
  if (!TABLE_ELIGIBLE_SECTIONS.has(sectionType)) return null;

  switch (sectionType) {
    case "compliance_summary": {
      const result = parseComplianceSummaryTables(tablePages, pageStart, pageEnd);
      return result as TableParseResult<unknown>;
    }
    case "par_value_tests":
    case "interest_coverage_tests": {
      const result = parseComplianceTestTables(tablePages, pageStart, pageEnd);
      if (result.data) cachedParsedTests = result.data;
      const schemaData = result.data ? {
        tests: result.data.map((t) => ({
          ...t,
          cushionPct: null,
          cushionAmount: null,
          consequenceIfFail: null,
        })),
        parValueAdjustments: [],
        interestAmountsPerTranche: [],
      } : null;
      return { ...result, data: schemaData };
    }
    case "asset_schedule": {
      const result = parseHoldingsTables(tablePages, pageStart, pageEnd);
      const schemaData = result.data ? { holdings: result.data } : null;
      return { ...result, data: schemaData };
    }
    case "concentration_tables": {
      if (!cachedParsedTests) return null;
      const result = parseConcentrationFromTests(cachedParsedTests);
      const schemaData = result.data ? { concentrations: result.data } : null;
      return { ...result, data: schemaData };
    }
    default:
      return null;
  }
}

/**
 * Merge table-extracted data onto Claude-extracted data.
 * Table data = ground truth for numbers/dates (direct from pdfplumber, no hallucination).
 * Claude data = better for text fields, classifications, and complex nested structures.
 */
function mergeExtractionResults(
  tableData: Record<string, unknown>,
  claudeData: Record<string, unknown>,
): Record<string, unknown> {
  const merged = { ...claudeData };

  for (const [key, tableValue] of Object.entries(tableData)) {
    if (tableValue == null || tableValue === "") continue;
    // dealDates is a sidecar for date reconciliation, not part of the schema
    if (key === "dealDates") continue;

    const claudeValue = merged[key];

    if (Array.isArray(tableValue)) {
      // Use whichever array extracted more items (more complete coverage)
      if (!Array.isArray(claudeValue) || tableValue.length > claudeValue.length) {
        merged[key] = tableValue;
      }
    } else if (typeof tableValue === "number") {
      // Table numbers are precise — prefer over Claude's potentially hallucinated values
      merged[key] = tableValue;
    } else if (typeof tableValue === "string") {
      // For dates and identifiers, prefer table if Claude has nothing
      if (claudeValue == null || claudeValue === "" || claudeValue === "null") {
        merged[key] = tableValue;
      }
    }
  }

  return merged;
}

// ---------------------------------------------------------------------------
// Main extraction
// ---------------------------------------------------------------------------

export async function extractSection(
  apiKey: string,
  sectionText: SectionText,
  documentType: "compliance_report" | "ppm",
  tablePages?: PageTableData[],
  auditLog?: ExtractionAuditLog,
): Promise<SectionExtractionResult> {
  const startTime = Date.now();

  // Run table extraction (instant, no API call) for eligible compliance sections
  let tableResult: TableParseResult<unknown> | null = null;
  if (documentType === "compliance_report" && tablePages && TABLE_ELIGIBLE_SECTIONS.has(sectionText.sectionType)) {
    tableResult = tryTableExtraction(sectionText.sectionType, tablePages, sectionText.pageStart, sectionText.pageEnd);
    if (tableResult) {
      console.log(`[section-extractor] ${sectionText.sectionType}: table extraction got ${tableResult.recordCount} records (quality=${tableResult.quality.toFixed(2)})`);
    }
  }

  // concentration_tables is derived from cached tests — no Claude call needed
  if (sectionText.sectionType === "concentration_tables" && tableResult?.data && tableResult.quality > 0) {
    if (auditLog) {
      addAuditEntry(auditLog, {
        sectionType: sectionText.sectionType,
        method: "table",
        pagesScanned: `${sectionText.pageStart}-${sectionText.pageEnd}`,
        recordsExtracted: tableResult.recordCount,
        fieldsPerRecord: 0,
        qualityScore: tableResult.quality,
        nullFieldRatio: tableResult.nullFieldRatio,
        typeErrors: tableResult.typeErrors,
        rawSamples: [],
        dataQualityNotes: tableResult.notes,
        durationMs: Date.now() - startTime,
      });
    }
    return { sectionType: sectionText.sectionType, data: tableResult.data as Record<string, unknown>, truncated: false };
  }

  // Always run Claude extraction
  const config = getSectionConfig(sectionText.sectionType, documentType);
  if (!config) {
    return { sectionType: sectionText.sectionType, data: null, truncated: false, error: `Unknown section type: ${sectionText.sectionType}` };
  }

  const prompt = config.prompt();
  const tool = {
    name: `extract_${sectionText.sectionType}`,
    description: `Extract structured data from the ${sectionText.sectionType.replace(/_/g, " ")} section`,
    inputSchema: zodToToolSchema(config.schema),
  };

  const content: Array<Record<string, unknown>> = [
    { type: "text", text: `${prompt.user}\n\n---\n\n${sectionText.markdown}` },
  ];
  const maxTokens = sectionText.sectionType === "asset_schedule" ? 64000 : 16000;

  const label = `extract:${sectionText.sectionType}`;
  const result = await callAnthropicWithTool(apiKey, prompt.system, content, maxTokens, tool, label);

  if (result.error) {
    console.error(`[section-extractor] ${sectionText.sectionType}: ${result.error.slice(0, 200)}`);

    // If Claude failed but table succeeded, use table data alone
    if (tableResult?.data) {
      console.log(`[section-extractor] ${sectionText.sectionType}: Claude failed, using table data only`);
      if (auditLog) {
        addAuditEntry(auditLog, {
          sectionType: sectionText.sectionType,
          method: "table",
          pagesScanned: `${sectionText.pageStart}-${sectionText.pageEnd}`,
          recordsExtracted: tableResult.recordCount,
          fieldsPerRecord: 0,
          qualityScore: tableResult.quality,
          nullFieldRatio: tableResult.nullFieldRatio,
          typeErrors: tableResult.typeErrors,
          rawSamples: [],
          dataQualityNotes: [...tableResult.notes, `Claude failed: ${result.error.slice(0, 100)}`],
          durationMs: Date.now() - startTime,
        });
      }
      return { sectionType: sectionText.sectionType, data: tableResult.data as Record<string, unknown>, truncated: false };
    }

    return { sectionType: sectionText.sectionType, data: null, truncated: false, error: result.error };
  }

  let data = result.data;

  // Auto-repair garbled structured output
  if (needsRepair(sectionText.sectionType, data)) {
    const repaired = await repairExtraction(apiKey, sectionText, data!, config);
    if (repaired) data = repaired;
  }

  // Merge: overlay table-extracted values onto Claude's result
  if (tableResult?.data && data) {
    const before = JSON.stringify(data);
    data = mergeExtractionResults(tableResult.data as Record<string, unknown>, data);
    const changed = JSON.stringify(data) !== before;
    console.log(`[section-extractor] ${sectionText.sectionType}: merged table+claude${changed ? " (table improved some fields)" : " (no changes)"}`);

    if (auditLog) {
      addAuditEntry(auditLog, {
        sectionType: sectionText.sectionType,
        method: "table+claude_merged",
        pagesScanned: `${sectionText.pageStart}-${sectionText.pageEnd}`,
        recordsExtracted: tableResult.recordCount,
        fieldsPerRecord: 0,
        qualityScore: tableResult.quality,
        nullFieldRatio: tableResult.nullFieldRatio,
        typeErrors: tableResult.typeErrors,
        rawSamples: [],
        dataQualityNotes: tableResult.notes,
        durationMs: Date.now() - startTime,
      });
    }
  } else {
    if (auditLog) {
      addAuditEntry(auditLog, {
        sectionType: sectionText.sectionType,
        method: "claude",
        pagesScanned: `${sectionText.pageStart}-${sectionText.pageEnd}`,
        recordsExtracted: 0,
        fieldsPerRecord: 0,
        qualityScore: data ? 1 : 0,
        nullFieldRatio: 0,
        typeErrors: [],
        rawSamples: [],
        dataQualityNotes: [],
        durationMs: Date.now() - startTime,
      });
    }
  }

  return {
    sectionType: sectionText.sectionType,
    data,
    truncated: result.truncated,
  };
}

export async function extractAllSections(
  apiKey: string,
  sectionTexts: SectionText[],
  documentType: "compliance_report" | "ppm",
  concurrency = 3,
  tablePages?: PageTableData[],
  auditLog?: ExtractionAuditLog,
): Promise<SectionExtractionResult[]> {
  // Reset cached tests at the start of each extraction run
  cachedParsedTests = null;

  const results: SectionExtractionResult[] = [];
  const items = [...sectionTexts];

  // For compliance with table data: process test sections first (sequentially)
  // so concentration_tables can use cached results, then everything else in parallel
  if (documentType === "compliance_report" && tablePages) {
    // Sections that must run first (tests populate cache for concentrations)
    const testSections = items.filter((s) =>
      s.sectionType === "par_value_tests" || s.sectionType === "interest_coverage_tests",
    );
    // Concentration depends on cached tests
    const concentrationSection = items.filter((s) => s.sectionType === "concentration_tables");
    // Everything else can run in parallel
    const rest = items.filter((s) =>
      s.sectionType !== "par_value_tests" &&
      s.sectionType !== "interest_coverage_tests" &&
      s.sectionType !== "concentration_tables",
    );

    // Phase A: test sections sequentially (populates cachedParsedTests)
    for (const st of testSections) {
      console.log(`[section-extractor] table+claude merge: ${st.sectionType}(${st.markdown.length} chars)`);
      const result = await extractSection(apiKey, st, documentType, tablePages, auditLog);
      const status = result.data ? "OK" : `FAILED${result.error ? `: ${result.error.slice(0, 100)}` : ""}`;
      console.log(`[section-extractor] ${st.sectionType}: ${status}`);
      results.push(result);
    }

    // Phase B: concentration (uses cached tests, no Claude call)
    for (const st of concentrationSection) {
      const result = await extractSection(apiKey, st, documentType, tablePages, auditLog);
      results.push(result);
    }

    // Phase C: all other sections in parallel batches
    for (let i = 0; i < rest.length; i += concurrency) {
      const batch = rest.slice(i, i + concurrency);
      const batchNum = Math.floor(i / concurrency) + 1;
      const totalBatches = Math.ceil(rest.length / concurrency);
      console.log(`[section-extractor] batch ${batchNum}/${totalBatches}: ${batch.map((s) => `${s.sectionType}(${s.markdown.length} chars)`).join(", ")}`);
      const batchResults = await Promise.all(
        batch.map(async (st) => {
          const result = await extractSection(apiKey, st, documentType, tablePages, auditLog);
          const status = result.data ? "OK" : `FAILED${result.error ? `: ${result.error.slice(0, 100)}` : ""}`;
          console.log(`[section-extractor] ${st.sectionType}: ${status}`);
          return result;
        }),
      );
      results.push(...batchResults);
    }

    return results;
  }

  // Original batched parallel logic for PPM or when no table data
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    const batchNum = Math.floor(i / concurrency) + 1;
    const totalBatches = Math.ceil(items.length / concurrency);
    console.log(`[section-extractor] batch ${batchNum}/${totalBatches}: ${batch.map((s) => `${s.sectionType}(${s.markdown.length} chars)`).join(", ")}`);
    const batchResults = await Promise.all(
      batch.map(async (st) => {
        const result = await extractSection(apiKey, st, documentType, undefined, auditLog);
        const status = result.data ? "OK" : `FAILED${result.error ? `: ${result.error.slice(0, 100)}` : ""}`;
        console.log(`[section-extractor] ${st.sectionType}: ${status}`);
        return result;
      }),
    );
    results.push(...batchResults);
  }

  return results;
}
