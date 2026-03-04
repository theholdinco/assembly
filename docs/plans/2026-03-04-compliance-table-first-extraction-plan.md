# Compliance Table-First Hybrid Extraction — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add pdfplumber `extract_tables()` as a fast, cheap first-pass extractor for compliance report tabular sections, falling back to Claude only when table quality is low.

**Architecture:** New Python script extracts all tables from the PDF in one call. TypeScript parsers convert raw tables into existing Zod schemas per section. The section extractor tries tables first, scores quality, and falls back to Claude if quality < 0.7. An audit logger tracks which method was used per section. A date reconciler resolves conflicts between PPM and compliance dates.

**Tech Stack:** Python (pdfplumber), TypeScript (existing Next.js + Zod schemas), existing `pdf-text-extractor.ts` pattern for Python↔TS bridge.

---

## Task 1: Python Table Extraction Script

**Files:**
- Create: `web/scripts/extract_pdf_tables.py`

**Context:** The existing `web/scripts/extract_pdf_text.py` extracts raw text per page. We need a companion script that extracts structured tables using `pdfplumber.extract_tables()`. It follows the same pattern: base64 PDF via stdin, JSON via stdout.

**Step 1: Create the script**

```python
#!/usr/bin/env python3
"""Extract tables + text from a PDF using pdfplumber.
Receives base64 PDF on stdin. Outputs JSON on stdout.
Optional env vars: START_PAGE, END_PAGE (1-indexed, inclusive).
"""
import sys, json, base64, tempfile, os
import pdfplumber

def extract(pdf_path):
    start = int(os.environ.get("START_PAGE", "1")) - 1  # convert to 0-indexed
    end_env = os.environ.get("END_PAGE")
    pages_out = []

    with pdfplumber.open(pdf_path) as pdf:
        end = int(end_env) if end_env else len(pdf.pages)  # end is 1-indexed inclusive
        for i in range(start, min(end, len(pdf.pages))):
            page = pdf.pages[i]
            text = page.extract_text() or ""
            raw_tables = page.extract_tables() or []
            tables = []
            for table in raw_tables:
                if not table or len(table) < 2:
                    continue
                headers = [str(c).strip() if c else "" for c in table[0]]
                rows = []
                for row in table[1:]:
                    rows.append([str(c).strip() if c else "" for c in row])
                tables.append({
                    "headers": headers,
                    "rows": rows,
                    "column_count": len(headers),
                    "row_count": len(rows),
                })
            pages_out.append({
                "page": i + 1,  # 1-indexed
                "tables": tables,
                "text": text,
            })

    return {"pages": pages_out, "total_pages": len(pages_out)}

if __name__ == "__main__":
    b64 = sys.stdin.read()
    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as f:
        f.write(base64.b64decode(b64))
        tmp_path = f.name
    try:
        result = extract(tmp_path)
        json.dump(result, sys.stdout)
    finally:
        os.unlink(tmp_path)
```

**Step 2: Verify the script works**

Run manually with a test PDF:
```bash
cd web && echo "test" | python3 scripts/extract_pdf_tables.py
# Should fail gracefully (invalid PDF) — confirms script loads and runs
```

**Step 3: Commit**

```bash
git add web/scripts/extract_pdf_tables.py
git commit -m "feat: add pdfplumber table extraction script"
```

---

## Task 2: TypeScript Table Extractor Wrapper

**Files:**
- Create: `web/lib/clo/extraction/table-extractor.ts`

**Context:** Mirrors `web/lib/clo/extraction/pdf-text-extractor.ts` (lines 1-82). Spawns the Python script, parses JSON output. The key difference is it also extracts tables, not just text.

**Step 1: Create the TypeScript wrapper**

```typescript
import { spawn } from "child_process";
import { existsSync } from "fs";
import path from "path";

export interface TableData {
  headers: string[];
  rows: string[][];
  column_count: number;
  row_count: number;
}

export interface PageTableData {
  page: number;
  tables: TableData[];
  text: string;
}

export interface PdfTableResult {
  pages: PageTableData[];
  totalPages: number;
}

function resolveScriptPath(): string {
  if (typeof __dirname !== "undefined") {
    const fromDirname = path.resolve(__dirname, "../../../../scripts/extract_pdf_tables.py");
    if (existsSync(fromDirname)) return fromDirname;
    const fromDirname2 = path.resolve(__dirname, "../../../scripts/extract_pdf_tables.py");
    if (existsSync(fromDirname2)) return fromDirname2;
  }
  return path.resolve(process.cwd(), "scripts/extract_pdf_tables.py");
}

function findPython(): string {
  return process.env.PYTHON_BIN || "python3";
}

export async function extractPdfTables(
  base64: string,
  startPage?: number,
  endPage?: number,
): Promise<PdfTableResult> {
  const scriptPath = resolveScriptPath();
  const pythonBin = findPython();

  const env: Record<string, string> = { ...process.env } as Record<string, string>;
  if (startPage) env.START_PAGE = String(startPage);
  if (endPage) env.END_PAGE = String(endPage);

  return new Promise((resolve, reject) => {
    const proc = spawn(pythonBin, [scriptPath], {
      stdio: ["pipe", "pipe", "pipe"],
      env,
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
    proc.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });

    proc.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`pdfplumber table extraction failed (exit ${code}): ${stderr}`));
        return;
      }
      try {
        const result = JSON.parse(stdout) as { pages: PageTableData[]; total_pages: number };
        resolve({ pages: result.pages, totalPages: result.total_pages });
      } catch (e) {
        reject(new Error(`Failed to parse pdfplumber table output: ${(e as Error).message}`));
      }
    });

    proc.on("error", (err) => {
      reject(new Error(`Failed to spawn ${pythonBin}: ${err.message}`));
    });

    proc.stdin.write(base64);
    proc.stdin.end();
  });
}
```

**Step 2: Verify TypeScript compiles**

```bash
cd web && npx tsc --noEmit lib/clo/extraction/table-extractor.ts 2>&1 | head -20
```

**Step 3: Commit**

```bash
git add web/lib/clo/extraction/table-extractor.ts
git commit -m "feat: add TypeScript wrapper for pdfplumber table extraction"
```

---

## Task 3: Audit Logger

**Files:**
- Create: `web/lib/clo/extraction/audit-logger.ts`

**Context:** Tracks which extraction method was used per section (table vs Claude vs fallback), quality scores, record counts, and timing. This is critical for debugging extraction quality — cowork's methodology log was their most valuable debugging tool.

**Step 1: Create the audit logger**

```typescript
export interface ExtractionAuditEntry {
  sectionType: string;
  method: "table" | "claude" | "table+claude_fallback";
  pagesScanned: string;
  recordsExtracted: number;
  fieldsPerRecord: number;
  qualityScore: number;
  nullFieldRatio: number;
  typeErrors: string[];
  rawSamples: Record<string, unknown>[];
  dataQualityNotes: string[];
  durationMs: number;
}

export interface ExtractionAuditLog {
  extractionDateTime: string;
  documentType: "compliance_report" | "ppm";
  pdfPages: number;
  entries: ExtractionAuditEntry[];
}

export function createAuditLog(documentType: "compliance_report" | "ppm", pdfPages: number): ExtractionAuditLog {
  return {
    extractionDateTime: new Date().toISOString(),
    documentType,
    pdfPages,
    entries: [],
  };
}

export function addAuditEntry(log: ExtractionAuditLog, entry: ExtractionAuditEntry): void {
  log.entries.push(entry);
  const emoji = entry.method === "table" ? "TABLE" : entry.method === "claude" ? "CLAUDE" : "FALLBACK";
  console.log(
    `[audit] ${entry.sectionType}: ${emoji} | quality=${entry.qualityScore.toFixed(2)} | records=${entry.recordsExtracted} | nulls=${(entry.nullFieldRatio * 100).toFixed(0)}% | ${entry.durationMs}ms`,
  );
  if (entry.typeErrors.length > 0) {
    console.log(`[audit]   type errors: ${entry.typeErrors.join(", ")}`);
  }
  if (entry.dataQualityNotes.length > 0) {
    for (const note of entry.dataQualityNotes) {
      console.log(`[audit]   note: ${note}`);
    }
  }
}

export function logAuditSummary(log: ExtractionAuditLog): void {
  const tableSections = log.entries.filter((e) => e.method === "table");
  const claudeSections = log.entries.filter((e) => e.method === "claude");
  const fallbackSections = log.entries.filter((e) => e.method === "table+claude_fallback");
  const totalRecords = log.entries.reduce((sum, e) => sum + e.recordsExtracted, 0);
  const avgQuality = log.entries.length > 0
    ? log.entries.reduce((sum, e) => sum + e.qualityScore, 0) / log.entries.length
    : 0;

  console.log(`[audit] ═══ EXTRACTION AUDIT SUMMARY ═══`);
  console.log(`[audit] table-extracted: ${tableSections.length} sections`);
  console.log(`[audit] claude-extracted: ${claudeSections.length} sections`);
  console.log(`[audit] fallback (table→claude): ${fallbackSections.length} sections`);
  console.log(`[audit] total records: ${totalRecords}`);
  console.log(`[audit] avg quality: ${avgQuality.toFixed(2)}`);
  console.log(`[audit] ════════════════════════════════`);
}
```

**Step 2: Commit**

```bash
git add web/lib/clo/extraction/audit-logger.ts
git commit -m "feat: add extraction audit logger for table-first pipeline"
```

---

## Task 4: Table Parsers — Quality Scoring Utility

**Files:**
- Create: `web/lib/clo/extraction/table-parser.ts`

**Context:** This file will contain all section-specific table parsers. Start with the quality scoring infrastructure and utility functions, then add parsers one at a time in subsequent tasks.

**Step 1: Create file with quality scoring + utilities**

```typescript
import type { PageTableData, TableData } from "./table-extractor";

// ---------------------------------------------------------------------------
// Quality scoring
// ---------------------------------------------------------------------------

export interface TableParseResult<T> {
  data: T | null;
  quality: number;
  recordCount: number;
  nullFieldRatio: number;
  typeErrors: string[];
  notes: string[];
}

export function scoreResult<T extends Record<string, unknown>>(
  records: T[],
  expectedCountRange: [number, number],
  requiredFields: (keyof T)[],
): Omit<TableParseResult<T[]>, "data"> {
  const notes: string[] = [];
  const typeErrors: string[] = [];

  if (records.length === 0) {
    return { quality: 0, recordCount: 0, nullFieldRatio: 1, typeErrors: [], notes: ["no records extracted"] };
  }

  let score = 0;

  // +0.3 if we have records
  score += 0.3;

  // +0.2 if record count is in expected range
  const [minCount, maxCount] = expectedCountRange;
  if (records.length >= minCount && records.length <= maxCount) {
    score += 0.2;
  } else {
    notes.push(`record count ${records.length} outside expected range [${minCount}, ${maxCount}]`);
  }

  // Calculate null field ratio across required fields
  let totalFields = 0;
  let nullFields = 0;
  for (const record of records) {
    for (const field of requiredFields) {
      totalFields++;
      if (record[field] == null || record[field] === "") nullFields++;
    }
  }
  const nullFieldRatio = totalFields > 0 ? nullFields / totalFields : 1;

  // +0.3 if null ratio < 0.3
  if (nullFieldRatio < 0.3) {
    score += 0.3;
  } else {
    notes.push(`null field ratio ${(nullFieldRatio * 100).toFixed(0)}% exceeds 30% threshold`);
  }

  // +0.2 if no type errors
  if (typeErrors.length === 0) {
    score += 0.2;
  }

  return { quality: score, recordCount: records.length, nullFieldRatio, typeErrors, notes };
}

// ---------------------------------------------------------------------------
// Table utilities
// ---------------------------------------------------------------------------

/** Get all tables from a page range (pages are 1-indexed) */
export function tablesForPages(allPages: PageTableData[], startPage: number, endPage: number): { page: number; table: TableData }[] {
  const result: { page: number; table: TableData }[] = [];
  for (const p of allPages) {
    if (p.page >= startPage && p.page <= endPage) {
      for (const table of p.tables) {
        result.push({ page: p.page, table });
      }
    }
  }
  return result;
}

/** Get combined text from a page range */
export function textForPages(allPages: PageTableData[], startPage: number, endPage: number): string {
  return allPages
    .filter((p) => p.page >= startPage && p.page <= endPage)
    .map((p) => p.text)
    .join("\n\n");
}

/** Parse a numeric value from a table cell string */
export function parseNumber(cell: string | null | undefined): number | null {
  if (!cell) return null;
  const cleaned = cell.replace(/[,%\s]/g, "").replace(/[()]/g, "");
  if (cleaned === "" || cleaned === "N/A" || cleaned === "-" || cleaned === "n/a") return null;
  const num = Number(cleaned);
  return isNaN(num) ? null : num;
}

/** Parse a percentage value (returns the number, e.g., "117.85%" → 117.85) */
export function parsePercent(cell: string | null | undefined): number | null {
  if (!cell) return null;
  const match = cell.match(/([\d.,]+)\s*%/);
  if (match) return parseNumber(match[1]);
  // If it looks like a bare number in a percentage context, return it
  return parseNumber(cell);
}

/** Parse a date string to YYYY-MM-DD format */
export function parseDate(cell: string | null | undefined): string | null {
  if (!cell) return null;
  const trimmed = cell.trim();
  if (trimmed === "" || trimmed === "N/A" || trimmed === "-") return null;

  // DD-Mon-YYYY (e.g., "26-Apr-2024", "15-Jul-2035")
  const ddMonYyyy = trimmed.match(/(\d{1,2})-(\w{3})-(\d{4})/);
  if (ddMonYyyy) {
    const months: Record<string, string> = {
      Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06",
      Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12",
    };
    const mon = months[ddMonYyyy[2]];
    if (mon) return `${ddMonYyyy[3]}-${mon}-${ddMonYyyy[1].padStart(2, "0")}`;
  }

  // Already YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;

  return null;
}

/** Check if a row looks like a header row (all cells are label-like strings) */
export function isHeaderRow(row: string[]): boolean {
  const headerKeywords = ["test name", "class", "description", "security id", "type", "numerator", "denominator", "isin", "obligor"];
  const text = row.join(" ").toLowerCase();
  return headerKeywords.some((kw) => text.includes(kw));
}
```

**Step 2: Commit**

```bash
git add web/lib/clo/extraction/table-parser.ts
git commit -m "feat: add table parser utilities and quality scoring"
```

---

## Task 5: Compliance Summary Table Parser

**Files:**
- Modify: `web/lib/clo/extraction/table-parser.ts`

**Context:** The compliance summary is on pages 2-3 of BNY Mellon reports. It contains a tranche table (Class A through Subordinated Notes with balances, coupons, spreads, maturity) and a Deal Summary section with key dates and pool metrics. This is the "goldmine" page — most deal-level dates and all tranche info come from here.

**Step 1: Add the compliance summary parser**

Append to `table-parser.ts`:

```typescript
// ---------------------------------------------------------------------------
// Compliance Summary Parser (pages 2-3)
// ---------------------------------------------------------------------------

export interface ParsedDealDates {
  reportDate: string | null;
  paymentDate: string | null;
  closingDate: string | null;
  effectiveDate: string | null;
  reinvestmentPeriodEnd: string | null;
  statedMaturity: string | null;
}

export interface ParsedComplianceSummary {
  reportDate: string | null;
  paymentDate: string | null;
  dealName: string | null;
  trusteeName: string | null;
  collateralManager: string | null;
  tranches: Array<{
    className: string;
    principalAmount: number | null;
    currentBalance: number | null;
    couponRate: number | null;
    spread: number | null;
    rating: string | null;
    maturityDate: string | null;
  }>;
  totalPar: number | null;
  warf: number | null;
  diversityScore: number | null;
  numberOfAssets: number | null;
  numberOfObligors: number | null;
  walYears: number | null;
  waRecoveryRate: number | null;
  wacSpread: number | null;
  dealDates: ParsedDealDates;
}

/** Extract key-value pairs from Deal Summary text using regex */
function extractDealSummaryDates(text: string): ParsedDealDates {
  const find = (patterns: RegExp[]): string | null => {
    for (const p of patterns) {
      const m = text.match(p);
      if (m) return parseDate(m[1]);
    }
    return null;
  };

  return {
    reportDate: find([/(?:As of|Report Date)[:\s]+(\d{1,2}-\w{3}-\d{4})/i]),
    paymentDate: find([/(?:Current Payment Date|Next Payment Date|Payment Date)[:\s]+(\d{1,2}-\w{3}-\d{4})/i]),
    closingDate: find([/(?:Closing Date|Original Closing Date)[:\s]+(\d{1,2}-\w{3}-\d{4})/i]),
    effectiveDate: find([/(?:Effective Date)[:\s]+(\d{1,2}-\w{3}-\d{4})/i]),
    reinvestmentPeriodEnd: find([/(?:Reinvestment Period End Date|Reinvestment.*End)[:\s]+(\d{1,2}-\w{3}-\d{4})/i]),
    statedMaturity: find([/(?:Stated Maturity|Legal Final Maturity)[:\s]+(\d{1,2}-\w{3}-\d{4})/i]),
  };
}

/** Extract pool metrics from Deal Summary text */
function extractPoolMetrics(text: string): Pick<ParsedComplianceSummary, "totalPar" | "warf" | "diversityScore" | "numberOfAssets" | "numberOfObligors" | "walYears" | "waRecoveryRate" | "wacSpread"> {
  const findNum = (patterns: RegExp[]): number | null => {
    for (const p of patterns) {
      const m = text.match(p);
      if (m) return parseNumber(m[1]);
    }
    return null;
  };

  return {
    totalPar: findNum([/(?:Aggregate.*Principal|Total Par|Collateral Principal)[:\s]+([\d,]+)/i]),
    warf: findNum([/(?:WARF|Weighted Average Rating Factor)[:\s]+([\d.]+)/i]),
    diversityScore: findNum([/(?:Diversity Score)[:\s]+([\d.]+)/i]),
    numberOfAssets: findNum([/(?:Number of Assets|No\.\s*of\s*Assets)[:\s]+(\d+)/i]),
    numberOfObligors: findNum([/(?:Number of Obligors|No\.\s*of\s*Obligors)[:\s]+(\d+)/i]),
    walYears: findNum([/(?:WAL|Weighted Average Life)[:\s]+([\d.]+)/i]),
    waRecoveryRate: findNum([/(?:WA Recovery Rate|Weighted Average Recovery)[:\s]+([\d.]+)/i]),
    wacSpread: findNum([/(?:WA Spread|Weighted Average Spread)[:\s]+([\d.]+)/i]),
  };
}

export function parseComplianceSummaryTables(
  allPages: PageTableData[],
  startPage: number,
  endPage: number,
): TableParseResult<ParsedComplianceSummary> {
  const pageTables = tablesForPages(allPages, startPage, endPage);
  const text = textForPages(allPages, startPage, endPage);

  const tranches: ParsedComplianceSummary["tranches"] = [];

  for (const { table } of pageTables) {
    for (const row of table.rows) {
      if (row.length < 3) continue;
      const firstCell = row[0]?.trim() ?? "";

      // Tranche rows contain "Class" or "Senior" or "Subordinated"
      if (/^(Class|Senior|Subordinated)/i.test(firstCell)) {
        tranches.push({
          className: firstCell,
          principalAmount: parseNumber(row[1]),
          currentBalance: parseNumber(row[2]),
          couponRate: parsePercent(row[3]),
          spread: parseNumber(row[4]),
          rating: row.length > 6 ? (row[6]?.trim() || null) : null,
          // Maturity is typically in column 13 (0-indexed) for BNY Mellon format
          maturityDate: row.length > 13 ? parseDate(row[13]) : null,
        });
      }
    }
  }

  const dealDates = extractDealSummaryDates(text);
  const poolMetrics = extractPoolMetrics(text);

  // Also try to extract reportDate and dealName from text
  const reportDateMatch = text.match(/(?:As of|Report Date)[:\s]+(\d{1,2}-\w{3}-\d{4})/i);
  const dealNameMatch = text.match(/Ares European CLO [IVXLCDM]+ DAC/i) ?? text.match(/([A-Z][A-Za-z\s]+ CLO [IVXLCDM]+[A-Za-z\s]*)/);

  const result: ParsedComplianceSummary = {
    reportDate: reportDateMatch ? parseDate(reportDateMatch[1]) : dealDates.reportDate,
    paymentDate: dealDates.paymentDate,
    dealName: dealNameMatch ? dealNameMatch[0].trim() : null,
    trusteeName: null, // Extracted from text if needed
    collateralManager: null,
    tranches,
    ...poolMetrics,
    dealDates,
  };

  const scoring = scoreResult(
    tranches as unknown as Record<string, unknown>[],
    [4, 30],
    ["className", "currentBalance"] as any,
  );

  return { data: result, ...scoring };
}
```

**Step 2: Commit**

```bash
git add web/lib/clo/extraction/table-parser.ts
git commit -m "feat: add compliance summary table parser with date extraction"
```

---

## Task 6: Compliance Test Table Parser

**Files:**
- Modify: `web/lib/clo/extraction/table-parser.ts`

**Context:** Compliance tests live on pages 3-8 in BNY Mellon reports. Each row has 8+ columns: testName, numerator, denominator, priorOutcome, actualValue, triggerLevel, (gap), result. Cowork extracted 88 tests from these tables. Test type is classified by keyword matching on the test name.

**Step 1: Add the compliance test parser**

Append to `table-parser.ts`:

```typescript
// ---------------------------------------------------------------------------
// Compliance Test Parser (pages 3-8)
// ---------------------------------------------------------------------------

export interface ParsedComplianceTest {
  testName: string;
  testType: string;
  testClass: string | null;
  numerator: number | null;
  denominator: number | null;
  actualValue: number | null;
  triggerLevel: number | null;
  isPassing: boolean | null;
}

function classifyTestType(name: string): string {
  const lower = name.toLowerCase();
  if (lower.includes("par value") || lower.includes("overcollateral")) return "Par Value";
  if (lower.includes("interest coverage")) return "Interest Coverage";
  if (lower.includes("credit exposure")) return "Credit Exposure";
  if (lower.includes("weighted average")) return "Weighted Average";
  if (lower.includes("concentration") || lower.includes("industry") || lower.includes("country")) return "Concentration";
  return "Other";
}

function extractTestClass(name: string): string | null {
  const m = name.match(/Class(?:es)?\s+([A-F](?:\/[A-F])?(?:-RR)?)/i);
  return m ? m[1].toUpperCase() : null;
}

export function parseComplianceTestTables(
  allPages: PageTableData[],
  startPage: number,
  endPage: number,
): TableParseResult<ParsedComplianceTest[]> {
  const pageTables = tablesForPages(allPages, startPage, endPage);
  const tests: ParsedComplianceTest[] = [];
  const seen = new Set<string>();

  for (const { table } of pageTables) {
    for (const row of table.rows) {
      if (row.length < 8) continue;

      const testName = row[0]?.trim() ?? "";
      if (testName.length < 3) continue;
      if (isHeaderRow(row)) continue;

      // Skip rows that look like tranche descriptions (no test data)
      const hasNumericData = row.slice(1).some((cell) => {
        const n = parseNumber(cell);
        return n !== null;
      });
      if (!hasNumericData) continue;

      // Dedup key
      const dedupKey = testName.toLowerCase().replace(/\s+/g, " ");
      if (seen.has(dedupKey)) continue;
      seen.add(dedupKey);

      const resultCell = row[7]?.trim() ?? "";

      tests.push({
        testName,
        testType: classifyTestType(testName),
        testClass: extractTestClass(testName),
        numerator: parseNumber(row[1]),
        denominator: parseNumber(row[2]),
        actualValue: parsePercent(row[4]) ?? parseNumber(row[4]),
        triggerLevel: parsePercent(row[5]) ?? parseNumber(row[5]),
        isPassing: resultCell.toLowerCase().includes("pass") ? true
          : resultCell.toLowerCase().includes("fail") ? false
          : null,
      });
    }
  }

  const scoring = scoreResult(
    tests as unknown as Record<string, unknown>[],
    [5, 150],
    ["testName", "actualValue", "triggerLevel"] as any,
  );

  return { data: tests, ...scoring };
}
```

**Step 2: Commit**

```bash
git add web/lib/clo/extraction/table-parser.ts
git commit -m "feat: add compliance test table parser"
```

---

## Task 7: Holdings Table Parser

**Files:**
- Modify: `web/lib/clo/extraction/table-parser.ts`

**Context:** Holdings (Asset Information I/II/III) live on pages 10-28 in BNY Mellon reports. Column structure: obligorName(0), securityId(1), assetType(2), marketPrice(3), parBalance(4), principalBalance(5), unfundedAmount(6), securityLevel(7), maturityDate(8). Cowork extracted 461 holdings. Asset type is determined by checking column headers or section headers on each page, not hardcoded page ranges.

**Step 1: Add the holdings parser**

Append to `table-parser.ts`:

```typescript
// ---------------------------------------------------------------------------
// Holdings Parser (pages 10-28)
// ---------------------------------------------------------------------------

export interface ParsedHolding {
  obligorName: string;
  securityId: string | null;
  assetType: string | null;
  marketPrice: number | null;
  parBalance: number | null;
  principalBalance: number | null;
  unfundedAmount: number | null;
  securityLevel: string | null;
  maturityDate: string | null;
}

function detectAssetTypeFromText(pageText: string): string | null {
  const lower = pageText.toLowerCase();
  if (lower.includes("asset information i") || lower.includes("term loan")) return "Term Loan";
  if (lower.includes("asset information ii") || lower.includes("bond")) return "Bond";
  if (lower.includes("asset information iii") || lower.includes("equity")) return "Equity";
  return null;
}

export function parseHoldingsTables(
  allPages: PageTableData[],
  startPage: number,
  endPage: number,
): TableParseResult<ParsedHolding[]> {
  const holdings: ParsedHolding[] = [];
  const seen = new Set<string>();
  let currentAssetType: string | null = "Term Loan";

  for (const p of allPages) {
    if (p.page < startPage || p.page > endPage) continue;

    // Detect asset type from page text
    const detectedType = detectAssetTypeFromText(p.text);
    if (detectedType) currentAssetType = detectedType;

    for (const table of p.tables) {
      for (const row of table.rows) {
        if (row.length < 5) continue;

        const obligor = row[0]?.trim() ?? "";
        if (obligor.length < 3) continue;
        if (isHeaderRow(row)) continue;

        // Skip totals/summary rows
        if (/^(total|sub-?total|grand total)/i.test(obligor)) continue;

        // Dedup by (obligor, securityId)
        const secId = row[1]?.trim() ?? "";
        const dedupKey = `${obligor.toLowerCase()}|${secId.toLowerCase()}`;
        if (seen.has(dedupKey)) continue;
        seen.add(dedupKey);

        holdings.push({
          obligorName: obligor,
          securityId: secId || null,
          assetType: currentAssetType,
          marketPrice: parseNumber(row[3]),
          parBalance: parseNumber(row[4]),
          principalBalance: parseNumber(row[5]),
          unfundedAmount: parseNumber(row[6]),
          securityLevel: row[7]?.trim() || null,
          maturityDate: parseDate(row[8]),
        });
      }
    }
  }

  const scoring = scoreResult(
    holdings as unknown as Record<string, unknown>[],
    [50, 500],
    ["obligorName", "parBalance", "maturityDate"] as any,
  );

  return { data: holdings, ...scoring };
}
```

**Step 2: Commit**

```bash
git add web/lib/clo/extraction/table-parser.ts
git commit -m "feat: add holdings table parser"
```

---

## Task 8: Concentration Parser (Derived from Tests)

**Files:**
- Modify: `web/lib/clo/extraction/table-parser.ts`

**Context:** Concentrations are derived from the already-parsed compliance tests, not from separate table extraction. This is cowork's Pass 3 approach — filter tests by keywords like "credit exposure", "concentration", "industry", "country", "rating". This avoids redundant extraction.

**Step 1: Add the concentration parser**

Append to `table-parser.ts`:

```typescript
// ---------------------------------------------------------------------------
// Concentration Parser (derived from compliance tests)
// ---------------------------------------------------------------------------

export interface ParsedConcentration {
  concentrationType: string;
  bucketName: string;
  actualValue: number | null;
  actualPct: number | null;
  limitValue: number | null;
  limitPct: number | null;
  isPassing: boolean | null;
}

const CONCENTRATION_KEYWORDS = ["credit exposure", "concentration", "industry", "country", "rating", "obligor", "single", "domiciled"];

export function parseConcentrationFromTests(tests: ParsedComplianceTest[]): TableParseResult<ParsedConcentration[]> {
  const concentrations: ParsedConcentration[] = [];

  for (const test of tests) {
    const lower = test.testName.toLowerCase();
    if (!CONCENTRATION_KEYWORDS.some((kw) => lower.includes(kw))) continue;

    concentrations.push({
      concentrationType: test.testType === "Credit Exposure" ? "SINGLE_OBLIGOR"
        : lower.includes("industry") ? "INDUSTRY"
        : lower.includes("country") ? "COUNTRY"
        : lower.includes("rating") ? "RATING"
        : "OTHER",
      bucketName: test.testName,
      actualValue: test.actualValue,
      actualPct: test.actualValue,
      limitValue: test.triggerLevel,
      limitPct: test.triggerLevel,
      isPassing: test.isPassing,
    });
  }

  const scoring = scoreResult(
    concentrations as unknown as Record<string, unknown>[],
    [5, 100],
    ["bucketName", "actualValue"] as any,
  );

  return { data: concentrations, ...scoring };
}
```

**Step 2: Commit**

```bash
git add web/lib/clo/extraction/table-parser.ts
git commit -m "feat: add concentration parser derived from compliance tests"
```

---

## Task 9: Wire Table-First Logic into Section Extractor

**Files:**
- Modify: `web/lib/clo/extraction/section-extractor.ts` (lines 1-189)

**Context:** This is the core integration. `extractSection()` currently always calls Claude. We add a table-first path for compliance reports: try table parsing, check quality score, fall back to Claude if < 0.7. We also need to pass the table data through — the `SectionText` type needs to carry table data alongside markdown text.

The `extractAllSections()` function (line 163) needs to accept and forward table data. The table data is extracted once up front (in the runner) and sliced per section.

**Step 1: Extend SectionText type**

In `web/lib/clo/extraction/text-extractor.ts`, find the `SectionText` export and note its shape. We will NOT modify it — instead, `extractSection` will accept an optional `tablePages` parameter.

Add to `section-extractor.ts` after the existing imports (line 5):

```typescript
import type { PageTableData } from "./table-extractor";
import {
  parseComplianceSummaryTables,
  parseComplianceTestTables,
  parseHoldingsTables,
  parseConcentrationFromTests,
  type TableParseResult,
  type ParsedComplianceTest,
} from "./table-parser";
import { addAuditEntry, type ExtractionAuditLog, type ExtractionAuditEntry } from "./audit-logger";
```

**Step 2: Add table-first extraction function**

Add above `extractSection()` (before line 118):

```typescript
const TABLE_QUALITY_THRESHOLD = 0.7;

// Sections where table extraction is attempted
const TABLE_ELIGIBLE_SECTIONS = new Set([
  "compliance_summary",
  "par_value_tests",
  "interest_coverage_tests",
  "asset_schedule",
  "concentration_tables",
]);

// Cache parsed compliance tests for concentration derivation
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
      // Convert to the expected schema shape
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
```

**Step 3: Modify `extractSection()` signature and add table-first logic**

Change the `extractSection` function (line 118) to accept optional `tablePages` and `auditLog`:

```typescript
export async function extractSection(
  apiKey: string,
  sectionText: SectionText,
  documentType: "compliance_report" | "ppm",
  tablePages?: PageTableData[],
  auditLog?: ExtractionAuditLog,
): Promise<SectionExtractionResult> {
  const startTime = Date.now();

  // Table-first path for compliance reports
  if (documentType === "compliance_report" && tablePages && TABLE_ELIGIBLE_SECTIONS.has(sectionText.sectionType)) {
    const tableResult = tryTableExtraction(
      sectionText.sectionType,
      tablePages,
      sectionText.pageStart,
      sectionText.pageEnd,
    );

    if (tableResult && tableResult.quality >= TABLE_QUALITY_THRESHOLD && tableResult.data) {
      console.log(`[section-extractor] ${sectionText.sectionType}: TABLE extraction succeeded (quality=${tableResult.quality.toFixed(2)}, records=${tableResult.recordCount})`);

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

      return {
        sectionType: sectionText.sectionType,
        data: tableResult.data as Record<string, unknown>,
        truncated: false,
      };
    }

    // Table extraction failed or low quality — fall back to Claude
    console.log(`[section-extractor] ${sectionText.sectionType}: TABLE quality too low (${tableResult?.quality.toFixed(2) ?? "null"}), falling back to Claude`);

    if (auditLog) {
      addAuditEntry(auditLog, {
        sectionType: sectionText.sectionType,
        method: "table+claude_fallback",
        pagesScanned: `${sectionText.pageStart}-${sectionText.pageEnd}`,
        recordsExtracted: tableResult?.recordCount ?? 0,
        fieldsPerRecord: 0,
        qualityScore: tableResult?.quality ?? 0,
        nullFieldRatio: tableResult?.nullFieldRatio ?? 1,
        typeErrors: tableResult?.typeErrors ?? [],
        rawSamples: [],
        dataQualityNotes: tableResult?.notes ?? ["table extraction returned null"],
        durationMs: Date.now() - startTime,
      });
    }
  }

  // --- Existing Claude extraction path (unchanged) ---
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
    return { sectionType: sectionText.sectionType, data: null, truncated: false, error: result.error };
  }

  let data = result.data;

  if (needsRepair(sectionText.sectionType, data)) {
    const repaired = await repairExtraction(apiKey, sectionText, data!, config);
    if (repaired) data = repaired;
  }

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
      dataQualityNotes: result.error ? [result.error] : [],
      durationMs: Date.now() - startTime,
    });
  }

  return {
    sectionType: sectionText.sectionType,
    data,
    truncated: result.truncated,
  };
}
```

**Step 4: Update `extractAllSections()` to pass table data and audit log**

Modify the signature (line 163) and forward table data:

```typescript
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

  // For compliance reports with table data: extract table-eligible sections first (sequentially)
  // so concentration_tables can use cached test results
  if (documentType === "compliance_report" && tablePages) {
    const tableEligible = items.filter((s) => TABLE_ELIGIBLE_SECTIONS.has(s.sectionType));
    const claudeOnly = items.filter((s) => !TABLE_ELIGIBLE_SECTIONS.has(s.sectionType));

    // Process table-eligible sections sequentially (concentration depends on tests)
    for (const st of tableEligible) {
      console.log(`[section-extractor] table-first: ${st.sectionType}(${st.markdown.length} chars)`);
      const result = await extractSection(apiKey, st, documentType, tablePages, auditLog);
      const status = result.data ? "OK" : `FAILED${result.error ? `: ${result.error.slice(0, 100)}` : ""}`;
      console.log(`[section-extractor] ${st.sectionType}: ${status}`);
      results.push(result);
    }

    // Process Claude-only sections in batches (existing parallel logic)
    for (let i = 0; i < claudeOnly.length; i += concurrency) {
      const batch = claudeOnly.slice(i, i + concurrency);
      const batchNum = Math.floor(i / concurrency) + 1;
      const totalBatches = Math.ceil(claudeOnly.length / concurrency);
      console.log(`[section-extractor] claude batch ${batchNum}/${totalBatches}: ${batch.map((s) => `${s.sectionType}(${s.markdown.length} chars)`).join(", ")}`);
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
```

**Step 5: Verify TypeScript compiles**

```bash
cd web && npx tsc --noEmit lib/clo/extraction/section-extractor.ts 2>&1 | head -20
```

**Step 6: Commit**

```bash
git add web/lib/clo/extraction/section-extractor.ts
git commit -m "feat: wire table-first extraction into section extractor with quality gate"
```

---

## Task 10: Wire Table Extraction into Runner

**Files:**
- Modify: `web/lib/clo/extraction/runner.ts` (lines 738-1135)

**Context:** `runSectionExtraction()` is the main compliance extraction entry point. We need to: (1) extract tables from the PDF after document mapping, (2) pass table data to `extractAllSections()`, (3) log the audit summary. The table extraction happens once for all pages, then each section parser picks its page range.

**Step 1: Add imports**

Add after line 13 (after `import { extractPdfText } from "./pdf-text-extractor";`):

```typescript
import { extractPdfTables } from "./table-extractor";
import { createAuditLog, logAuditSummary } from "./audit-logger";
```

**Step 2: Add table extraction phase after document mapping**

In `runSectionExtraction()`, after Phase 1 (document mapping, around line 753), add:

```typescript
  // Phase 1.5: Extract tables for compliance reports (table-first hybrid)
  let tablePages: import("./table-extractor").PageTableData[] | undefined;
  let auditLog: import("./audit-logger").ExtractionAuditLog | undefined;

  if (documentMap.documentType === "compliance_report") {
    try {
      await progress("extracting_tables", "Extracting tables from PDF...");
      const tableResult = await extractPdfTables(pdfDoc.base64);
      tablePages = tableResult.pages;
      auditLog = createAuditLog("compliance_report", tableResult.totalPages);
      console.log(`[extraction] pdfplumber extracted tables from ${tableResult.totalPages} pages (${tablePages.reduce((sum, p) => sum + p.tables.length, 0)} total tables)`);
      await progress("extracting_tables_done", `Found ${tablePages.reduce((sum, p) => sum + p.tables.length, 0)} tables across ${tableResult.totalPages} pages`);
    } catch (err) {
      console.warn(`[extraction] pdfplumber table extraction failed, continuing with Claude-only: ${(err as Error).message}`);
    }
  }
```

**Step 3: Pass table data to extractAllSections**

Find the `extractAllSections` call (around line 763) and update it:

```typescript
  const sectionResults = await extractAllSections(apiKey, sectionTexts, documentMap.documentType, 3, tablePages, auditLog);
```

**Step 4: Add audit summary logging after extraction**

After the extraction phase logging (around line 797, after `console.log('[extraction] ═══════════════════════════')`), add:

```typescript
  if (auditLog) {
    logAuditSummary(auditLog);
  }
```

**Step 5: Store audit log in report period**

In the final `UPDATE clo_report_periods` query (around line 1116), add the audit log to the raw_extraction JSON. Change:

```typescript
      JSON.stringify(rawOutputs),
```

to:

```typescript
      JSON.stringify({ ...rawOutputs, _auditLog: auditLog }),
```

**Step 6: Verify TypeScript compiles**

```bash
cd web && npx tsc --noEmit lib/clo/extraction/runner.ts 2>&1 | head -20
```

**Step 7: Commit**

```bash
git add web/lib/clo/extraction/runner.ts
git commit -m "feat: wire table extraction into compliance runner with audit logging"
```

---

## Task 11: Date Reconciler

**Files:**
- Create: `web/lib/clo/extraction/date-reconciler.ts`

**Context:** When both PPM and compliance data exist for a deal, dates can conflict. The refinancing of Ares European CLO XVI changed maturity from 2035 → 2038 and reinvestment period from Jul 2027 → Oct 2029. The compliance report (Apr 2024) has pre-refinancing dates. The PPM (Feb 2026) has current dates. Authority rules determine which source wins per field.

**Step 1: Create the date reconciler**

```typescript
export interface DateAuthority {
  field: string;
  ppmValue: string | null;
  complianceValue: string | null;
  resolvedValue: string | null;
  source: "ppm" | "compliance" | "none";
  reason: string;
}

export interface DateReconciliationResult {
  isRefinanced: boolean;
  authorities: DateAuthority[];
  resolvedDates: Record<string, string | null>;
}

interface DateInputs {
  ppmDates: Record<string, string | null>;
  complianceDates: Record<string, string | null>;
}

// Authority rules: which source wins for each date field
// "ppm" = PPM is authoritative (even if compliance has a value)
// "compliance" = compliance is authoritative (even if PPM has a value)
// "ppm_only" = only ever comes from PPM
// "compliance_only" = only ever comes from compliance
const DATE_AUTHORITY: Record<string, "ppm" | "compliance" | "ppm_only" | "compliance_only"> = {
  closing_date: "compliance",
  effective_date: "compliance",
  current_issue_date: "ppm_only",
  reinvestment_period_end: "ppm",
  non_call_period_end: "ppm_only",
  stated_maturity_date: "ppm",
  first_payment_date: "ppm_only",
  payment_frequency: "ppm",
  report_date: "compliance_only",
  payment_date: "compliance_only",
};

function parseYear(dateStr: string | null): number | null {
  if (!dateStr) return null;
  const m = dateStr.match(/(\d{4})/);
  return m ? parseInt(m[1]) : null;
}

function detectRefinancing(ppmDates: Record<string, string | null>, complianceDates: Record<string, string | null>): boolean {
  const currentIssue = ppmDates.current_issue_date;
  const closing = complianceDates.closing_date ?? ppmDates.closing_date;

  if (!currentIssue || !closing) return false;

  const issueYear = parseYear(currentIssue);
  const closingYear = parseYear(closing);
  if (!issueYear || !closingYear) return false;

  // If current issue date is > 6 months after closing, it's a refinancing
  return issueYear > closingYear || (issueYear === closingYear && currentIssue > closing);
}

export function reconcileDates(inputs: DateInputs): DateReconciliationResult {
  const { ppmDates, complianceDates } = inputs;
  const isRefinanced = detectRefinancing(ppmDates, complianceDates);
  const authorities: DateAuthority[] = [];
  const resolvedDates: Record<string, string | null> = {};

  for (const [field, authority] of Object.entries(DATE_AUTHORITY)) {
    const ppmVal = ppmDates[field] ?? null;
    const complianceVal = complianceDates[field] ?? null;

    let resolvedValue: string | null = null;
    let source: "ppm" | "compliance" | "none" = "none";
    let reason = "";

    switch (authority) {
      case "ppm_only":
        resolvedValue = ppmVal;
        source = ppmVal ? "ppm" : "none";
        reason = ppmVal ? "PPM-only field" : "not available in either source";
        break;

      case "compliance_only":
        resolvedValue = complianceVal;
        source = complianceVal ? "compliance" : "none";
        reason = complianceVal ? "compliance-only field" : "not available in either source";
        break;

      case "ppm":
        // PPM is authoritative, but use compliance as fallback
        if (ppmVal) {
          resolvedValue = ppmVal;
          source = "ppm";
          reason = "PPM authoritative for this field";
          if (complianceVal && complianceVal !== ppmVal) {
            reason += ` (compliance has ${complianceVal} — ${isRefinanced ? "stale pre-refinancing value" : "differs"})`;
          }
        } else if (complianceVal) {
          resolvedValue = complianceVal;
          source = "compliance";
          reason = "PPM missing, using compliance as fallback";
        } else {
          reason = "not available in either source";
        }
        break;

      case "compliance":
        // Compliance is authoritative, PPM as fallback
        if (complianceVal) {
          resolvedValue = complianceVal;
          source = "compliance";
          reason = "compliance authoritative for this field";
        } else if (ppmVal) {
          resolvedValue = ppmVal;
          source = "ppm";
          reason = "compliance missing, using PPM as fallback";
        } else {
          reason = "not available in either source";
        }
        break;
    }

    authorities.push({ field, ppmValue: ppmVal, complianceValue: complianceVal, resolvedValue, source, reason });
    resolvedDates[field] = resolvedValue;

    // Log conflicts
    if (ppmVal && complianceVal && ppmVal !== complianceVal) {
      console.log(`[date-reconciler] CONFLICT ${field}: PPM=${ppmVal} vs Compliance=${complianceVal} → resolved to ${resolvedValue} (${reason})`);
    }
  }

  console.log(`[date-reconciler] refinanced=${isRefinanced}, resolved ${Object.values(resolvedDates).filter(Boolean).length}/${Object.keys(DATE_AUTHORITY).length} dates`);

  return { isRefinanced, authorities, resolvedDates };
}
```

**Step 2: Commit**

```bash
git add web/lib/clo/extraction/date-reconciler.ts
git commit -m "feat: add date reconciler with PPM/compliance authority rules"
```

---

## Task 12: Wire Date Reconciler into Runner

**Files:**
- Modify: `web/lib/clo/extraction/runner.ts`

**Context:** After compliance extraction saves data, check if PPM data exists for this deal. If so, run the date reconciler and update `clo_deals` with the resolved dates. The reconciler runs at the end of `runSectionExtraction()`, after all data is saved but before the final status update.

**Step 1: Add import**

Add to the imports section:

```typescript
import { reconcileDates } from "./date-reconciler";
```

**Step 2: Add reconciliation logic**

In `runSectionExtraction()`, after tranche snapshots insertion (around line 977, after the tranche maturity date inference block) and before Phase 4 (validation), add:

```typescript
  // Phase 3.5: Date reconciliation (if PPM data exists)
  await progress("reconciling_dates", "Reconciling dates between PPM and compliance...");
  const complianceSummaryResult = sections.compliance_summary as Record<string, unknown> | null;
  const dealDates = (complianceSummaryResult as any)?.dealDates as Record<string, string | null> | undefined;

  if (dealDates) {
    // Get PPM dates from existing profile
    const profileRows = await query<{ extracted_constraints: Record<string, unknown> }>(
      "SELECT extracted_constraints FROM clo_profiles WHERE id = $1",
      [profileId],
    );
    const ppmConstraints = profileRows[0]?.extracted_constraints ?? {};
    const ppmKeyDates = (ppmConstraints.keyDates ?? {}) as Record<string, string | null>;

    // Map compliance dates to DB column names
    const complianceDates: Record<string, string | null> = {
      closing_date: dealDates.closingDate ?? null,
      effective_date: dealDates.effectiveDate ?? null,
      reinvestment_period_end: dealDates.reinvestmentPeriodEnd ?? null,
      stated_maturity_date: dealDates.statedMaturity ?? null,
      report_date: dealDates.reportDate ?? null,
      payment_date: dealDates.paymentDate ?? null,
    };

    // Map PPM dates to DB column names
    const ppmDates: Record<string, string | null> = {
      closing_date: ppmKeyDates.originalIssueDate ?? null,
      current_issue_date: ppmKeyDates.currentIssueDate ?? null,
      reinvestment_period_end: ppmKeyDates.reinvestmentPeriodEnd ?? null,
      non_call_period_end: ppmKeyDates.nonCallPeriodEnd ?? null,
      stated_maturity_date: ppmKeyDates.maturityDate ?? null,
      first_payment_date: ppmKeyDates.firstPaymentDate ?? null,
      payment_frequency: ppmKeyDates.paymentFrequency ?? null,
    };

    const reconciliation = reconcileDates({ ppmDates, complianceDates });

    // Update clo_deals with resolved dates
    const d = reconciliation.resolvedDates;
    const updateFields: string[] = [];
    const updateValues: unknown[] = [];
    let paramIdx = 1;

    const dateColumns = [
      "closing_date", "effective_date", "reinvestment_period_end",
      "non_call_period_end", "stated_maturity_date",
    ];
    for (const col of dateColumns) {
      if (d[col]) {
        updateFields.push(`${col} = $${paramIdx++}`);
        updateValues.push(d[col]);
      }
    }

    if (updateFields.length > 0) {
      updateValues.push(dealId);
      await query(
        `UPDATE clo_deals SET ${updateFields.join(", ")}, updated_at = now() WHERE id = $${paramIdx}`,
        updateValues,
      );
      console.log(`[extraction] updated clo_deals with ${updateFields.length} reconciled dates`);
    }

    // Also update report period dates
    if (d.report_date || d.payment_date) {
      const rpUpdateFields: string[] = [];
      const rpUpdateValues: unknown[] = [];
      let rpIdx = 1;
      if (d.payment_date) { rpUpdateFields.push(`payment_date = $${rpIdx++}`); rpUpdateValues.push(d.payment_date); }
      rpUpdateValues.push(reportPeriodId);
      if (rpUpdateFields.length > 0) {
        await query(
          `UPDATE clo_report_periods SET ${rpUpdateFields.join(", ")}, updated_at = now() WHERE id = $${rpIdx}`,
          rpUpdateValues,
        );
      }
    }
  }
```

**Step 3: Verify TypeScript compiles**

```bash
cd web && npx tsc --noEmit lib/clo/extraction/runner.ts 2>&1 | head -20
```

**Step 4: Commit**

```bash
git add web/lib/clo/extraction/runner.ts
git commit -m "feat: wire date reconciler into compliance extraction runner"
```

---

## Task 13: Update PPM Extraction to Pass Table Data

**Files:**
- Modify: `web/lib/clo/extraction/ppm-extraction.ts` (line 48)

**Context:** The PPM extraction also calls `extractAllSections()`. We need to update the call to pass the new optional parameters (undefined for PPM, since we don't use table extraction for PPMs).

**Step 1: Check if the call needs updating**

The call on line 48:
```typescript
const sectionResults = await extractAllSections(apiKey, sectionTexts, documentMap.documentType);
```

This should still work since `tablePages` and `auditLog` are optional. No changes needed unless TypeScript complains. Verify:

```bash
cd web && npx tsc --noEmit lib/clo/extraction/ppm-extraction.ts 2>&1 | head -20
```

If there are no errors, no changes needed. **Commit only if changes were made.**

---

## Task 14: End-to-End Verification

**Files:** None (verification only)

**Step 1: Verify all TypeScript compiles**

```bash
cd web && npx tsc --noEmit 2>&1 | head -30
```

**Step 2: Verify the Python script runs**

```bash
cd web && python3 -c "import pdfplumber; print('pdfplumber available')"
```

**Step 3: Check the file tree**

```bash
ls -la web/lib/clo/extraction/table-*.ts web/lib/clo/extraction/audit-logger.ts web/lib/clo/extraction/date-reconciler.ts web/scripts/extract_pdf_tables.py
```

Expected output: 5 new files exist.

**Step 4: Final commit**

```bash
git add -A
git commit -m "feat: compliance table-first hybrid extraction pipeline

- Python script for pdfplumber extract_tables()
- TypeScript table extractor wrapper
- Section-specific table parsers (summary, tests, holdings, concentrations)
- Quality scoring with 0.7 threshold for Claude fallback
- Audit logging per extraction section
- Date reconciler with PPM/compliance authority rules
- Wired into existing runner and section extractor"
```

---

## Summary of Files

| File | Action | Purpose |
|------|--------|---------|
| `web/scripts/extract_pdf_tables.py` | Create | Python pdfplumber table extraction |
| `web/lib/clo/extraction/table-extractor.ts` | Create | TypeScript wrapper for Python script |
| `web/lib/clo/extraction/table-parser.ts` | Create | Section-specific table parsers + quality scoring |
| `web/lib/clo/extraction/audit-logger.ts` | Create | Extraction audit trail |
| `web/lib/clo/extraction/date-reconciler.ts` | Create | PPM/compliance date conflict resolution |
| `web/lib/clo/extraction/section-extractor.ts` | Modify | Add table-first path with Claude fallback |
| `web/lib/clo/extraction/runner.ts` | Modify | Wire table extraction + audit + date reconciler |
