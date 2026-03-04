# Compliance Table-First Hybrid Extraction Design

**Date**: 2026-03-04
**Status**: Approved
**Scope**: Compliance report extraction only (PPM extraction improvements are a separate effort)

## Problem

The current compliance extraction pipeline sends pdfplumber raw text to Claude for structured extraction. This is:
- Expensive (Claude API calls for data already in clean tables)
- Slow (10 sections x Claude round-trip)
- Prone to hallucination on tabular data
- Missing data that pdfplumber `extract_tables()` handles cleanly (cowork's approach extracted 88 compliance tests, 461 holdings, 22 tranche snapshots with zero LLM calls)

## Solution: Table-First Hybrid

Try pdfplumber `extract_tables()` first for each section. If table quality is high, use directly. If low, fall back to existing Claude extraction.

## Architecture

```
PDF → Document Mapper (existing) → Page Ranges per Section
                                        ↓
                                 For each section:
                          ┌──────────────────────────┐
                          │ pdfplumber extract_tables()│
                          └───────────┬──────────────┘
                                      ↓
                          ┌──────────────────────────┐
                          │ Section-Specific Parser    │
                          │ + Quality Score (0.0-1.0)  │
                          └───────────┬──────────────┘
                                 ↙         ↘
                          score ≥ 0.7    score < 0.7
                              ↓              ↓
                      Use table data    Claude extraction
                      directly          (existing pipeline)
                              ↘         ↙
                          Audit Log → Normalize → DB
```

## New Files

### 1. `web/scripts/extract_pdf_tables.py`

Extends existing `extract_pdf_text.py` pattern. Receives base64 PDF via stdin, returns JSON via stdout.

**Input**: base64 PDF + optional page range (via env vars)
**Output**:
```json
{
  "pages": [{
    "page": 3,
    "tables": [{
      "headers": ["Class", "Original Balance", ...],
      "rows": [["Class A-RR", "248,000,000", ...], ...],
      "column_count": 14,
      "row_count": 8
    }],
    "text": "raw page text for fallback"
  }]
}
```

### 2. `web/lib/clo/extraction/table-extractor.ts`

TypeScript wrapper mirroring `pdf-text-extractor.ts`:
- `extractPdfTables(base64, startPage, endPage)` → typed table results
- Spawns Python process, parses JSON output

### 3. `web/lib/clo/extraction/table-parser.ts`

Section-specific parsers converting raw tables → existing Zod schemas.

**`parseComplianceSummaryTables(tables, text)`**
- Page 2-3 tranche table: className(0), originalBalance(1), currentBalance(2), couponRate(3), spread(4), maturityDate(13)
- Page 3 Deal Summary: regex on text for report_date, payment_date, closing_date, effective_date, reinvestment_period_end, stated_maturity_date
- Pool metrics: totalPar, warf, diversityScore from summary table
- Returns: `ComplianceSummary` schema + `dealDates` sidecar

**`parseComplianceTestTables(tables)`**
- Pages 3-8, rows with ≥ 8 columns
- testName(0), numerator(1), denominator(2), priorOutcome(3), actualValue(4), triggerLevel(5), result(7)
- Test type classification by keyword matching on test name
- Skip header rows, tranche name rows
- Dedup using existing `deduplicateComplianceTests()` logic
- Returns: `ParValueTests` + `InterestCoverageTests`

**`parseHoldingsTables(tables, pageRanges)`**
- Pages 10-28: obligorName(0), securityId(1), assetType(2), marketPrice(3), parBalance(4), principalBalance(5), unfundedAmount(6), securityLevel(7), maturityDate(8)
- Asset type detection by checking column headers rather than hardcoded page numbers
- Row dedup by (obligorName, securityId)
- Returns: `AssetSchedule`

**`parseConcentrationFromTests(parsedTests)`**
- No new table extraction — filters from already-parsed compliance tests
- Keywords: "credit exposure", "concentration", "industry", "country", "rating"
- Returns: `Concentration`

### 4. `web/lib/clo/extraction/audit-logger.ts`

Per-section extraction audit trail:

```typescript
interface ExtractionAuditEntry {
  sectionType: string;
  method: 'table' | 'claude' | 'table+claude_fallback';
  pagesScanned: string;
  recordsExtracted: number;
  fieldsPerRecord: number;
  qualityScore: number;
  nullFieldRatio: number;
  typeErrors: string[];
  rawSamples: Record<string, unknown>[];  // first 2-3 records
  dataQualityNotes: string[];
  durationMs: number;
}

interface ExtractionAuditLog {
  extractionDateTime: string;
  documentType: 'compliance_report' | 'ppm';
  pdfPages: number;
  entries: ExtractionAuditEntry[];
  crossValidation?: CrossValidationResult;
}
```

### 5. `web/lib/clo/extraction/date-reconciler.ts`

Post-extraction reconciliation of dates from PPM and compliance sources.

**Authority rules**:

| Date Field | Authority | Reason |
|-----------|-----------|--------|
| closing_date | Compliance (if available) | Clean labeled field on page 3 |
| effective_date | Compliance | PPM uses "effective date" in other contexts |
| currentIssueDate | PPM only | Compliance report may predate refinancing |
| reinvestment_period_end | **PPM** | Compliance may have pre-refinancing date |
| non_call_period_end | PPM only | Not in compliance as labeled field |
| stated_maturity_date | **PPM** | Compliance may have pre-refinancing maturity |
| wal_test_date | N/A | Recurring test, not a single date |
| report_date | Compliance only | Current reporting period |
| payment_date | Compliance only | Current period payment date |
| firstPaymentDate | PPM only | Historical |
| paymentFrequency | PPM primary, compliance fallback | Both have it |

**Refinancing detection**: If `currentIssueDate` exists and differs from `closing_date` by > 6 months, flag deal as refinanced. When refinanced, PPM is authoritative for all deal-level dates.

**Conflict logging**: When PPM and compliance disagree on a date, log both values and the resolution with reason.

## Modified Files

### `web/lib/clo/extraction/section-extractor.ts`

`extractSection()` gains a table-first path:

```typescript
// Pseudocode
async function extractSection(apiKey, sectionText, documentType) {
  if (documentType === 'compliance_report') {
    const tableResult = await tryTableExtraction(sectionText);
    if (tableResult && tableResult.quality >= 0.7) {
      auditLog.add({ method: 'table', quality: tableResult.quality, ... });
      return tableResult;
    }
    // Fall through to Claude
    auditLog.add({ method: 'table+claude_fallback', quality: tableResult?.quality ?? 0, ... });
  }
  // Existing Claude extraction path
  return existingClaudeExtraction(apiKey, sectionText, documentType);
}
```

### `web/lib/clo/extraction/runner.ts`

After compliance extraction completes, call date reconciler if PPM data is also available.

## Quality Scoring

Each parser returns a quality score (0.0 - 1.0):
- `recordCount > 0` → +0.3
- `nullFieldRatio < 0.3` → +0.3
- `typeErrors.length === 0` → +0.2
- Expected record count range met → +0.2

**Threshold**: `quality >= 0.7` → use table data. Below → Claude fallback.

## Sections: Table vs Claude

| Section | Primary Method | Fallback | Rationale |
|---------|---------------|----------|-----------|
| compliance_summary | Table | Claude | Tranche table + Deal Summary are clean tables |
| par_value_tests | Table | Claude | Structured test tables pages 3-8 |
| interest_coverage_tests | Table | Claude | Same structured format as OC tests |
| asset_schedule | Table | Claude | Holdings tables pages 10-28, well-structured |
| concentration_tables | Derived from tests | Claude | No re-extraction needed (cowork Pass 3 approach) |
| waterfall | Claude only | — | Narrative + mixed format, tables unreliable |
| trading_activity | Claude only | — | Inconsistent column alignment per cowork Pass 4 |
| interest_accrual | Claude only | — | Variable table formats |
| account_balances | Claude only | — | Small tables, not worth custom parser |
| supplementary | Claude only | — | Variable formats, cowork Pass 5 had garbage |

## Key Insights from Cowork Analysis

1. **Compliance page 3 is a goldmine** — Deal Summary table has most deal-level dates and is highly structured
2. **extract_tables() beats text+Claude for tabular data** — 88 tests, 461 holdings extracted with zero hallucination
3. **Concentrations should be derived from tests, not re-extracted** — cowork's Pass 3 approach
4. **Trades and supplementary data need LLM** — cowork's regex approach produced garbage for these
5. **Refinanced deals have conflicting dates** — PPM (post-refi) and compliance (pre-refi) will disagree on maturity, reinvestment period
6. **Column positions vary by trustee format** — validate headers rather than hardcode positions
