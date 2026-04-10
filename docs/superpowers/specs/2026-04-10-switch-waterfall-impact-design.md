# Loan Switch Waterfall Impact — Design Spec

**Date:** 2026-04-10
**Status:** Draft
**Goal:** Add waterfall impact analysis to the existing CLO switch analysis, showing how swapping one loan for another affects equity IRR, OC cushions, and return distribution.

---

## Architecture

A loan switch modifies the portfolio loan array and re-runs the projection. The existing waterfall engine and Monte Carlo are reused without changes — only the input loans change.

```
Switch Analysis Page (new "Waterfall" tab)
  ├── Load deal data (holdings, tranches, snapshots, constraints)
  ├── Resolve base case via resolveWaterfallInputs()
  ├── Build switched case via applySwitch() → modified ResolvedDealData
  ├── Run deterministic projection on both
  ├── Run Monte Carlo on both (sequential, via Web Worker)
  └── Render delta summary + expandable detail
```

## 1. Switch Simulator

**File:** `web/lib/clo/switch-simulator.ts`

Pure function, no side effects.

```typescript
interface SwitchParams {
  sellLoanIndex: number;       // index into resolved.loans
  buyLoan: {
    parBalance: number;
    maturityDate: string;
    ratingBucket: string;
    spreadBps: number;
  };
  sellPrice: number;           // e.g. 98 (percent of par)
  buyPrice: number;            // e.g. 101
}

interface SwitchResult {
  baseInputs: ProjectionInputs;
  switchedInputs: ProjectionInputs;
  parDelta: number;            // cash impact from price differential
  spreadDelta: number;         // bps change on swapped position
  ratingChange: { from: string; to: string };
}

function applySwitch(
  resolved: ResolvedDealData,
  params: SwitchParams,
  userAssumptions: UserAssumptions,
): SwitchResult
```

Logic:
1. Build `baseInputs` from resolved (reuse `buildFromResolved`)
2. Clone `resolved.loans`, remove `sellLoanIndex`, add `buyLoan`
3. Adjust `resolved.poolSummary.totalPar` by the par delta from price impact
4. Build `switchedInputs` from modified resolved
5. Return both inputs + metadata

## 2. New Tab: Waterfall Impact

**File:** `web/app/clo/analyze/[id]/(tabs)/waterfall/page.tsx`

Server component that:
1. Loads the analysis record (sell/buy loan data)
2. Loads deal data: holdings, tranches, snapshots, pool summary, compliance tests, constraints
3. Resolves base case
4. Passes everything to a client component `SwitchWaterfallImpact`

**File:** `web/components/clo/SwitchWaterfallImpact.tsx`

Client component that:
1. Matches the sell loan to a holding in the portfolio (by obligor name)
2. Maps the buy loan fields to a `ResolvedLoan`
3. Shows transaction cost inputs (sell price, buy price, buy par — pre-filled, editable)
4. Calls `applySwitch()` to get before/after inputs
5. Runs both projections deterministically
6. Runs Monte Carlo on both (sequential web worker calls)
7. Renders delta summary card + expandable detail

## 3. Delta Summary Card

Always visible. Shows:

| Metric | Before | After | Delta |
|---|---|---|---|
| Equity IRR | 6.7% | 7.2% | +0.5% |
| OC Cushion (F) | 3.71% | 3.85% | +0.14% |
| WAC Spread | 376 bps | 380 bps | +4 |
| Rating | B | BB | upgrade |
| Par Impact | — | — | -€45K |
| MC Median IRR | 6.7% | 7.1% | +0.4% |

Color-coded: green for improvements, red for deterioration.

## 4. Expandable Detail

Click to expand:
- **MC Histogram Overlay**: Both IRR distributions on the same chart (base = grey, switched = accent color). Shows how the distribution shifts.
- **OC Cushion Table**: Per-class cushion before/after.
- **Cash Flow Delta**: Quarterly table showing equity distribution difference.

## 5. Tab Integration

Add "Waterfall" to the tab navigation in the layout. Only show for `analysis_type === "switch"`.

## Files

| File | Action |
|---|---|
| `web/lib/clo/switch-simulator.ts` | Create — pure switch logic |
| `web/components/clo/SwitchWaterfallImpact.tsx` | Create — client component with delta UI |
| `web/app/clo/analyze/[id]/(tabs)/waterfall/page.tsx` | Create — server page loading deal data |
| `web/app/clo/analyze/[id]/(tabs)/layout.tsx` | Modify — add Waterfall tab |
| `web/app/clo/waterfall/MonteCarloChart.tsx` | Modify — add overlay mode for two distributions |

## What Doesn't Change

- `projection.ts` — engine unchanged
- `monte-carlo.ts` — MC unchanged
- `resolver.ts` — resolver unchanged
- Existing switch analysis tabs (memo, debate, recommendation) — untouched
