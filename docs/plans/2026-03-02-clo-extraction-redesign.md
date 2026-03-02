# CLO Data Extraction & Display Redesign — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Restructure the post-extraction review screen to show only CLO-manager-relevant data, improve PPM extraction for capital structure / trading constraints / portfolio management terms, and add cross-referencing between PPM test definitions and compliance report actuals.

**Architecture:** Three-layer change — (1) Add new fields to the ExtractedConstraints type and update extraction prompt schema, (2) Refine PPM extraction prompts across all 3 passes to better extract capital structure, trading constraints, and portfolio management sections, (3) Rewrite the review step UI in QuestionnaireForm.tsx from 6 catch-all sections to 5 focused sections with unified test tables and a collapsed "Additional Context" section. Cross-referencing is a new utility that matches PPM test definitions to compliance report actuals.

**Tech Stack:** TypeScript, React (Next.js), Anthropic Claude API (extraction), Zod (schema validation)

---

## Task 1: Add New Fields to ExtractedConstraints Type

**Files:**
- Modify: `web/lib/clo/types.ts:151-237` (ExtractedConstraints interface)

**Step 1: Add 3 new fields to the ExtractedConstraints interface**

After line 200 (cmTradingConstraints), before line 201 (refinancingHistory), add:

```typescript
  // Section 24b: Management of Portfolio
  managementOfPortfolio?: string;
  // Section 24c: Terms and Conditions of Sales
  termsAndConditionsOfSales?: string;
  // Section 24d: Trading Restrictions by Test Breach
  tradingRestrictionsByTestBreach?: { testName: string; consequence: string }[];
```

These are all optional fields since not every PPM will have them.

**Step 2: Verify build passes**

Run: `cd web && npx tsc --noEmit 2>&1 | head -20`
Expected: No new errors (existing errors may exist but no new ones from this change)

**Step 3: Commit**

```bash
git add web/lib/clo/types.ts
git commit -m "feat(clo): add managementOfPortfolio, termsAndConditionsOfSales, tradingRestrictionsByTestBreach to ExtractedConstraints"
```

---

## Task 2: Update PPM Extraction Prompt — Pass 1 (Capital Structure & Trading Constraints)

**Files:**
- Modify: `web/worker/clo-prompts.ts` — `ppmExtractionPrompt()` function (lines ~500-620)

**Step 1: Strengthen capital structure extraction instructions**

In the Pass 1 system prompt, find the `capitalStructure` section of the JSON schema template and add emphasis. After the capitalStructure schema definition, add these instructions:

```
CAPITAL STRUCTURE EXTRACTION — CRITICAL:
- The capital structure table is typically found in the FIRST 5-10 pages of the PPM, often in a summary or term sheet section.
- You MUST extract ALL tranches/classes — from the most senior (Class A / AAA) through the equity/subordinated notes.
- Do NOT focus only on the tranche being described in the main body text. Find the summary table that lists ALL classes.
- Include: class name, designation, principal amount, rate type (fixed/floating), reference rate, spread in bps, ratings from ALL agencies (Fitch, S&P, Moody's if available), deferability, issue price, maturity.
- If the PPM only describes one tranche in detail but references others, still extract all tranches from the summary table.
```

**Step 2: Add new fields to the JSON schema template in the prompt**

Add these 3 new fields to the schema template in the system prompt:

```
"managementOfPortfolio": "Full text of the Management of the Portfolio section — PM authority, permitted activities, restrictions on trading, discretionary powers, investment guidelines",
"termsAndConditionsOfSales": "Full text of Terms and Conditions of Sales section — sale requirements, conditions precedent, notice periods, pricing requirements",
"tradingRestrictionsByTestBreach": [{ "testName": "OC Test Class A", "consequence": "If failed, interest proceeds diverted to pay down senior notes until cured" }]
```

**Step 3: Add trading constraint extraction emphasis**

After the cmTradingConstraints section, add:

```
CM TRADING CONSTRAINTS — CRITICAL:
- Extract the LINK between test breaches and trading restrictions. For example: "If the CCC/Caa bucket exceeds 7.5% of the portfolio, the PM cannot purchase additional CCC-rated assets."
- Extract concentration-based trading limits: single obligor limits, industry limits, country limits, and what happens when they are breached.
- For tradingRestrictionsByTestBreach, map EACH compliance test to its consequence when breached (e.g., OC test failure → proceeds diversion, CCC excess → purchase restriction).
```

**Step 4: Verify build passes**

Run: `cd web && npx tsc --noEmit 2>&1 | head -20`

**Step 5: Commit**

```bash
git add web/worker/clo-prompts.ts
git commit -m "feat(clo): strengthen Pass 1 PPM extraction for capital structure, trading constraints, and new fields"
```

---

## Task 3: Update PPM Extraction Prompt — Pass 2 (Management of Portfolio + Terms of Sales)

**Files:**
- Modify: `web/worker/clo-prompts.ts` — `ppmDeepDiveEligibilityPrompt()` function (lines ~622-661)

**Step 1: Add Management of Portfolio and Terms of Sales to Pass 2**

In the Pass 2 system prompt, add these new fields to the JSON return schema:

```
"managementOfPortfolio": "ONLY if first pass missed or under-captured the Management of the Portfolio section. Extract the FULL section including: PM authority and scope, permitted activities, investment guidelines, restrictions, discretionary powers.",
"termsAndConditionsOfSales": "ONLY if first pass missed or under-captured. Extract: sale conditions, requirements for discretionary/credit-risk/credit-improved sales, notice periods, pricing requirements, permitted sale types."
```

Add to the WHERE TO LOOK section:

```
- **Management of the Portfolio** — usually a dedicated section (often Chapter/Article titled "Management of the Collateral" or "The Portfolio Manager" or "Collateral Management"). Contains PM authority, trading guidelines, investment restrictions.
- **Terms and Conditions of Sales** — often near the trading/sales sections. Describes conditions under which the PM can sell assets, including discretionary sales, credit-risk sales, credit-improved sales.
```

**Step 2: Verify build passes**

Run: `cd web && npx tsc --noEmit 2>&1 | head -20`

**Step 3: Commit**

```bash
git add web/worker/clo-prompts.ts
git commit -m "feat(clo): add Management of Portfolio and Terms of Sales extraction to Pass 2"
```

---

## Task 4: Update PPM Extraction Prompt — Pass 3 (Test Breach → Trading Restrictions)

**Files:**
- Modify: `web/worker/clo-prompts.ts` — `ppmDeepDiveStructuralPrompt()` function (lines ~663-711)

**Step 1: Add tradingRestrictionsByTestBreach to Pass 3**

In the Pass 3 system prompt, add this new field to the JSON return schema:

```
"tradingRestrictionsByTestBreach": [{ "testName": "...", "consequence": "..." }],
```

Add to the WHERE TO LOOK section:

```
- **Test breach consequences** — scattered throughout the PPM, often in waterfall descriptions, coverage test sections, and portfolio management sections. Map each test (OC par, OC MV, IC, WARF, WAL, WAS, Diversity, CCC bucket, etc.) to what happens when it fails. Common consequences: proceeds diversion, purchase restrictions, mandatory redemption, acceleration triggers. Also check for tiered consequences (e.g., "minor breach" vs "major breach").
```

**Step 2: Verify build passes**

Run: `cd web && npx tsc --noEmit 2>&1 | head -20`

**Step 3: Commit**

```bash
git add web/worker/clo-prompts.ts
git commit -m "feat(clo): add test-breach trading restriction mapping to Pass 3"
```

---

## Task 5: Update Extraction Schema Validation

**Files:**
- Modify: `web/lib/clo/extraction/schemas.ts` — `extractedConstraintsSchema`

**Step 1: Find the extractedConstraintsSchema and add the 3 new fields**

Add these Zod fields to the schema (matching the new type fields):

```typescript
managementOfPortfolio: z.string().optional(),
termsAndConditionsOfSales: z.string().optional(),
tradingRestrictionsByTestBreach: z.array(z.object({
  testName: z.string(),
  consequence: z.string(),
})).optional(),
```

**Step 2: Verify build passes**

Run: `cd web && npx tsc --noEmit 2>&1 | head -20`

**Step 3: Commit**

```bash
git add web/lib/clo/extraction/schemas.ts
git commit -m "feat(clo): add new fields to extraction schema validation"
```

---

## Task 6: Create Cross-Reference Utility

**Files:**
- Create: `web/lib/clo/cross-reference.ts`

**Step 1: Write the cross-reference utility**

This function takes PPM extracted constraints and compliance report data (if available) and returns a unified test view.

```typescript
import type { ExtractedConstraints, CloComplianceTest, CloPoolSummary } from "./types";

export interface UnifiedTestRow {
  testName: string;
  testClass?: string;
  ppmTrigger?: string;
  actualValue?: number | null;
  isPassing?: boolean | null;
  source: "coverage" | "quality" | "profile";
}

export function crossReferenceTests(
  constraints: ExtractedConstraints,
  complianceTests?: CloComplianceTest[],
  poolSummary?: CloPoolSummary | null,
): { coverageTests: UnifiedTestRow[]; qualityAndProfileTests: UnifiedTestRow[] } {
  const coverageTests: UnifiedTestRow[] = [];
  const qualityAndProfileTests: UnifiedTestRow[] = [];

  // 1. Coverage tests: match PPM coverageTestEntries to compliance OC/IC tests
  if (constraints.coverageTestEntries) {
    for (const entry of constraints.coverageTestEntries) {
      if (entry.parValueRatio) {
        const match = complianceTests?.find(
          (t) => t.testType === "OC_PAR" && normalizeClass(t.testClass) === normalizeClass(entry.class)
        );
        coverageTests.push({
          testName: `OC Par Value (${entry.class})`,
          testClass: entry.class,
          ppmTrigger: entry.parValueRatio,
          actualValue: match?.actualValue,
          isPassing: match?.isPassing,
          source: "coverage",
        });
      }
      if (entry.interestCoverageRatio) {
        const match = complianceTests?.find(
          (t) => t.testType === "IC" && normalizeClass(t.testClass) === normalizeClass(entry.class)
        );
        coverageTests.push({
          testName: `IC Ratio (${entry.class})`,
          testClass: entry.class,
          ppmTrigger: entry.interestCoverageRatio,
          actualValue: match?.actualValue,
          isPassing: match?.isPassing,
          source: "coverage",
        });
      }
    }
  }

  // 2. Collateral quality tests: match by test name
  if (constraints.collateralQualityTests) {
    for (const test of constraints.collateralQualityTests) {
      const match = complianceTests?.find(
        (t) => fuzzyMatchTestName(t.testName, test.name)
      );
      qualityAndProfileTests.push({
        testName: test.name,
        ppmTrigger: String(test.value ?? ""),
        actualValue: match?.actualValue,
        isPassing: match?.isPassing,
        source: "quality",
      });
    }
  }

  // 3. Portfolio profile tests: match by test name to compliance tests or pool summary fields
  if (constraints.portfolioProfileTests) {
    for (const [name, limits] of Object.entries(constraints.portfolioProfileTests)) {
      const match = complianceTests?.find(
        (t) => fuzzyMatchTestName(t.testName, name)
      );
      const trigger = limits.min && limits.max
        ? `${limits.min} – ${limits.max}`
        : limits.min || limits.max || "";
      qualityAndProfileTests.push({
        testName: name,
        ppmTrigger: trigger,
        actualValue: match?.actualValue ?? getPoolSummaryValue(poolSummary, name),
        isPassing: match?.isPassing,
        source: "profile",
      });
    }
  }

  return { coverageTests, qualityAndProfileTests };
}

function normalizeClass(cls?: string | null): string {
  return (cls || "").replace(/\s+/g, "").replace(/class/i, "").toUpperCase();
}

function fuzzyMatchTestName(a: string, b: string): boolean {
  const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  return normalize(a).includes(normalize(b)) || normalize(b).includes(normalize(a));
}

function getPoolSummaryValue(pool: CloPoolSummary | null | undefined, testName: string): number | null {
  if (!pool) return null;
  const key = testName.toLowerCase();
  if (key.includes("warf")) return pool.warf;
  if (key.includes("wal")) return pool.walYears;
  if (key.includes("was") || key.includes("spread")) return pool.wacSpread;
  if (key.includes("diversity")) return pool.diversityScore;
  if (key.includes("ccc")) return pool.pctCccAndBelow;
  if (key.includes("fixed")) return pool.pctFixedRate;
  if (key.includes("second lien")) return pool.pctSecondLien;
  if (key.includes("cov-lite") || key.includes("cov lite")) return pool.pctCovLite;
  if (key.includes("default")) return pool.pctDefaulted;
  return null;
}
```

**Step 2: Verify build passes**

Run: `cd web && npx tsc --noEmit 2>&1 | head -20`

**Step 3: Commit**

```bash
git add web/lib/clo/cross-reference.ts
git commit -m "feat(clo): add cross-reference utility for PPM tests vs compliance actuals"
```

---

## Task 7: Rewrite Review Step UI — Header + Capital Structure

**Files:**
- Modify: `web/components/clo/QuestionnaireForm.tsx:359-963` (replace all 6 render functions)

**Step 1: Replace renderDealOverview() with renderHeader() and renderCapitalStructure()**

Replace the `renderDealOverview()` function (lines 359-453) with two new functions:

`renderHeader()` — Shows deal name, CM, issuer on one line + key dates on second line. Compact, always visible (not collapsible).

`renderCapitalStructure()` — Shows full capital structure table in a CollapsibleSection (defaultOpen). Table columns: Class | Designation | Principal Amount | Rate Type | Spread (bps) | Fitch | S&P | Deferrable. Below the table, show deal sizing (Target Par | Total Rated Notes | Equity %).

**Step 2: Verify the component renders correctly**

Run: `cd web && npx tsc --noEmit 2>&1 | head -20`

**Step 3: Commit**

```bash
git add web/components/clo/QuestionnaireForm.tsx
git commit -m "feat(clo): add header bar and capital structure section to review screen"
```

---

## Task 8: Rewrite Review Step UI — Unified Test Tables

**Files:**
- Modify: `web/components/clo/QuestionnaireForm.tsx`

**Step 1: Replace renderTestsAndConstraints() with renderComplianceTests() and renderProfileTests()**

`renderComplianceTests()` — Coverage tests section. Uses cross-reference utility data if compliance report actuals are available. Table: Test Name | Class | PPM Trigger | Actual Value | Pass/Fail. If no compliance data, just: Test Name | Class | Trigger Level.

`renderProfileTests()` — Portfolio profile + collateral quality tests merged. Table: Test Name | Min Limit | Max Limit | Actual Value | Pass/Fail. Merges `portfolioProfileTests` and `collateralQualityTests` into one table.

Note: The component needs to call `crossReferenceTests()` and use the result. Import the utility and call it with the available data. For the review step, compliance data may not be available yet (depends on whether both docs were uploaded). Handle both cases.

**Step 2: Verify build passes**

Run: `cd web && npx tsc --noEmit 2>&1 | head -20`

**Step 3: Commit**

```bash
git add web/components/clo/QuestionnaireForm.tsx
git commit -m "feat(clo): add unified compliance and profile test tables to review screen"
```

---

## Task 9: Rewrite Review Step UI — Trading Constraints

**Files:**
- Modify: `web/components/clo/QuestionnaireForm.tsx`

**Step 1: Create renderTradingConstraints()**

Shows a CollapsibleSection (defaultOpen) with:
- CM Trading Constraints (discretionarySales, requiredSaleTypes, postReinvestmentTrading) — from `cmTradingConstraints`
- Concentration limits — from `concentrationLimits`
- Trading restrictions by test breach — from `tradingRestrictionsByTestBreach` (new field). Table: Test Name | Consequence When Breached
- Management of Portfolio summary (if short, otherwise moved to Additional Context)

All fields editable.

**Step 2: Verify build passes**

Run: `cd web && npx tsc --noEmit 2>&1 | head -20`

**Step 3: Commit**

```bash
git add web/components/clo/QuestionnaireForm.tsx
git commit -m "feat(clo): add trading constraints section to review screen"
```

---

## Task 10: Rewrite Review Step UI — Additional Context (Collapsed)

**Files:**
- Modify: `web/components/clo/QuestionnaireForm.tsx`

**Step 1: Create renderAdditionalContext()**

Replaces `renderStructureAndMechanics()`, `renderPartiesAndManagement()`, `renderRegulatoryAndLegal()`, and `renderHistoryAndOther()` with a single collapsed section.

CollapsibleSection with `defaultOpen={false}` titled "Additional Document Context". Contains all the remaining data organized into sub-sections:
- Eligibility Criteria (editable textarea)
- Management of Portfolio (editable textarea, full text)
- Terms and Conditions of Sales (editable textarea)
- Waterfall (interest/principal priority text)
- Fees, Accounts, Key Parties
- Hedging, Redemption, Events of Default
- Voting & Control, Interest Mechanics
- ESG Exclusions, Risk Retention, Tax
- All other remaining fields (refinancing history, additional issuance, risk factors, conflicts, legal protections, additional provisions)

Each sub-section should check for data existence before rendering (same pattern as existing code).

**Step 2: Delete the old render functions**

Remove: `renderStructureAndMechanics()`, `renderPartiesAndManagement()`, `renderRegulatoryAndLegal()`, `renderHistoryAndOther()`. Also remove the old `renderTestsAndConstraints()` and `renderDealOverview()` that were replaced in Tasks 7-8.

**Step 3: Update the step === 1 render block**

Replace the current render block (lines 1043-1060) with:

```tsx
{step === 1 && (
  <div className="ic-field">
    <label className="ic-field-label">Review Extracted Constraints</label>
    <p style={{ fontSize: "0.85rem", color: "var(--color-text-secondary)", marginBottom: "1rem" }}>
      These constraints were extracted from your documents. Edit any values the AI got wrong.
    </p>
    {renderHeader()}
    <div style={{ display: "grid", gap: "0.5rem" }}>
      {renderCapitalStructure()}
      {renderComplianceTests()}
      {renderProfileTests()}
      {renderTradingConstraints()}
      {renderAdditionalContext()}
    </div>
  </div>
)}
```

**Step 4: Verify build passes**

Run: `cd web && npx tsc --noEmit 2>&1 | head -20`

**Step 5: Commit**

```bash
git add web/components/clo/QuestionnaireForm.tsx
git commit -m "feat(clo): replace 6 catch-all sections with focused 5-section review layout"
```

---

## Task 11: Wire Up Compliance Data for Cross-Referencing

**Files:**
- Modify: `web/components/clo/QuestionnaireForm.tsx`
- Modify: `web/app/api/clo/profile/extract/route.ts` (GET endpoint)

**Step 1: Pass compliance test data to the review screen**

The QuestionnaireForm needs access to compliance data (if uploaded). Check how the form currently receives data. The compliance extraction stores data in `clo_compliance_tests` and `clo_pool_summary` tables.

When the GET endpoint for extraction status returns `extractedConstraints`, it should also return any available compliance test data if a compliance report was also uploaded and extracted. Add a query to fetch `clo_compliance_tests` and `clo_pool_summary` for the profile's deal (if exists) and include in the response.

**Step 2: Update the QuestionnaireForm state to hold compliance data**

Add optional state for compliance tests and pool summary. Use in the cross-reference calls.

**Step 3: Verify build passes**

Run: `cd web && npx tsc --noEmit 2>&1 | head -20`

**Step 4: Commit**

```bash
git add web/components/clo/QuestionnaireForm.tsx web/app/api/clo/profile/extract/route.ts
git commit -m "feat(clo): wire compliance data into review screen for cross-referencing"
```

---

## Task 12: Manual Integration Test

**Step 1: Start the dev server**

Run: `cd web && npm run dev`

**Step 2: Test with PPM-only upload**

1. Navigate to `/clo/onboarding`
2. Upload a PPM document
3. Wait for extraction to complete
4. Verify the review screen shows:
   - Header with deal name, CM, issuer, key dates
   - Capital structure table with all tranches
   - Coverage tests with PPM triggers only (no actual values)
   - Profile/quality tests with min/max limits only
   - Trading constraints section
   - Collapsed "Additional Document Context" with remaining data

**Step 3: Test with PPM + compliance report upload**

1. Upload both a PPM and a compliance report
2. Verify the review screen shows unified tables with:
   - PPM triggers AND actual values side by side
   - Pass/fail status indicators

**Step 4: Verify editability**

1. Edit a value in any section
2. Proceed to step 3 (Beliefs & Preferences)
3. Verify the form submits successfully

**Step 5: Commit any fixes**

```bash
git add -A && git commit -m "fix(clo): integration test fixes for review screen"
```
