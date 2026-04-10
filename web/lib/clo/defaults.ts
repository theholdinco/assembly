// Single source of truth for CLO model defaults.
// Used by resolver (when extraction fails), UI (slider initial values), and tests.
//
// These represent typical European CLO values. When extraction fails to find
// a fee or parameter, these are used AND a warning is emitted so the user
// knows a default is being applied.

export const CLO_DEFAULTS = {
  // Management fees (percentage per annum on collateral principal)
  seniorFeePct: 0.15,   // 15 bps — typical range: 0.10-0.20%
  subFeePct: 0.25,      // 25 bps — typical range: 0.20-0.35%

  // Trustee/admin fee (basis points per annum)
  trusteeFeeBps: 2,     // typical range: 1-5 bps

  // Incentive fee (disabled by default — only applied when explicitly found in PPM)
  incentiveFeePct: 0,
  incentiveFeeHurdleIrr: 0,

  // Base rate assumption
  baseRatePct: 3.5,     // ~current 3M EURIBOR

  // Default assumptions for projection
  cprPct: 15,
  recoveryPct: 60,
  recoveryLagMonths: 12,
  reinvestmentSpreadBps: 350,
  reinvestmentTenorYears: 5,

  // OC test parameters
  cccBucketLimitPct: 7.5,
  cccMarketValuePct: 70,
} as const;
