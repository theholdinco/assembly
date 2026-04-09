import type { ExtractedConstraints, CloPoolSummary, CloComplianceTest, CloTranche, CloTrancheSnapshot, CloHolding } from "./types";
import type { ResolvedDealData, ResolvedTranche, ResolvedPool, ResolvedTrigger, ResolvedDates, ResolvedFees, ResolvedLoan, ResolutionWarning } from "./resolver-types";
import { parseSpreadToBps, normalizeWacSpread } from "./ingestion-gate";
import { mapToRatingBucket } from "./rating-mapping";

function normClass(s: string): string {
  return s.replace(/^class\s+/i, "").replace(/\s+notes?$/i, "").trim().toLowerCase();
}

function parseAmount(s: string | undefined | null): number {
  if (!s) return 0;
  return parseFloat(s.replace(/[^0-9.]/g, "")) || 0;
}

function isOcTest(t: { testType?: string | null; testName?: string | null }): boolean {
  if (t.testType === "OC_PAR" || t.testType === "OC_MV") return true;
  const name = (t.testName ?? "").toLowerCase();
  return name.includes("overcollateral") || name.includes("par value") || (name.includes("oc") && name.includes("ratio"));
}

function isIcTest(t: { testType?: string | null; testName?: string | null }): boolean {
  if (t.testType === "IC") return true;
  const name = (t.testName ?? "").toLowerCase();
  return name.includes("interest coverage") || (name.includes("ic") && name.includes("ratio"));
}

function dedupTriggers(triggers: { className: string; triggerLevel: number }[]): { className: string; triggerLevel: number }[] {
  const byClass = new Map<string, { className: string; triggerLevel: number }>();
  for (const t of triggers) {
    const existing = byClass.get(t.className);
    if (!existing || t.triggerLevel > existing.triggerLevel) {
      byClass.set(t.className, t);
    }
  }
  return Array.from(byClass.values());
}

function resolveTranches(
  constraints: ExtractedConstraints,
  dbTranches: CloTranche[],
  snapshots: CloTrancheSnapshot[],
  warnings: ResolutionWarning[],
): ResolvedTranche[] {
  const snapshotByTrancheId = new Map(snapshots.map(s => [s.trancheId, s]));
  const classXAmort = constraints.dealSizing?.classXAmortisation;
  const classXAmortPerPeriod = classXAmort ? parseAmount(classXAmort) : null;

  // Build PPM spread lookup
  const ppmSpreadByClass = new Map<string, number>();
  const ppmBalanceByClass = new Map<string, number>();
  const ppmDeferrableByClass = new Map<string, boolean>();
  const ppmSubByClass = new Map<string, boolean>();

  for (const e of constraints.capitalStructure ?? []) {
    const key = normClass(e.class);
    const bps = parseSpreadToBps(e.spreadBps, e.spread);
    if (bps != null && bps > 0) ppmSpreadByClass.set(key, bps);
    ppmBalanceByClass.set(key, parseAmount(e.principalAmount));
    if (e.deferrable != null) ppmDeferrableByClass.set(key, e.deferrable);
    ppmSubByClass.set(key, e.isSubordinated ?? e.class.toLowerCase().includes("sub"));
  }

  // If DB tranches exist, use them as the primary source
  if (dbTranches.length > 0) {
    return dbTranches
      .sort((a, b) => (a.seniorityRank ?? 99) - (b.seniorityRank ?? 99))
      .map(t => {
        const snap = snapshotByTrancheId.get(t.id);
        const key = normClass(t.className);
        const isClassX = /^(class\s+)?x$/i.test(t.className.trim());
        const isSub = t.isIncomeNote ?? t.isSubordinate ?? ppmSubByClass.get(key) ?? t.className.toLowerCase().includes("sub");

        let spreadBps = t.spreadBps ?? ppmSpreadByClass.get(key) ?? 0;
        if (spreadBps === 0 && !isSub) {
          warnings.push({
            field: `${t.className}.spreadBps`,
            message: `No spread found for ${t.className} in DB or PPM constraints`,
            severity: "error",
          });
        }
        if (t.spreadBps == null && ppmSpreadByClass.has(key)) {
          warnings.push({
            field: `${t.className}.spreadBps`,
            message: `Using PPM spread (${ppmSpreadByClass.get(key)} bps) — DB tranche has null`,
            severity: "info",
            resolvedFrom: "ppm_constraints",
          });
        }

        return {
          className: t.className,
          currentBalance: snap?.currentBalance ?? t.originalBalance ?? ppmBalanceByClass.get(key) ?? 0,
          originalBalance: t.originalBalance ?? ppmBalanceByClass.get(key) ?? 0,
          spreadBps,
          seniorityRank: t.seniorityRank ?? 99,
          isFloating: t.isFloating ?? true,
          isIncomeNote: isSub,
          isDeferrable: t.isDeferrable ?? ppmDeferrableByClass.get(key) ?? false,
          isAmortising: isClassX,
          amortisationPerPeriod: isClassX ? (classXAmortPerPeriod ?? null) : null,
          source: snap ? "snapshot" as const : "db_tranche" as const,
        };
      });
  }

  // Fallback: build from PPM capital structure
  const entries = constraints.capitalStructure ?? [];
  const byClass = new Map<string, typeof entries[number]>();
  for (const e of entries) {
    const existing = byClass.get(e.class);
    if (!existing || (parseAmount(e.principalAmount) > 0 && (!existing.principalAmount || parseAmount(existing.principalAmount) === 0))) {
      byClass.set(e.class, e);
    }
  }

  return Array.from(byClass.values()).map((e, idx) => {
    const isSub = e.isSubordinated ?? e.class.toLowerCase().includes("sub");
    const isFloating = e.rateType?.toLowerCase().includes("float") ??
      (e.spread?.toLowerCase().includes("euribor") || e.spread?.toLowerCase().includes("sofr") || false);
    const isClassX = /^(class\s+)?x$/i.test(e.class.trim());
    const spreadBps = parseSpreadToBps(e.spreadBps, e.spread) ?? 0;

    if (spreadBps === 0 && !isSub) {
      warnings.push({
        field: `${e.class}.spreadBps`,
        message: `No spread found for ${e.class} in PPM constraints`,
        severity: "error",
      });
    }

    return {
      className: e.class,
      currentBalance: parseAmount(e.principalAmount),
      originalBalance: parseAmount(e.principalAmount),
      spreadBps,
      seniorityRank: idx + 1,
      isFloating,
      isIncomeNote: isSub,
      isDeferrable: e.deferrable ?? false,
      isAmortising: isClassX,
      amortisationPerPeriod: isClassX ? (classXAmortPerPeriod ?? null) : null,
      source: "ppm" as const,
    };
  });
}

function resolveTriggers(
  complianceTests: CloComplianceTest[],
  constraints: ExtractedConstraints,
  resolvedTranches: ResolvedTranche[],
  warnings: ResolutionWarning[],
): { oc: ResolvedTrigger[]; ic: ResolvedTrigger[] } {
  // Resolve a class name (possibly compound like "A/B") to its most junior seniority rank
  function resolveRank(cls: string): number {
    const parts = cls.split("/").map(s => s.trim());
    let maxRank = 0;
    for (const part of parts) {
      const base = part.replace(/-RR$/i, "").trim();
      const exact = resolvedTranches.find(t => normClass(t.className) === normClass(base));
      if (exact) { maxRank = Math.max(maxRank, exact.seniorityRank); continue; }
      const prefix = resolvedTranches.filter(t =>
        normClass(t.className).startsWith(normClass(base)) || normClass(t.className).startsWith(base.toLowerCase())
      );
      if (prefix.length > 0) { maxRank = Math.max(maxRank, ...prefix.map(t => t.seniorityRank)); continue; }
    }
    return maxRank || 99;
  }

  // From compliance tests
  const ocFromTests = complianceTests
    .filter(t => isOcTest(t) && t.triggerLevel != null && t.testClass)
    .map(t => ({ className: t.testClass!, triggerLevel: t.triggerLevel! }));
  const icFromTests = complianceTests
    .filter(t => isIcTest(t) && t.triggerLevel != null && t.testClass)
    .map(t => ({ className: t.testClass!, triggerLevel: t.triggerLevel! }));

  // From PPM constraints (fallback)
  const ocFromPpm = (constraints.coverageTestEntries ?? [])
    .filter(e => e.class && e.parValueRatio && parseFloat(e.parValueRatio))
    .map(e => ({ className: e.class!, triggerLevel: parseFloat(e.parValueRatio!) }));
  const icFromPpm = (constraints.coverageTestEntries ?? [])
    .filter(e => e.class && e.interestCoverageRatio && parseFloat(e.interestCoverageRatio))
    .map(e => ({ className: e.class!, triggerLevel: parseFloat(e.interestCoverageRatio!) }));

  const ocRaw = ocFromTests.length > 0 ? ocFromTests : ocFromPpm;
  const icRaw = icFromTests.length > 0 ? icFromTests : icFromPpm;
  const ocSource = ocFromTests.length > 0 ? "compliance" as const : "ppm" as const;
  const icSource = icFromTests.length > 0 ? "compliance" as const : "ppm" as const;

  if (ocRaw.length === 0) {
    warnings.push({ field: "ocTriggers", message: "No OC triggers found in compliance tests or PPM", severity: "warn" });
  }

  const oc: ResolvedTrigger[] = dedupTriggers(ocRaw).map(t => ({
    className: t.className,
    triggerLevel: t.triggerLevel,
    rank: resolveRank(t.className),
    testType: "OC" as const,
    source: ocSource,
  }));

  const ic: ResolvedTrigger[] = dedupTriggers(icRaw).map(t => ({
    className: t.className,
    triggerLevel: t.triggerLevel,
    rank: resolveRank(t.className),
    testType: "IC" as const,
    source: icSource,
  }));

  return { oc, ic };
}

function resolveFees(constraints: ExtractedConstraints, warnings: ResolutionWarning[]): ResolvedFees {
  let seniorFeePct = 0.15;
  let subFeePct = 0.25;

  for (const fee of constraints.fees ?? []) {
    const name = fee.name?.toLowerCase() ?? "";
    const rate = parseFloat(fee.rate ?? "");
    if (isNaN(rate)) continue;

    if (name.includes("senior") && (name.includes("mgmt") || name.includes("management"))) {
      seniorFeePct = rate;
    } else if (name.includes("sub") && (name.includes("mgmt") || name.includes("management"))) {
      subFeePct = rate;
    }
  }

  return { seniorFeePct, subFeePct };
}

export function resolveWaterfallInputs(
  constraints: ExtractedConstraints,
  complianceData: {
    poolSummary: CloPoolSummary | null;
    complianceTests: CloComplianceTest[];
    concentrations: unknown[];
  } | null,
  dbTranches: CloTranche[],
  trancheSnapshots: CloTrancheSnapshot[],
  holdings: CloHolding[],
  dealDates?: { maturity?: string | null; reinvestmentPeriodEnd?: string | null },
): { resolved: ResolvedDealData; warnings: ResolutionWarning[] } {
  const warnings: ResolutionWarning[] = [];

  // --- Tranches ---
  const tranches = resolveTranches(constraints, dbTranches, trancheSnapshots, warnings);

  // --- Pool Summary ---
  const pool = complianceData?.poolSummary;
  const { bps: wacSpreadBps, fix: wacFix } = normalizeWacSpread(pool?.wacSpread ?? null);
  if (wacFix) warnings.push({ field: wacFix.field, message: wacFix.message, severity: "info", resolvedFrom: `${wacFix.before} → ${wacFix.after}` });

  const poolSummary: ResolvedPool = {
    totalPar: pool?.totalPar ?? 0,
    wacSpreadBps,
    warf: pool?.warf ?? 0,
    walYears: pool?.walYears ?? 0,
    diversityScore: pool?.diversityScore ?? 0,
    numberOfObligors: pool?.numberOfObligors ?? 0,
  };

  if (poolSummary.totalPar === 0) {
    warnings.push({ field: "poolSummary.totalPar", message: "Total par is 0 — no pool summary data", severity: "error" });
  }

  // --- Triggers ---
  const { oc: ocTriggers, ic: icTriggers } = resolveTriggers(
    complianceData?.complianceTests ?? [],
    constraints,
    tranches,
    warnings,
  );

  // --- Dates ---
  const maturity = dealDates?.maturity ?? constraints.keyDates?.maturityDate ?? null;
  if (!maturity) {
    warnings.push({ field: "dates.maturity", message: "No maturity date found", severity: "error" });
  }

  const dates: ResolvedDates = {
    maturity: maturity ?? "2037-01-01",
    reinvestmentPeriodEnd: dealDates?.reinvestmentPeriodEnd ?? constraints.keyDates?.reinvestmentPeriodEnd ?? null,
    nonCallPeriodEnd: constraints.keyDates?.nonCallPeriodEnd ?? null,
    firstPaymentDate: constraints.keyDates?.firstPaymentDate ?? null,
    currentDate: new Date().toISOString().slice(0, 10),
  };

  // --- Fees ---
  const fees = resolveFees(constraints, warnings);

  // --- Loans ---
  const fallbackMaturity = maturity ?? "2037-01-01";
  const loans: ResolvedLoan[] = holdings
    .filter(h => h.parBalance != null && h.parBalance > 0 && !h.isDefaulted)
    .map(h => ({
      parBalance: h.parBalance!,
      maturityDate: h.maturityDate ?? fallbackMaturity,
      ratingBucket: mapToRatingBucket(h.moodysRating ?? null, h.spRating ?? null, h.fitchRating ?? null, h.compositeRating ?? null),
      spreadBps: h.spreadBps ?? wacSpreadBps,
    }));

  return {
    resolved: { tranches, poolSummary, ocTriggers, icTriggers, dates, fees, loans },
    warnings,
  };
}
