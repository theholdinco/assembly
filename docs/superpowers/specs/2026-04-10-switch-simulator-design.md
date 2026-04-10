# Switch Simulator Tab — Design Spec

## Problem

Two issues with the current switch waterfall analysis:

1. **No assumption controls.** `SwitchWaterfallImpact` uses hardcoded `DEFAULT_ASSUMPTIONS` (all fees at 0, fixed CDR/CPR/recovery). The user sees an IRR delta but can't explore how the switch performs under different rate or default scenarios.

2. **Requires generating a full analysis.** To see the waterfall impact of a switch, the user must create an analysis (wait for AI panel generation, credit memo, debate, etc.). There's no way to quickly ask "what if I sell X and buy Y?"

## Solution

Add a **Switch Simulator** tab to the main waterfall page (`/clo/waterfall/`). It shares the same resolved deal data and assumption state as the Projection tab. The user picks a sell loan from the portfolio, enters a buy loan (from buy list or manually), and instantly sees the before/after delta.

The existing `SwitchWaterfallImpact` on the analysis page should also be updated to accept user assumptions instead of hardcoded defaults, but that's a secondary change.

## Layout

```
/clo/waterfall/
┌──────────────────────────────────────────┐
│  [Projection]  [Switch Simulator]   tabs │
├──────────────────────────────────────────┤
│  IF "Projection" tab:                    │
│    Assumptions sliders                   │
│    Fees & Expenses panel                 │
│    Default Rate panel                    │
│    Results grid, Transparency, charts    │
│                                          │
│  IF "Switch Simulator" tab:              │
│    Sell loan dropdown                    │
│    Buy loan (buy list + manual fields)   │
│    Sell/Buy price inputs                 │
│    ▸ Assumptions (collapsible, collapsed │
│      by default — same state as          │
│      Projection tab)                     │
│    Impact table (before/after/delta)     │
│    OC cushion + equity distribution      │
└──────────────────────────────────────────┘
```

Both tabs share the same underlying assumption state (useState hooks in ProjectionModel). Changing a slider in one tab affects the other. In the Switch tab, assumptions are collapsed by default since the user likely already set them in the Projection tab.

---

## Sell Loan Selection

Dropdown populated from `resolved.loans`. Each option displays:
```
Obligor Name — B / 375 bps — €2.5M par
```

The dropdown items are built from `CloHolding` data (obligor name comes from holdings, spread/rating/par from resolved loans). When selected, the component identifies the matching loan index in the resolved loans array for the switch simulator.

Since holdings can have 100+ loans, the dropdown should be scrollable with a max height.

---

## Buy Loan Input

Two input modes, both visible:

**From buy list** (if buy list data exists): Dropdown of buy list items with the same format as the sell dropdown. Selecting an item pre-fills the manual fields below.

**Manual entry:** Four fields in a grid:
- **Spread** — number input, bps (e.g., 325)
- **Rating** — dropdown: AAA, AA, A, BBB, BB, B, CCC, NR
- **Maturity** — date input
- **Par Amount** — number input, in deal currency

The buy list dropdown pre-fills the manual fields, but the user can override any of them. The manual field values are what's actually used for the simulation.

---

## Transaction Costs

Two number inputs on a single row:
- **Sell Price** — % of par (default 100)
- **Buy Price** — % of par (default 100)

Same as current `SwitchWaterfallImpact`.

---

## Assumptions Panel

The same slider components from the Projection tab (`SliderInput`, `SelectInput`, `FeeAssumptions`, `DefaultRatePanel`), rendered inside a collapsible panel labeled "Assumptions". Collapsed by default.

These components read from and write to the same state variables in `ProjectionModel`. No duplication of state — just rendering the same controls in a different location.

---

## Impact Output

Same structure as current `SwitchWaterfallImpact`:

**Summary table:**
| Metric | Before | After | Delta |
|--------|--------|-------|-------|
| Equity IRR | X% | Y% | delta% |
| Total Equity Distributions | €X | €Y | €delta |
| Spread (swapped position) | X bps | Y bps | delta bps |
| Rating (swapped position) | X | Y | X → Y |
| Par Impact | — | — | €delta |

**Collapsible detail:**
- OC Cushion Changes (Period 1): Class, Before, After, Delta
- Equity Distribution Delta (first 12 quarters): Quarter, Before, After, Delta

---

## Architecture

### Data flow

```
ProjectionModel (parent)
  ├─ assumption state (shared)
  ├─ resolved: ResolvedDealData
  ├─ holdings: CloHolding[]
  ├─ buyList: BuyListItem[] (if available)
  │
  ├─ Tab: Projection
  │   └─ Uses inputs, result, sensitivity (existing)
  │
  └─ Tab: Switch Simulator
      ├─ sellLoanIndex (local state)
      ├─ buyLoan fields (local state)
      ├─ sellPrice, buyPrice (local state)
      └─ Calls applySwitch(resolved, switchParams, userAssumptions)
          └─ userAssumptions built from shared state (same as Projection tab)
```

### Key change to `applySwitch`

Currently `SwitchWaterfallImpact` calls `applySwitch(resolved, params, DEFAULT_ASSUMPTIONS)`. The Switch Simulator tab will call `applySwitch(resolved, params, userAssumptions)` where `userAssumptions` is built from the shared slider state — the same object that `buildFromResolved` uses for the Projection tab.

### Files to modify

| File | Change |
|------|--------|
| `web/app/clo/waterfall/ProjectionModel.tsx` | Add tab state, render tab bar, conditionally render Projection vs Switch content, pass assumptions to switch |
| `web/app/clo/waterfall/SwitchSimulator.tsx` | **New file** — the Switch Simulator tab content (loan selection, price inputs, impact display) |
| `web/app/clo/waterfall/page.tsx` | Pass `holdings` and `buyList` data to ProjectionModel (needed for loan dropdowns) |
| `web/components/clo/SwitchWaterfallImpact.tsx` | Update to accept `assumptions` prop instead of hardcoding `DEFAULT_ASSUMPTIONS` |

### Files NOT changed

- `web/lib/clo/switch-simulator.ts` — `applySwitch()` already accepts `UserAssumptions`, no changes needed
- `web/lib/clo/projection.ts` — engine unchanged
- `web/lib/clo/build-projection-inputs.ts` — already has the right interface

---

## Non-goals

- Not replacing the analysis waterfall tab — that stays for AI-generated analyses
- Not adding Monte Carlo to the switch simulator
- Not adding a sensitivity analysis to the switch (could be future work)
- Not changing the switch-simulator.ts engine logic
