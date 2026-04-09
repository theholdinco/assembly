# Waterfall Transparency Panel — Design Spec

## Problem

When viewing projection results (especially equity IRR), it's hard to understand *why* a number looks wrong. The raw cash flow table has the data but it's 13 columns of quarterly numbers. There's no clear view of: what data went into the model, which assumptions matter most, or how a specific period's waterfall actually flowed.

## Solution

A collapsible **"Transparency"** section on the waterfall page containing three panels: sensitivity analysis, input provenance, and an enhanced cash flow table with expandable per-period waterfall traces.

## Layout

```
Results Grid (IRR card, distributions, periods)
│
▼ Transparency (collapsible, collapsed by default)
  ├─ Sensitivity Analysis (always visible when open)
  ├─ ▶ Model Inputs (sub-collapsible)
  └─ Cash Flow Table (moved from current position)
       └─ Click any row → expands period waterfall trace
```

The existing "How This Model Works" disclosure stays in its current position — it explains methodology, not data.

---

## Panel 1: Sensitivity Analysis

**Position:** First thing visible when Transparency opens.

**What it shows:** A table of the top 5 assumptions, each perturbed ±1 standard increment from the current value, showing the resulting equity IRR delta.

| Column | Content |
|--------|---------|
| Assumption | Name (e.g. "CDR (uniform)") |
| Base | Current value |
| Down scenario | Value - 1 increment |
| Up scenario | Value + 1 increment |
| IRR Impact | Delta vs base IRR, formatted as "-1.8% / +1.6%" |

**Assumptions to test (with increments):**

| Assumption | Increment |
|------------|-----------|
| CDR (uniform) | ±1 percentage point |
| CPR | ±5 percentage points |
| Base Rate | ±1 percentage point |
| Recovery Rate | ±10 percentage points |
| Reinvestment Spread | ±50 bps |

**Computation:** When the base projection runs, also run 10 additional projections (one per assumption per direction). Each changes only one input, holds everything else constant. Extract the equity IRR from each and compute delta vs base.

**Implementation:**
- Pure function `computeSensitivity(baseInputs: ProjectionInputs, baseIrr: number)` in `projection.ts`
- Returns `{ assumption: string; base: string; down: string; up: string; downIrr: number | null; upIrr: number | null }[]`
- Called in a `useMemo` in `ProjectionModel.tsx` that depends on the same inputs as the base projection
- Rows sorted by absolute IRR impact (biggest movers first)
- Color: green for positive delta, red for negative

**Performance:** `runProjection` takes ~15ms. 10 extra runs = ~150ms total. Acceptable for client-side, runs synchronously in useMemo.

---

## Panel 2: Model Inputs (Resolved Data Provenance)

**Position:** Sub-collapsible within Transparency. Collapsed by default.

**Purpose:** Show exactly what data the projection engine is using and where each value came from. Catches extraction errors (e.g. senior fee resolved to 15% instead of 0.15%).

### Sub-section A: Resolved Capital Structure

Table with columns:
- **Class** — tranche name
- **Balance** — current balance, formatted as currency
- **Spread** — in bps (or "Fixed X%" for fixed-rate)
- **Rate Type** — Floating / Fixed
- **Deferrable** — Yes / No
- **Source** — badge: `snapshot` / `ppm` / `db` / `default`

Sorted by seniority rank. Rows where source is `default` or `ppm` (when DB data exists) get a subtle amber background to flag potential staleness.

### Sub-section B: Fees & Dates

Key-value grid layout (2-3 columns):

**Fees:**
- Senior Mgmt Fee: `{value}` *(source)*
- Sub Mgmt Fee: `{value}` *(source)*
- Trustee/Admin: `{value}` *(source)*
- Incentive Fee: `{value}` *(source)*
- Hedge Cost: `{value}` *(user input)*

**Dates:**
- Maturity: `{date}`
- RP End: `{date}`
- Non-Call End: `{date}`
- Call Date: `{date or "Not set"}`

**Pool:**
- Initial Par: `{value}` *(source)*
- WAC Spread: `{value}` *(source)*
- Loan Count: `{count}`

Values using defaults (not extracted from PPM or compliance) get a warning-style highlight.

### Sub-section C: Resolved Triggers

Two compact tables side by side:
- **OC Triggers:** Class, Trigger Level, Source
- **IC Triggers:** Class, Trigger Level, Source
- **Reinvestment OC:** Trigger level, rank (if present)

### Data source

All data comes from `ResolvedDealData` which is already available as the `resolved` prop in `ProjectionModel`. No new data fetching needed. Source badges come from `ResolvedTranche.source` and similar fields.

---

## Panel 3: Enhanced Cash Flow Table with Period Trace

**Position:** Bottom of Transparency section. Replaces the existing cash flow table (moved, not duplicated).

### Base table

Same as current: Date, Beg Par, Defaults, Prepays, Maturities, Recoveries, Reinvest, End Par, Beg Liab, End Liab, Interest, Equity. Sticky header, scrollable.

### Expandable row (new)

Clicking a row expands it to show the full interest + principal waterfall for that period. Styled as an indented tree with right-aligned monospace amounts:

```
Interest Collected                     €7,325,132
  ├─ Trustee/Admin Fee (2 bps)           -€21,672
  ├─ Senior Mgmt Fee (0.15%)            -€162,540
  ├─ Hedge Costs                              -€0
  │  Available for tranche interest   €7,140,920
  ├─ Class X interest                     -€7,557
  ├─ Class X amort                      -€550,000
  ├─ Class A interest                 -€2,425,404
  ...per tranche...
  │  OC/IC: A/B ✓ 137% | C ✓ 126% | D ✓ 116%
  ├─ Sub Mgmt Fee (0.25%)              -€270,900
  ├─ Incentive Fee                            -€0
  └─ → Equity (from interest)         €2,821,865

Principal Proceeds                     €3,200,000
  ├─ Prepayments / Maturities / Recoveries
  ├─ Reinvested                       -€3,200,000
  └─ → Equity (from principal)                €0

Total Equity Distribution              €2,821,865
```

**Styling:**
- Fees/deductions in red
- Equity residual in green
- OC/IC test results inline: ✓ green for passing, ✗ red for failing
- Diverted amounts (OC/IC cure) in orange
- Monospace numbers, right-aligned
- Tree lines using CSS borders, not ASCII

**Data source:** All values come from `PeriodResult` fields already computed by the projection engine:
- `interestCollected` — top-line interest
- `trancheInterest[].due` / `.paid` — per-tranche interest
- `tranchePrincipal[].paid` — per-tranche principal
- `ocTests[]` / `icTests[]` — test results
- `equityDistribution` — bottom line

Fee amounts (trustee, senior, hedge, sub) are not currently in `PeriodResult`. Two options:
1. **Recompute in the UI** from `beginningPar * feeRate / 4` — simple, no engine changes
2. **Add fee fields to PeriodResult** — more accurate if fee logic gets complex

**Recommendation:** Option 1 (recompute in UI). The fee formulas are trivial (`par * rate / 4`) and match the engine exactly. Avoids changing the engine interface.

---

## Files to Modify

| File | Change |
|------|--------|
| `web/app/clo/waterfall/ProjectionModel.tsx` | Add Transparency section, move cash flow table inside it, add sensitivity table, add model inputs panel |
| `web/lib/clo/projection.ts` | Add `computeSensitivity()` pure function |
| No new component files | Everything fits within ProjectionModel + inline helper components (following existing pattern of SliderInput, SummaryCard, etc.) |

## Non-goals

- No changes to the projection engine output format (`PeriodResult` stays the same)
- No server-side computation — everything is client-side
- No new API endpoints
- No changes to the Context Editor — the input provenance panel reads the same `ResolvedDealData`
- Not modeling additional PPM features (already done in the prior waterfall gap work)
