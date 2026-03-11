import { describe, it, expect } from "vitest";
import {
  validateInputs,
  runProjection,
  calculateIrr,
  ProjectionInputs,
} from "../projection";

function makeInputs(overrides: Partial<ProjectionInputs> = {}): ProjectionInputs {
  return {
    initialPar: 100_000_000,
    wacSpreadBps: 375,
    baseRatePct: 4.5,
    seniorFeePct: 0.45,
    tranches: [
      { className: "A", currentBalance: 65_000_000, spreadBps: 140, seniorityRank: 1, isFloating: true, isIncomeNote: false },
      { className: "B", currentBalance: 15_000_000, spreadBps: 250, seniorityRank: 2, isFloating: true, isIncomeNote: false },
      { className: "Sub", currentBalance: 20_000_000, spreadBps: 0, seniorityRank: 3, isFloating: false, isIncomeNote: true },
    ],
    ocTriggers: [
      { className: "A", triggerLevel: 120, rank: 1 },
      { className: "B", triggerLevel: 110, rank: 2 },
    ],
    icTriggers: [
      { className: "A", triggerLevel: 120, rank: 1 },
      { className: "B", triggerLevel: 110, rank: 2 },
    ],
    reinvestmentPeriodEnd: "2028-06-15",
    maturityDate: "2034-06-15",
    currentDate: "2026-03-09",
    cdrPct: 2,
    cprPct: 15,
    recoveryPct: 60,
    recoveryLagMonths: 12,
    reinvestmentSpreadBps: 350,
    maturitySchedule: [],
    ...overrides,
  };
}

// ─── validateInputs ──────────────────────────────────────────────────────────

describe("validateInputs", () => {
  it("accepts valid inputs", () => {
    const errors = validateInputs(makeInputs());
    expect(errors).toHaveLength(0);
  });

  it("rejects missing tranches", () => {
    const errors = validateInputs(makeInputs({ tranches: [] }));
    expect(errors.some((e) => e.field === "tranches")).toBe(true);
  });

  it("rejects zero initial par", () => {
    const errors = validateInputs(makeInputs({ initialPar: 0 }));
    expect(errors.some((e) => e.field === "initialPar")).toBe(true);
  });

  it("rejects missing maturity date", () => {
    const errors = validateInputs(makeInputs({ maturityDate: null }));
    expect(errors.some((e) => e.field === "maturityDate")).toBe(true);
  });
});

// ─── runProjection baseline (no maturities) ─────────────────────────────────

describe("runProjection baseline (no maturities)", () => {
  it("runs without error and returns periods", () => {
    const result = runProjection(makeInputs());
    expect(result.periods.length).toBeGreaterThan(0);
    expect(result.periods[0].periodNum).toBe(1);
  });

  it("par declines over time due to defaults and prepayments", () => {
    const result = runProjection(makeInputs());
    const first = result.periods[0];
    const last = result.periods[result.periods.length - 1];
    expect(last.endingPar).toBeLessThan(first.beginningPar);
  });

  it("generates equity distributions", () => {
    const result = runProjection(makeInputs());
    expect(result.totalEquityDistributions).toBeGreaterThan(0);
  });

  it("zero CDR and CPR keeps par stable during RP", () => {
    const result = runProjection(makeInputs({ cdrPct: 0, cprPct: 0 }));
    // During the RP, par should remain constant with no defaults or prepays
    const rpPeriods = result.periods.filter(
      (p) => new Date(p.date) <= new Date("2028-06-15")
    );
    for (const p of rpPeriods) {
      expect(p.beginningPar).toBeCloseTo(100_000_000, -2);
    }
  });

  it("reinvests prepayments during RP", () => {
    const result = runProjection(makeInputs());
    const rpPeriod = result.periods[0]; // Q1 is within RP
    expect(rpPeriod.reinvestment).toBeGreaterThan(0);
  });

  it("does not reinvest post-RP", () => {
    const result = runProjection(makeInputs());
    // RP ends 2028-06-15, currentDate 2026-03-09, so ~9 quarters in RP
    const postRpPeriods = result.periods.filter(
      (p) => new Date(p.date) > new Date("2028-06-15")
    );
    expect(postRpPeriods.length).toBeGreaterThan(0);
    for (const p of postRpPeriods) {
      expect(p.reinvestment).toBe(0);
    }
  });

  it("tracks tranche payoff quarters", () => {
    const result = runProjection(makeInputs());
    // The result should have entries for all tranches
    expect(result.tranchePayoffQuarter).toHaveProperty("A");
    expect(result.tranchePayoffQuarter).toHaveProperty("B");
    expect(result.tranchePayoffQuarter).toHaveProperty("Sub");
  });
});

// ─── calculateIrr ────────────────────────────────────────────────────────────

describe("calculateIrr", () => {
  it("returns null for all-positive cash flows", () => {
    expect(calculateIrr([100, 200, 300])).toBeNull();
  });

  it("returns null for fewer than 2 cash flows", () => {
    expect(calculateIrr([100])).toBeNull();
    expect(calculateIrr([])).toBeNull();
  });

  it("computes a reasonable IRR for typical CLO equity flows", () => {
    // Invest 20M, receive ~2M/quarter for 8 years → should be a positive IRR
    const flows = [-20_000_000];
    for (let i = 0; i < 32; i++) flows.push(2_000_000);
    const irr = calculateIrr(flows, 4);
    expect(irr).not.toBeNull();
    expect(irr!).toBeGreaterThan(0.05);
    expect(irr!).toBeLessThan(1.0);
  });
});

// ─── runProjection — loan maturities ─────────────────────────────────────────

describe("runProjection — loan maturities", () => {
  it("loan maturing in Q4 reduces par in that period", () => {
    const maturityDate = addQuartersHelper("2026-03-09", 4);
    const result = runProjection(
      makeInputs({
        cdrPct: 0,
        cprPct: 0,
        reinvestmentPeriodEnd: null, // no RP so maturity cash is not reinvested
        maturitySchedule: [{ parBalance: 5_000_000, maturityDate }],
      })
    );
    const q4 = result.periods.find((p) => p.periodNum === 4)!;
    expect(q4.scheduledMaturities).toBeGreaterThan(0);
    // Par should be lower than the no-maturity scenario
    const baseline = runProjection(
      makeInputs({ cdrPct: 0, cprPct: 0, reinvestmentPeriodEnd: null })
    );
    const q4Baseline = baseline.periods.find((p) => p.periodNum === 4)!;
    expect(q4.endingPar).toBeLessThan(q4Baseline.endingPar);
  });

  it("matured par stops earning interest", () => {
    // Place a large maturity in Q2 so it affects interest from Q3 onward
    const maturityDate = addQuartersHelper("2026-03-09", 2);
    const withMat = runProjection(
      makeInputs({
        cdrPct: 0,
        cprPct: 0,
        reinvestmentPeriodEnd: null, // no RP so maturities aren't reinvested
        maturitySchedule: [{ parBalance: 30_000_000, maturityDate }],
      })
    );
    const withoutMat = runProjection(
      makeInputs({
        cdrPct: 0,
        cprPct: 0,
        reinvestmentPeriodEnd: null,
        maturitySchedule: [],
      })
    );
    const q3With = withMat.periods.find((p) => p.periodNum === 3)!;
    const q3Without = withoutMat.periods.find((p) => p.periodNum === 3)!;
    expect(q3With.interestCollected).toBeLessThan(q3Without.interestCollected);
  });

  it("maturities during RP are reinvested", () => {
    const maturityDate = addQuartersHelper("2026-03-09", 2); // well within RP
    const result = runProjection(
      makeInputs({
        cdrPct: 0,
        cprPct: 0,
        maturitySchedule: [{ parBalance: 10_000_000, maturityDate }],
      })
    );
    const q2 = result.periods.find((p) => p.periodNum === 2)!;
    // Reinvestment should include the maturity amount
    expect(q2.reinvestment).toBeGreaterThanOrEqual(q2.scheduledMaturities);
    // Par should be restored after reinvestment
    expect(q2.endingPar).toBeCloseTo(100_000_000, -2);
  });

  it("maturities post-RP flow to principal paydown", () => {
    // Place maturity after RP ends (2028-06-15 → ~Q10)
    const maturityDate = addQuartersHelper("2026-03-09", 12); // ~Q12, post-RP
    const withMat = runProjection(
      makeInputs({
        cdrPct: 0,
        cprPct: 0,
        maturitySchedule: [{ parBalance: 10_000_000, maturityDate }],
      })
    );
    const withoutMat = runProjection(
      makeInputs({
        cdrPct: 0,
        cprPct: 0,
        maturitySchedule: [],
      })
    );
    const q12With = withMat.periods.find((p) => p.periodNum === 12)!;
    const q12Without = withoutMat.periods.find((p) => p.periodNum === 12)!;
    // With maturity, more principal should be paid to tranches
    const totalPrinWith = q12With.tranchePrincipal.reduce((s, t) => s + t.paid, 0);
    const totalPrinWithout = q12Without.tranchePrincipal.reduce((s, t) => s + t.paid, 0);
    expect(totalPrinWith).toBeGreaterThan(totalPrinWithout);
  });

  it("maturity amount capped at remaining par (no double-count with defaults)", () => {
    // With 50% CDR, par erodes rapidly. Schedule a huge maturity.
    const maturityDate = addQuartersHelper("2026-03-09", 8);
    const result = runProjection(
      makeInputs({
        cdrPct: 50,
        cprPct: 0,
        reinvestmentPeriodEnd: null,
        maturitySchedule: [{ parBalance: 200_000_000, maturityDate }], // more than initial par
      })
    );
    const q8 = result.periods.find((p) => p.periodNum === 8)!;
    // scheduledMaturities should be capped — not exceed the par available after defaults
    expect(q8.scheduledMaturities).toBeLessThanOrEqual(q8.beginningPar);
    expect(q8.endingPar).toBeGreaterThanOrEqual(0);
  });

  it("loans maturing after CLO maturity are ignored", () => {
    const result = runProjection(
      makeInputs({
        maturitySchedule: [{ parBalance: 10_000_000, maturityDate: "2040-01-01" }],
      })
    );
    // No period should have scheduled maturities
    for (const p of result.periods) {
      expect(p.scheduledMaturities).toBe(0);
    }
  });

  it("multiple loans maturing in same quarter are aggregated", () => {
    const maturityDate = addQuartersHelper("2026-03-09", 3);
    const result = runProjection(
      makeInputs({
        cdrPct: 0,
        cprPct: 0,
        reinvestmentPeriodEnd: null,
        maturitySchedule: [
          { parBalance: 5_000_000, maturityDate },
          { parBalance: 3_000_000, maturityDate },
        ],
      })
    );
    const q3 = result.periods.find((p) => p.periodNum === 3)!;
    expect(q3.scheduledMaturities).toBeCloseTo(8_000_000, -2);
  });
});

// ─── runProjection — OC/IC gating ───────────────────────────────────────────

describe("runProjection — OC gating diverts cash from equity", () => {
  it("high defaults trigger OC failure and cut equity distributions", () => {
    // With 10% CDR and 0% CPR, par erodes fast. OC tests should fail and divert.
    const withHighDefaults = runProjection(
      makeInputs({
        cdrPct: 10,
        cprPct: 0,
        recoveryPct: 0,
        reinvestmentPeriodEnd: null,
        ocTriggers: [
          { className: "A", triggerLevel: 120, rank: 1 },
          { className: "B", triggerLevel: 110, rank: 2 },
        ],
        icTriggers: [],
      })
    );
    const withNoDefaults = runProjection(
      makeInputs({
        cdrPct: 0,
        cprPct: 0,
        recoveryPct: 0,
        reinvestmentPeriodEnd: null,
        ocTriggers: [
          { className: "A", triggerLevel: 120, rank: 1 },
          { className: "B", triggerLevel: 110, rank: 2 },
        ],
        icTriggers: [],
      })
    );
    // High-default scenario should have much lower equity distributions
    expect(withHighDefaults.totalEquityDistributions).toBeLessThan(
      withNoDefaults.totalEquityDistributions
    );
    // Eventually some OC test should fail
    const anyOcFailing = withHighDefaults.periods.some((p) =>
      p.ocTests.some((oc) => !oc.passing)
    );
    expect(anyOcFailing).toBe(true);
  });

  it("OC failure diverts interest to principal paydown, reducing equity", () => {
    // Extreme scenario: very tight OC trigger that should fail quickly
    const result = runProjection(
      makeInputs({
        cdrPct: 5,
        cprPct: 0,
        recoveryPct: 0,
        reinvestmentPeriodEnd: null,
        ocTriggers: [
          { className: "B", triggerLevel: 200, rank: 2 }, // unreachably high trigger
        ],
        icTriggers: [],
      })
    );
    // With a 200% OC trigger on B, it should fail from Q1
    const q1 = result.periods[0];
    const ocB = q1.ocTests.find((t) => t.className === "B")!;
    expect(ocB.passing).toBe(false);
    // Equity should get zero or near-zero from interest diversion
    expect(q1.equityDistribution).toBeCloseTo(0, -1);
  });

  it("beginningLiabilities and endingLiabilities are reported", () => {
    const result = runProjection(makeInputs());
    const q1 = result.periods[0];
    expect(q1.beginningLiabilities).toBeCloseTo(80_000_000, -2); // 65M + 15M
    expect(q1.endingLiabilities).toBeLessThanOrEqual(q1.beginningLiabilities);
  });
});

// ─── Bug regression tests ───────────────────────────────────────────────────

describe("WAC blending timing", () => {
  it("interest uses pre-reinvestment WAC, not blended WAC", () => {
    // Two scenarios with different reinvestment spreads — interest in Q1
    // should be identical because WAC blending only affects NEXT period
    const withHighSpread = runProjection(
      makeInputs({ reinvestmentSpreadBps: 500 })
    );
    const withLowSpread = runProjection(
      makeInputs({ reinvestmentSpreadBps: 100 })
    );
    // Q1 interest should be identical (same beginningPar, same initial WAC)
    expect(withHighSpread.periods[0].interestCollected).toBeCloseTo(
      withLowSpread.periods[0].interestCollected,
      2
    );
    // But Q2 interest should differ (WAC has been blended differently)
    expect(withHighSpread.periods[1].interestCollected).not.toBeCloseTo(
      withLowSpread.periods[1].interestCollected,
      2
    );
  });
});

describe("already-matured loans excluded", () => {
  it("loans with maturityDate before currentDate are not bucketed", () => {
    const result = runProjection(
      makeInputs({
        cdrPct: 0,
        cprPct: 0,
        reinvestmentPeriodEnd: null,
        maturitySchedule: [{ parBalance: 10_000_000, maturityDate: "2020-01-01" }],
      })
    );
    // No period should have scheduled maturities from a loan that matured in 2020
    for (const p of result.periods) {
      expect(p.scheduledMaturities).toBe(0);
    }
  });
});

describe("IC ratio uses post-fee interest", () => {
  it("IC ratio is lower with higher senior fees", () => {
    const lowFee = runProjection(
      makeInputs({
        seniorFeePct: 0.1,
        cdrPct: 0,
        cprPct: 0,
        icTriggers: [{ className: "A", triggerLevel: 100, rank: 1 }],
        ocTriggers: [],
      })
    );
    const highFee = runProjection(
      makeInputs({
        seniorFeePct: 2.0,
        cdrPct: 0,
        cprPct: 0,
        icTriggers: [{ className: "A", triggerLevel: 100, rank: 1 }],
        ocTriggers: [],
      })
    );
    const icLow = lowFee.periods[0].icTests[0].actual;
    const icHigh = highFee.periods[0].icTests[0].actual;
    expect(icHigh).toBeLessThan(icLow);
  });
});

describe("endingPar at maturity", () => {
  it("endingPar is zero in the final period after liquidation", () => {
    const result = runProjection(
      makeInputs({
        cdrPct: 2,
        cprPct: 15,
        maturityDate: "2028-03-09", // 8 quarters
      })
    );
    const lastPeriod = result.periods[result.periods.length - 1];
    expect(lastPeriod.endingPar).toBe(0);
  });
});

describe("CDR/CPR >= 100% guard", () => {
  it("does not produce NaN with extreme CDR", () => {
    const result = runProjection(makeInputs({ cdrPct: 100 }));
    expect(result.periods.length).toBeGreaterThan(0);
    for (const p of result.periods) {
      expect(p.beginningPar).not.toBeNaN();
      expect(p.endingPar).not.toBeNaN();
      expect(p.defaults).not.toBeNaN();
      expect(p.interestCollected).not.toBeNaN();
    }
  });
});

describe("OC failure causes junior tranche interest shortfall", () => {
  it("junior tranche gets paid: 0 when OC diverts", () => {
    const result = runProjection(
      makeInputs({
        cdrPct: 5,
        cprPct: 0,
        recoveryPct: 0,
        reinvestmentPeriodEnd: null,
        // Trigger on A at 200% — always fails, diverts after A interest
        ocTriggers: [{ className: "A", triggerLevel: 200, rank: 1 }],
        icTriggers: [],
      })
    );
    const q1 = result.periods[0];
    const bInterest = q1.trancheInterest.find((t) => t.className === "B")!;
    // B should get zero interest because A's OC failure diverts everything
    expect(bInterest.paid).toBe(0);
    expect(bInterest.due).toBeGreaterThan(0);
  });
});

describe("recovery pipeline at maturity", () => {
  it("accelerates pending recoveries in the final period", () => {
    const result = runProjection(
      makeInputs({
        cdrPct: 5,
        cprPct: 0,
        recoveryPct: 60,
        recoveryLagMonths: 24, // 8 quarter lag — many will be pending at maturity
        reinvestmentPeriodEnd: null,
        maturityDate: "2030-03-09", // 16 quarters
      })
    );
    const lastPeriod = result.periods[result.periods.length - 1];
    // Final period should have recoveries from accelerated pipeline
    expect(lastPeriod.recoveries).toBeGreaterThan(0);
  });
});

// Helper to compute a date N quarters from a start date (mirrors engine logic)
function addQuartersHelper(dateIso: string, quarters: number): string {
  const d = new Date(dateIso);
  d.setMonth(d.getMonth() + quarters * 3);
  return d.toISOString().slice(0, 10);
}
