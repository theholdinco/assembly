import type { Pass1Output, Pass2Output, Pass3Output, Pass4Output, Pass5Output } from "./schemas";

function toSnakeCase(str: string): string {
  return str.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

function toDbRow(obj: Record<string, unknown>, extraFields?: Record<string, unknown>): Record<string, unknown> {
  const row: Record<string, unknown> = { ...extraFields };
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) {
      row[toSnakeCase(key)] = value;
    }
  }
  return row;
}

/** Normalize class name for dedup: "Class A/B" → "a/b", "A/B" → "a/b" */
function normalizeTestClass(name: string): string {
  return name
    .replace(/^class(es)?\s+/i, "")
    .replace(/\s+/g, "")
    .toLowerCase();
}

/** Build a dedup key from test name + class */
function testDedupKey(t: { testName: string; testClass?: string | null }): string {
  const name = t.testName.toLowerCase().replace(/\s+/g, " ").trim();
  const cls = t.testClass ? normalizeTestClass(t.testClass) : "";
  return `${name}|${cls}`;
}

/** Score a test entry by data completeness (higher = more complete) */
function testDataScore(t: Record<string, unknown>): number {
  let score = 0;
  if (t.actualValue != null && typeof t.actualValue === "number") score += 10;
  if (t.triggerLevel != null && typeof t.triggerLevel === "number") score += 5;
  if (t.isPassing != null) score += 3;
  if (t.cushionPct != null) score += 2;
  if (t.numerator != null) score += 1;
  if (t.denominator != null) score += 1;
  return score;
}

/** Deduplicate compliance tests — keep the entry with most data for each unique test */
function deduplicateComplianceTests(
  tests: Pass1Output["complianceTests"],
): Pass1Output["complianceTests"] {
  // Filter out junk entries (text in numeric fields, no useful data)
  const valid = tests.filter((t) => {
    if (!t.testName) return false;
    // Skip entries where actualValue is actually a string description
    if (t.actualValue != null && typeof t.actualValue !== "number") return false;
    if (t.triggerLevel != null && typeof t.triggerLevel !== "number") return false;
    // Skip entries with no numerical data at all
    const hasData = t.actualValue != null || t.triggerLevel != null || t.numerator != null || t.isPassing != null;
    return hasData;
  });

  const groups = new Map<string, typeof valid>();
  for (const t of valid) {
    const key = testDedupKey(t);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(t);
  }

  return Array.from(groups.values()).map((group) => {
    // Pick the entry with the most complete data
    group.sort((a, b) => testDataScore(b) - testDataScore(a));
    return group[0];
  });
}

export function normalizePass1(data: Pass1Output, reportPeriodId: string): {
  poolSummary: Record<string, unknown>;
  complianceTests: Record<string, unknown>[];
  accountBalances: Record<string, unknown>[];
  parValueAdjustments: Record<string, unknown>[];
} {
  const base = { report_period_id: reportPeriodId };
  const dedupedTests = deduplicateComplianceTests(data.complianceTests);

  return {
    poolSummary: toDbRow(data.poolSummary, base),
    complianceTests: dedupedTests.map((t) => toDbRow(t, base)),
    accountBalances: data.accountBalances.map((a) => toDbRow(a, base)),
    parValueAdjustments: data.parValueAdjustments.map((p) => toDbRow(p, base)),
  };
}

export function normalizePass2(data: Pass2Output, reportPeriodId: string): {
  holdings: Record<string, unknown>[];
} {
  const base = { report_period_id: reportPeriodId };
  return {
    holdings: data.holdings.map((h) => toDbRow(h, base)),
  };
}

export function normalizePass3(data: Pass3Output, reportPeriodId: string): {
  concentrations: Record<string, unknown>[];
} {
  const base = { report_period_id: reportPeriodId };
  return {
    concentrations: data.concentrations.map((c) => toDbRow(c, base)),
  };
}

export function normalizePass4(data: Pass4Output, reportPeriodId: string): {
  waterfallSteps: Record<string, unknown>[];
  proceeds: Record<string, unknown>[];
  trades: Record<string, unknown>[];
  tradingSummary: Record<string, unknown> | null;
  trancheSnapshots: Array<{ className: string; data: Record<string, unknown> }>;
} {
  const base = { report_period_id: reportPeriodId };

  return {
    waterfallSteps: data.waterfallSteps.map((w) => toDbRow(w, base)),
    proceeds: data.proceeds.map((p) => toDbRow(p, base)),
    trades: data.trades.map((t) => toDbRow(t, base)),
    tradingSummary: data.tradingSummary ? toDbRow(data.tradingSummary, base) : null,
    trancheSnapshots: data.trancheSnapshots.map((ts) => {
      const { className, ...rest } = ts;
      return { className, data: toDbRow(rest, base) };
    }),
  };
}

export function normalizePass5(data: Pass5Output, reportPeriodId: string, dealId: string): {
  supplementaryData: Record<string, unknown>;
  events: Record<string, unknown>[];
} {
  const { events, _overflow, ...supplementaryFields } = data;

  return {
    supplementaryData: supplementaryFields as Record<string, unknown>,
    events: events.map((e) => toDbRow(e, { deal_id: dealId, report_period_id: reportPeriodId })),
  };
}
