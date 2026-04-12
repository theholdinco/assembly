import { describe, it, expect } from "vitest";
import {
  runProjection,
  addQuarters,
  ProjectionInputs,
  LoanInput,
} from "../projection";
import { RATING_BUCKETS } from "../rating-mapping";
import { CLO_DEFAULTS } from "../defaults";

function uniformRates(cdr: number): Record<string, number> {
  return Object.fromEntries(RATING_BUCKETS.map((b) => [b, cdr]));
}

function makeInputs(overrides: Partial<ProjectionInputs> = {}): ProjectionInputs {
  const currentDate = "2026-01-15";
  const loans: LoanInput[] = Array.from({ length: 10 }, (_, i) => ({
    parBalance: 10_000_000,
    maturityDate: addQuarters(currentDate, 12 + i),
    ratingBucket: "B",
    spreadBps: 400,
  }));

  return {
    initialPar: 100_000_000,
    wacSpreadBps: 400,
    baseRatePct: 3.5,
    baseRateFloorPct: 0,
    seniorFeePct: 0,
    subFeePct: 0,
    trusteeFeeBps: 0,
    hedgeCostBps: 0,
    incentiveFeePct: 0,
    incentiveFeeHurdleIrr: 0,
    postRpReinvestmentPct: 0,
    callDate: null,
    callPricePct: 100,
    reinvestmentOcTrigger: null,
    tranches: [
      { className: "A", currentBalance: 70_000_000, spreadBps: 140, seniorityRank: 1, isFloating: true, isIncomeNote: false, isDeferrable: false },
      { className: "B", currentBalance: 20_000_000, spreadBps: 300, seniorityRank: 2, isFloating: true, isIncomeNote: false, isDeferrable: true },
      { className: "Sub", currentBalance: 10_000_000, spreadBps: 0, seniorityRank: 3, isFloating: false, isIncomeNote: true, isDeferrable: false },
    ],
    ocTriggers: [],
    icTriggers: [],
    reinvestmentPeriodEnd: addQuarters(currentDate, 8),
    maturityDate: addQuarters(currentDate, 32),
    currentDate,
    loans,
    defaultRatesByRating: uniformRates(2),
    cprPct: 0,
    recoveryPct: CLO_DEFAULTS.recoveryPct,
    recoveryLagMonths: CLO_DEFAULTS.recoveryLagMonths,
    reinvestmentSpreadBps: CLO_DEFAULTS.reinvestmentSpreadBps,
    reinvestmentTenorQuarters: CLO_DEFAULTS.reinvestmentTenorYears * 4,
    reinvestmentRating: null,
    cccBucketLimitPct: CLO_DEFAULTS.cccBucketLimitPct,
    cccMarketValuePct: CLO_DEFAULTS.cccMarketValuePct,
    deferredInterestCompounds: true,
    ...overrides,
  };
}

// ─── Task 1: OC cure RP behavior — document modeling convention ─────────────

describe("OC cure RP convention: buy collateral (not paydown)", () => {
  it("MODELING CONVENTION: OC-only cure during RP increases par (buys collateral), does not pay down notes", () => {
    const triggerInputs = makeInputs({
      reinvestmentPeriodEnd: addQuarters("2026-01-15", 20),
      defaultRatesByRating: uniformRates(8),
      cprPct: 0,
      recoveryPct: 0,
      ocTriggers: [{ className: "B", triggerLevel: 130, rank: 2 }],
      icTriggers: [],
    });

    const noTriggerInputs = makeInputs({
      reinvestmentPeriodEnd: addQuarters("2026-01-15", 20),
      defaultRatesByRating: uniformRates(8),
      cprPct: 0,
      recoveryPct: 0,
      ocTriggers: [],
      icTriggers: [],
    });

    const result = runProjection(triggerInputs);
    const baseline = runProjection(noTriggerInputs);

    const failPeriod = result.periods.find((p) =>
      p.ocTests.some((t) => t.className === "B" && !t.passing)
    );
    expect(failPeriod).toBeDefined();

    if (failPeriod) {
      const baselinePeriod = baseline.periods.find((p) => p.periodNum === failPeriod.periodNum)!;
      // Cure bought collateral → endingPar is HIGHER than no-trigger baseline
      expect(failPeriod.endingPar).toBeGreaterThan(baselinePeriod.endingPar);
    }
  });

  it("MODELING CONVENTION: OC+IC cure during RP uses paydown (not buy collateral)", () => {
    const bothInputs = makeInputs({
      reinvestmentPeriodEnd: addQuarters("2026-01-15", 20),
      defaultRatesByRating: uniformRates(8),
      cprPct: 0,
      recoveryPct: 0,
      baseRatePct: 0.5,
      ocTriggers: [{ className: "B", triggerLevel: 130, rank: 2 }],
      icTriggers: [{ className: "B", triggerLevel: 999, rank: 2 }],
    });

    const ocOnlyInputs = makeInputs({
      reinvestmentPeriodEnd: addQuarters("2026-01-15", 20),
      defaultRatesByRating: uniformRates(8),
      cprPct: 0,
      recoveryPct: 0,
      baseRatePct: 0.5,
      ocTriggers: [{ className: "B", triggerLevel: 130, rank: 2 }],
      icTriggers: [],
    });

    const bothResult = runProjection(bothInputs);
    const ocOnlyResult = runProjection(ocOnlyInputs);

    // Find a period where both OC and IC fail
    const failPeriod = bothResult.periods.find((p) =>
      p.ocTests.some((t) => !t.passing) && p.icTests.some((t) => !t.passing)
    );
    expect(failPeriod).toBeDefined();

    if (failPeriod) {
      const ocOnlyPeriod = ocOnlyResult.periods.find((p) => p.periodNum === failPeriod.periodNum)!;
      // OC+IC: paydown path → endingPar should NOT be boosted like OC-only (buy collateral)
      expect(failPeriod.endingPar).toBeLessThanOrEqual(ocOnlyPeriod.endingPar + 1);
      // OC+IC: paydown reduces liabilities relative to beginning
      expect(failPeriod.endingLiabilities).toBeLessThan(failPeriod.beginningLiabilities);
    }
  });
});

// ─── Task 2: Three-regime incentive fee ─────────────────────────────────────

describe("Incentive fee three-regime behavior", () => {
  it("Regime 1: pre-fee IRR below hurdle → no fee taken", () => {
    const withFee = runProjection(makeInputs({
      incentiveFeePct: 20,
      incentiveFeeHurdleIrr: 0.99,
      defaultRatesByRating: uniformRates(0),
      cprPct: 0,
      reinvestmentPeriodEnd: "2026-01-01",
      ocTriggers: [],
      icTriggers: [],
    }));

    const noFee = runProjection(makeInputs({
      incentiveFeePct: 0,
      defaultRatesByRating: uniformRates(0),
      cprPct: 0,
      reinvestmentPeriodEnd: "2026-01-01",
      ocTriggers: [],
      icTriggers: [],
    }));

    expect(withFee.totalEquityDistributions).toBeCloseTo(noFee.totalEquityDistributions, 0);
  });

  it("Regime 2: full fee leaves IRR well above hurdle → take full feePct of residual", () => {
    const withFee = runProjection(makeInputs({
      incentiveFeePct: 20,
      incentiveFeeHurdleIrr: 0.001,
      defaultRatesByRating: uniformRates(0),
      cprPct: 0,
      reinvestmentPeriodEnd: "2026-01-01",
      ocTriggers: [],
      icTriggers: [],
    }));

    const noFee = runProjection(makeInputs({
      incentiveFeePct: 0,
      defaultRatesByRating: uniformRates(0),
      cprPct: 0,
      reinvestmentPeriodEnd: "2026-01-01",
      ocTriggers: [],
      icTriggers: [],
    }));

    const ratio = withFee.totalEquityDistributions / noFee.totalEquityDistributions;
    expect(ratio).toBeGreaterThan(0.70);
    expect(ratio).toBeLessThan(0.90);

    expect(withFee.equityIrr).not.toBeNull();
    expect(withFee.equityIrr!).toBeGreaterThan(0.05);
  });

  it("Regime 3: full fee would breach hurdle → bisect to preserve hurdle IRR", () => {
    const noFee = runProjection(makeInputs({
      incentiveFeePct: 0,
      defaultRatesByRating: uniformRates(0),
      cprPct: 10,
      reinvestmentPeriodEnd: "2026-01-01",
      ocTriggers: [],
      icTriggers: [],
    }));

    const preFeeIrr = noFee.equityIrr;
    expect(preFeeIrr).not.toBeNull();

    const hurdle = preFeeIrr! * 0.90;

    const withFee = runProjection(makeInputs({
      incentiveFeePct: 20,
      incentiveFeeHurdleIrr: hurdle,
      defaultRatesByRating: uniformRates(0),
      cprPct: 10,
      reinvestmentPeriodEnd: "2026-01-01",
      ocTriggers: [],
      icTriggers: [],
    }));

    expect(withFee.equityIrr).not.toBeNull();
    expect(withFee.equityIrr!).toBeGreaterThanOrEqual(hurdle - 0.005);

    expect(withFee.totalEquityDistributions).toBeLessThan(noFee.totalEquityDistributions);

    const fullFeeResult = runProjection(makeInputs({
      incentiveFeePct: 20,
      incentiveFeeHurdleIrr: 0.001,
      defaultRatesByRating: uniformRates(0),
      cprPct: 10,
      reinvestmentPeriodEnd: "2026-01-01",
      ocTriggers: [],
      icTriggers: [],
    }));

    expect(withFee.totalEquityDistributions).toBeGreaterThan(fullFeeResult.totalEquityDistributions);
  });
});

// ─── Task 3: Sequential principal paydown order ─────────────────────────────

describe("Principal paydown is sequential (senior-first), not pro-rata", () => {
  it("Class A fully paid before any principal goes to Class B", () => {
    const inputs = makeInputs({
      reinvestmentPeriodEnd: "2026-01-01",
      defaultRatesByRating: uniformRates(0),
      cprPct: 0,
      recoveryPct: 0,
      loans: [
        { parBalance: 40_000_000, maturityDate: addQuarters("2026-01-15", 2), ratingBucket: "B", spreadBps: 400 },
        { parBalance: 60_000_000, maturityDate: addQuarters("2026-01-15", 4), ratingBucket: "B", spreadBps: 400 },
      ],
      tranches: [
        { className: "A", currentBalance: 50_000_000, spreadBps: 140, seniorityRank: 1, isFloating: true, isIncomeNote: false, isDeferrable: false },
        { className: "B", currentBalance: 30_000_000, spreadBps: 300, seniorityRank: 2, isFloating: true, isIncomeNote: false, isDeferrable: true },
        { className: "Sub", currentBalance: 20_000_000, spreadBps: 0, seniorityRank: 3, isFloating: false, isIncomeNote: true, isDeferrable: false },
      ],
      ocTriggers: [],
      icTriggers: [],
    });

    const result = runProjection(inputs);

    const q2 = result.periods.find((p) => p.periodNum === 2)!;
    const aPrinQ2 = q2.tranchePrincipal.find((t) => t.className === "A")!;
    const bPrinQ2 = q2.tranchePrincipal.find((t) => t.className === "B")!;
    expect(aPrinQ2.paid).toBeCloseTo(40_000_000, -3);
    expect(bPrinQ2.paid).toBeCloseTo(0, -1);
    expect(aPrinQ2.endBalance).toBeCloseTo(10_000_000, -3);

    const q4 = result.periods.find((p) => p.periodNum === 4)!;
    const aPrinQ4 = q4.tranchePrincipal.find((t) => t.className === "A")!;
    const bPrinQ4 = q4.tranchePrincipal.find((t) => t.className === "B")!;
    expect(aPrinQ4.endBalance).toBeCloseTo(0, -1);
    expect(bPrinQ4.endBalance).toBeCloseTo(0, -1);
    expect(q4.equityDistribution).toBeGreaterThan(15_000_000);
  });

  it("Class B receives zero principal until Class A is fully retired", () => {
    const inputs = makeInputs({
      reinvestmentPeriodEnd: "2026-01-01",
      defaultRatesByRating: uniformRates(0),
      cprPct: 0,
      recoveryPct: 0,
      loans: Array.from({ length: 8 }, (_, i) => ({
        parBalance: 12_500_000,
        maturityDate: addQuarters("2026-01-15", i + 1),
        ratingBucket: "B",
        spreadBps: 400,
      })),
      tranches: [
        { className: "A", currentBalance: 35_000_000, spreadBps: 140, seniorityRank: 1, isFloating: true, isIncomeNote: false, isDeferrable: false },
        { className: "B", currentBalance: 20_000_000, spreadBps: 300, seniorityRank: 2, isFloating: true, isIncomeNote: false, isDeferrable: true },
        { className: "Sub", currentBalance: 45_000_000, spreadBps: 0, seniorityRank: 3, isFloating: false, isIncomeNote: true, isDeferrable: false },
      ],
      ocTriggers: [],
      icTriggers: [],
    });

    const result = runProjection(inputs);

    for (const p of result.periods) {
      const aEnd = p.tranchePrincipal.find((t) => t.className === "A")!.endBalance;
      const bPaid = p.tranchePrincipal.find((t) => t.className === "B")!.paid;
      if (aEnd > 1_000) {
        expect(bPaid).toBeCloseTo(0, -1);
      }
    }
  });
});

// ─── Task 4: Fee waterfall priority ─────────────────────────────────────────

describe("Fee waterfall priority order", () => {
  it("trustee fee is senior to tranche interest (paid even when interest barely covers fees)", () => {
    const highTrustee = runProjection(makeInputs({
      reinvestmentPeriodEnd: "2026-01-01",
      defaultRatesByRating: uniformRates(0),
      cprPct: 0,
      trusteeFeeBps: 400,
      seniorFeePct: 0,
      hedgeCostBps: 0,
      subFeePct: 0,
      ocTriggers: [],
      icTriggers: [],
    }));

    const noTrustee = runProjection(makeInputs({
      reinvestmentPeriodEnd: "2026-01-01",
      defaultRatesByRating: uniformRates(0),
      cprPct: 0,
      trusteeFeeBps: 0,
      seniorFeePct: 0,
      hedgeCostBps: 0,
      subFeePct: 0,
      ocTriggers: [],
      icTriggers: [],
    }));

    const q1High = highTrustee.periods[0];
    const q1None = noTrustee.periods[0];

    const totalToDebtHigh = q1High.trancheInterest.reduce((s, t) => s + t.paid, 0) + q1High.equityDistribution;
    const totalToDebtNone = q1None.trancheInterest.reduce((s, t) => s + t.paid, 0) + q1None.equityDistribution;

    expect(totalToDebtNone - totalToDebtHigh).toBeCloseTo(1_000_000, -3);
  });

  it("senior fee is deducted before tranche interest calculation (reduces IC numerator)", () => {
    const withFee = runProjection(makeInputs({
      reinvestmentPeriodEnd: "2026-01-01",
      defaultRatesByRating: uniformRates(0),
      cprPct: 0,
      seniorFeePct: 1.0,
      trusteeFeeBps: 0,
      hedgeCostBps: 0,
      icTriggers: [{ className: "A", triggerLevel: 100, rank: 1 }],
      ocTriggers: [],
    }));

    const noFee = runProjection(makeInputs({
      reinvestmentPeriodEnd: "2026-01-01",
      defaultRatesByRating: uniformRates(0),
      cprPct: 0,
      seniorFeePct: 0,
      trusteeFeeBps: 0,
      hedgeCostBps: 0,
      icTriggers: [{ className: "A", triggerLevel: 100, rank: 1 }],
      ocTriggers: [],
    }));

    const icWithFee = withFee.periods[0].icTests[0].actual;
    const icNoFee = noFee.periods[0].icTests[0].actual;

    expect(icWithFee).toBeLessThan(icNoFee);
  });

  it("sub fee is junior to tranche interest (tranches paid first)", () => {
    const result = runProjection(makeInputs({
      reinvestmentPeriodEnd: "2026-01-01",
      defaultRatesByRating: uniformRates(0),
      cprPct: 0,
      seniorFeePct: 0,
      subFeePct: 5.0,
      trusteeFeeBps: 0,
      hedgeCostBps: 0,
      ocTriggers: [],
      icTriggers: [],
    }));

    const noSubFee = runProjection(makeInputs({
      reinvestmentPeriodEnd: "2026-01-01",
      defaultRatesByRating: uniformRates(0),
      cprPct: 0,
      seniorFeePct: 0,
      subFeePct: 0,
      trusteeFeeBps: 0,
      hedgeCostBps: 0,
      ocTriggers: [],
      icTriggers: [],
    }));

    // All tranche interest should be identical with/without sub fee
    for (const className of ["A", "B"]) {
      const withSubFee = result.periods[0].trancheInterest.find((t) => t.className === className)!;
      const withoutSubFee = noSubFee.periods[0].trancheInterest.find((t) => t.className === className)!;
      expect(withSubFee.paid).toBeCloseTo(withoutSubFee.paid, 0);
    }

    // Sub fee reduces equity only
    expect(result.periods[0].equityDistribution).toBeLessThan(
      noSubFee.periods[0].equityDistribution
    );
  });
});

// ─── Task 5: Composite OC numerator ─────────────────────────────────────────

describe("OC numerator combines all components correctly", () => {
  it("OC numerator = performingPar - cccHaircut (with pending recoveries, principal cash, and CCC all active)", () => {
    const inputs = makeInputs({
      reinvestmentPeriodEnd: "2026-01-01",
      defaultRatesByRating: { ...uniformRates(0), CCC: 10 },
      cprPct: 0,
      recoveryPct: 60,
      recoveryLagMonths: 12,
      cccBucketLimitPct: 7.5,
      cccMarketValuePct: 70,
      loans: [
        { parBalance: 30_000_000, maturityDate: addQuarters("2026-01-15", 20), ratingBucket: "CCC", spreadBps: 650 },
        { parBalance: 50_000_000, maturityDate: addQuarters("2026-01-15", 20), ratingBucket: "B", spreadBps: 400 },
        { parBalance: 20_000_000, maturityDate: addQuarters("2026-01-15", 3), ratingBucket: "B", spreadBps: 400 },
      ],
      tranches: [
        { className: "A", currentBalance: 60_000_000, spreadBps: 140, seniorityRank: 1, isFloating: true, isIncomeNote: false, isDeferrable: false },
        { className: "B", currentBalance: 20_000_000, spreadBps: 300, seniorityRank: 2, isFloating: true, isIncomeNote: false, isDeferrable: true },
        { className: "Sub", currentBalance: 20_000_000, spreadBps: 0, seniorityRank: 3, isFloating: false, isIncomeNote: true, isDeferrable: false },
      ],
      ocTriggers: [
        { className: "A", triggerLevel: 110, rank: 1 },
        { className: "B", triggerLevel: 105, rank: 2 },
      ],
      icTriggers: [],
    });

    const result = runProjection(inputs);

    for (const p of result.periods.slice(0, 8)) {
      for (const oc of p.ocTests) {
        expect(isFinite(oc.actual)).toBe(true);
        expect(oc.actual).toBeGreaterThanOrEqual(0);
      }
    }

    const q1 = result.periods[0];
    expect(q1.defaults).toBeGreaterThan(0);
    expect(q1.recoveries).toBe(0);

    const naiveOcA = (q1.endingPar / 60_000_000) * 100;
    const actualOcA = q1.ocTests.find((t) => t.className === "A")!.actual;
    expect(actualOcA).toBeLessThanOrEqual(naiveOcA + 0.1);
  });
});

// ─── Task 6: PIK catch-up priority ──────────────────────────────────────────

describe("PIK catch-up: deferred interest paid when deal recovers", () => {
  it("tranche with accumulated PIK eventually gets repaid when OC cures", () => {
    const inputs = makeInputs({
      reinvestmentPeriodEnd: "2026-01-01",
      defaultRatesByRating: uniformRates(5),
      cprPct: 20,
      recoveryPct: 0,
      deferredInterestCompounds: true,
      tranches: [
        { className: "A", currentBalance: 50_000_000, spreadBps: 140, seniorityRank: 1, isFloating: true, isIncomeNote: false, isDeferrable: false },
        { className: "B", currentBalance: 20_000_000, spreadBps: 300, seniorityRank: 2, isFloating: true, isIncomeNote: false, isDeferrable: true },
        { className: "Sub", currentBalance: 30_000_000, spreadBps: 0, seniorityRank: 3, isFloating: false, isIncomeNote: true, isDeferrable: false },
      ],
      ocTriggers: [{ className: "A", triggerLevel: 200, rank: 1 }],
      icTriggers: [],
    });

    const result = runProjection(inputs);

    const bBalanceQ2 = result.periods[1]?.tranchePrincipal.find((t) => t.className === "B")!.endBalance;
    expect(bBalanceQ2).toBeGreaterThanOrEqual(20_000_000);

    const totalBPrincipal = result.periods.reduce((s, p) => {
      const bPrin = p.tranchePrincipal.find((t) => t.className === "B");
      return s + (bPrin?.paid ?? 0);
    }, 0);

    expect(totalBPrincipal).toBeGreaterThan(0);
  });

  it("PIK balance is included when tranche is paid off at maturity", () => {
    const inputs = makeInputs({
      reinvestmentPeriodEnd: "2026-01-01",
      maturityDate: addQuarters("2026-01-15", 8),
      defaultRatesByRating: uniformRates(0),
      cprPct: 0,
      recoveryPct: 0,
      deferredInterestCompounds: true,
      tranches: [
        { className: "A", currentBalance: 70_000_000, spreadBps: 140, seniorityRank: 1, isFloating: true, isIncomeNote: false, isDeferrable: false },
        { className: "B", currentBalance: 10_000_000, spreadBps: 300, seniorityRank: 2, isFloating: true, isIncomeNote: false, isDeferrable: true },
        { className: "Sub", currentBalance: 20_000_000, spreadBps: 0, seniorityRank: 3, isFloating: false, isIncomeNote: true, isDeferrable: false },
      ],
      ocTriggers: [{ className: "A", triggerLevel: 999, rank: 1 }],
      icTriggers: [],
    });

    const result = runProjection(inputs);

    const totalBPaid = result.periods.reduce((s, p) => {
      return s + (p.tranchePrincipal.find((t) => t.className === "B")?.paid ?? 0);
    }, 0);

    expect(totalBPaid).toBeGreaterThan(10_000_000);
  });
});

// ─── Task 7: OC/IC cure interaction — max not additive ──────────────────────

describe("OC + IC cure uses max (not sum) of cure amounts", () => {
  it("dual failure diverts no more than the worse single-trigger case", () => {
    // OC-only failure
    const ocOnly = runProjection(makeInputs({
      reinvestmentPeriodEnd: "2026-01-01",
      cprPct: 0,
      recoveryPct: 0,
      defaultRatesByRating: uniformRates(15),
      ocTriggers: [{ className: "B", triggerLevel: 150, rank: 2 }],
      icTriggers: [],
    }));

    // IC-only failure
    const icOnly = runProjection(makeInputs({
      reinvestmentPeriodEnd: "2026-01-01",
      cprPct: 0,
      recoveryPct: 0,
      defaultRatesByRating: uniformRates(0),
      baseRatePct: 0.5,
      seniorFeePct: 1.0,
      icTriggers: [{ className: "B", triggerLevel: 300, rank: 2 }],
      ocTriggers: [],
    }));

    // Both fail
    const both = runProjection(makeInputs({
      reinvestmentPeriodEnd: "2026-01-01",
      cprPct: 0,
      recoveryPct: 0,
      defaultRatesByRating: uniformRates(15),
      baseRatePct: 0.5,
      seniorFeePct: 1.0,
      ocTriggers: [{ className: "B", triggerLevel: 150, rank: 2 }],
      icTriggers: [{ className: "B", triggerLevel: 300, rank: 2 }],
    }));

    const ocEquity = ocOnly.periods[0].equityDistribution;
    const icEquity = icOnly.periods[0].equityDistribution;
    const bothEquity = both.periods[0].equityDistribution;

    expect(bothEquity).toBeGreaterThanOrEqual(Math.min(ocEquity, icEquity) - 100);
  });
});

// ─── Task 8: Pending recovery in OC numerator — modeling convention ─────────

describe("Pending recoveries included in OC numerator (modeling convention)", () => {
  it("CONVENTION: OC ratio in Q1 is higher with 60% recovery/12mo lag than with 0% recovery", () => {
    const withRecovery = runProjection(makeInputs({
      reinvestmentPeriodEnd: "2026-01-01",
      defaultRatesByRating: uniformRates(10),
      cprPct: 0,
      recoveryPct: 60,
      recoveryLagMonths: 12,
      ocTriggers: [{ className: "A", triggerLevel: 110, rank: 1 }],
      icTriggers: [],
    }));

    const noRecovery = runProjection(makeInputs({
      reinvestmentPeriodEnd: "2026-01-01",
      defaultRatesByRating: uniformRates(10),
      cprPct: 0,
      recoveryPct: 0,
      recoveryLagMonths: 12,
      ocTriggers: [{ className: "A", triggerLevel: 110, rank: 1 }],
      icTriggers: [],
    }));

    const ocWithRec = withRecovery.periods[0].ocTests[0].actual;
    const ocNoRec = noRecovery.periods[0].ocTests[0].actual;
    expect(ocWithRec).toBeGreaterThan(ocNoRec);

    expect(withRecovery.periods[0].recoveries).toBe(0);
    expect(noRecovery.periods[0].recoveries).toBe(0);
  });
});
