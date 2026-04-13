import { describe, it, expect } from "vitest";
import { runProjection, addQuarters } from "../projection";
import { makeInputs, uniformRates } from "./test-helpers";

describe("Fixed-rate loan projection", () => {
  it("earns flat coupon regardless of base rate", () => {
    const loan = {
      parBalance: 10_000_000,
      maturityDate: addQuarters("2026-03-09", 20),
      ratingBucket: "B",
      spreadBps: 0,
      isFixedRate: true,
      fixedCouponPct: 8.0,
    };

    const low = runProjection(
      makeInputs({
        loans: [loan],
        initialPar: 10_000_000,
        baseRatePct: 2.5,
        defaultRatesByRating: uniformRates(0),
        cprPct: 0,
      })
    );

    const high = runProjection(
      makeInputs({
        loans: [loan],
        initialPar: 10_000_000,
        baseRatePct: 5.0,
        defaultRatesByRating: uniformRates(0),
        cprPct: 0,
      })
    );

    const expected = 10_000_000 * 8 / 100 / 4; // 200,000
    expect(low.periods[0].interestCollected).toBeCloseTo(expected, 0);
    expect(high.periods[0].interestCollected).toBeCloseTo(expected, 0);
  });

  it("mixed portfolio: floating + fixed", () => {
    const floating = {
      parBalance: 9_000_000,
      maturityDate: addQuarters("2026-03-09", 20),
      ratingBucket: "B",
      spreadBps: 375,
    };
    const fixed = {
      parBalance: 1_000_000,
      maturityDate: addQuarters("2026-03-09", 20),
      ratingBucket: "B",
      spreadBps: 0,
      isFixedRate: true,
      fixedCouponPct: 8.0,
    };

    const result = runProjection(
      makeInputs({
        loans: [floating, fixed],
        initialPar: 10_000_000,
        baseRatePct: 2.5,
        baseRateFloorPct: 0,
        defaultRatesByRating: uniformRates(0),
        cprPct: 0,
      })
    );

    // floating: 9M * (2.5 + 3.75) / 100 / 4 = 140,625
    // fixed:    1M * 8.0 / 100 / 4          =  20,000
    expect(result.periods[0].interestCollected).toBeCloseTo(160_625, 0);
  });
});

describe("DDTL projection", () => {
  it("earns no interest before draw quarter", () => {
    const ddtl = {
      parBalance: 500_000,
      maturityDate: addQuarters("2026-03-09", 20),
      ratingBucket: "B",
      spreadBps: 0,
      isDelayedDraw: true,
      ddtlSpreadBps: 350,
      drawQuarter: 4,
    };

    const result = runProjection(
      makeInputs({
        loans: [ddtl],
        initialPar: 500_000,
        baseRatePct: 2.5,
        baseRateFloorPct: 0,
        defaultRatesByRating: uniformRates(0),
        cprPct: 0,
      })
    );

    expect(result.periods[0].interestCollected).toBeCloseTo(0, 2);
    expect(result.periods[1].interestCollected).toBeCloseTo(0, 2);
    expect(result.periods[2].interestCollected).toBeCloseTo(0, 2);
  });

  it("earns parent spread after draw", () => {
    const ddtl = {
      parBalance: 500_000,
      maturityDate: addQuarters("2026-03-09", 20),
      ratingBucket: "B",
      spreadBps: 0,
      isDelayedDraw: true,
      ddtlSpreadBps: 350,
      drawQuarter: 2,
    };

    const result = runProjection(
      makeInputs({
        loans: [ddtl],
        initialPar: 500_000,
        baseRatePct: 2.5,
        baseRateFloorPct: 0,
        defaultRatesByRating: uniformRates(0),
        cprPct: 0,
      })
    );

    // Q1: not drawn yet → 0
    expect(result.periods[0].interestCollected).toBeCloseTo(0, 2);
    // Q2: drawn at beginning of Q2 → 500K * (2.5 + 3.5) / 100 / 4 = 7,500
    expect(result.periods[1].interestCollected).toBeCloseTo(7_500, 0);
  });

  it("never_draw (drawQuarter <= 0) removes par at Q1", () => {
    const normal = {
      parBalance: 10_000_000,
      maturityDate: addQuarters("2026-03-09", 20),
      ratingBucket: "B",
      spreadBps: 375,
    };
    const neverDraw = {
      parBalance: 500_000,
      maturityDate: addQuarters("2026-03-09", 20),
      ratingBucket: "B",
      spreadBps: 0,
      isDelayedDraw: true,
      ddtlSpreadBps: 350,
      drawQuarter: 0,
    };

    const result = runProjection(
      makeInputs({
        loans: [normal, neverDraw],
        initialPar: 10_500_000,
        baseRatePct: 2.5,
        baseRateFloorPct: 0,
        defaultRatesByRating: uniformRates(0),
        cprPct: 0,
      })
    );

    // Only the 10M loan's interest should appear
    expect(result.periods[0].beginningPar).toBeCloseTo(10_000_000, 0);
    const expectedInterest = 10_000_000 * (2.5 + 3.75) / 100 / 4;
    expect(result.periods[0].interestCollected).toBeCloseTo(expectedInterest, 0);
  });

  it("partial draw funds only ddtlDrawPercent of par", () => {
    const ddtl = {
      parBalance: 500_000,
      maturityDate: addQuarters("2026-03-09", 20),
      ratingBucket: "B",
      spreadBps: 0,
      isDelayedDraw: true,
      ddtlSpreadBps: 350,
      drawQuarter: 2,
    };

    const result = runProjection(
      makeInputs({
        loans: [ddtl],
        initialPar: 500_000,
        baseRatePct: 2.5,
        baseRateFloorPct: 0,
        defaultRatesByRating: uniformRates(0),
        cprPct: 0,
        ddtlDrawPercent: 60,
      })
    );

    // Q2: 60% of 500K = 300K funded. Interest = 300K * (2.5 + 3.5) / 100 / 4 = 4,500
    expect(result.periods[1].interestCollected).toBeCloseTo(4_500, 0);
  });

  it("DDTL not subject to defaults/prepay before draw", () => {
    const ddtl = {
      parBalance: 500_000,
      maturityDate: addQuarters("2026-03-09", 20),
      ratingBucket: "CCC",
      spreadBps: 0,
      isDelayedDraw: true,
      ddtlSpreadBps: 350,
      drawQuarter: 4,
    };

    const result = runProjection(
      makeInputs({
        loans: [ddtl],
        initialPar: 500_000,
        baseRatePct: 2.5,
        baseRateFloorPct: 0,
        defaultRatesByRating: uniformRates(10), // 10% CDR — aggressive
        cprPct: 20,
      })
    );

    // Q1-Q3: no defaults and no prepayments (DDTL is unfunded)
    for (let i = 0; i < 3; i++) {
      expect(result.periods[i].defaults).toBeCloseTo(0, 2);
      expect(result.periods[i].prepayments).toBeCloseTo(0, 2);
    }
  });

  it("OC deduction excludes DDTL unfunded par", () => {
    const normal = {
      parBalance: 10_000_000,
      maturityDate: addQuarters("2026-03-09", 20),
      ratingBucket: "B",
      spreadBps: 375,
    };
    const ddtl = {
      parBalance: 500_000,
      maturityDate: addQuarters("2026-03-09", 20),
      ratingBucket: "B",
      spreadBps: 0,
      isDelayedDraw: true,
      ddtlSpreadBps: 350,
      drawQuarter: 8,
    };

    const withDdtl = runProjection(
      makeInputs({
        loans: [normal, ddtl],
        initialPar: 10_500_000,
        baseRatePct: 2.5,
        baseRateFloorPct: 0,
        defaultRatesByRating: uniformRates(0),
        cprPct: 0,
      })
    );

    const withoutDdtl = runProjection(
      makeInputs({
        loans: [normal],
        initialPar: 10_000_000,
        baseRatePct: 2.5,
        baseRateFloorPct: 0,
        defaultRatesByRating: uniformRates(0),
        cprPct: 0,
      })
    );

    // OC tests should be similar — the DDTL unfunded par should not inflate the numerator
    const ocWithDdtl = withDdtl.periods[0].ocTests[0]?.actual;
    const ocWithout = withoutDdtl.periods[0].ocTests[0]?.actual;
    expect(Math.abs(ocWithDdtl - ocWithout)).toBeLessThan(2);
  });
});
