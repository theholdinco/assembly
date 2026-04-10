import { auth } from "@/lib/auth";
import { notFound } from "next/navigation";
import { query } from "@/lib/db";
import {
  getDealForProfile,
  getLatestReportPeriod,
  getHoldings,
  getTranches,
  getTrancheSnapshots,
  getReportPeriodData,
} from "@/lib/clo/access";
import { resolveWaterfallInputs } from "@/lib/clo/resolver";
import type { ExtractedConstraints } from "@/lib/clo/types";
import SwitchWaterfallImpact from "@/components/clo/SwitchWaterfallImpact";

async function verifyAnalysisAccess(analysisId: string, userId: string): Promise<boolean> {
  const rows = await query<{ id: string }>(
    `SELECT a.id FROM clo_analyses a
     JOIN clo_panels p ON a.panel_id = p.id
     JOIN clo_profiles pr ON p.profile_id = pr.id
     WHERE a.id = $1 AND pr.user_id = $2`,
    [analysisId, userId]
  );
  return rows.length > 0;
}

export default async function WaterfallPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) notFound();

  const { id } = await params;
  const hasAccess = await verifyAnalysisAccess(id, session.user.id);
  if (!hasAccess) notFound();

  // Load analysis with switch fields
  const analyses = await query<{
    analysis_type: string;
    borrower_name: string | null;
    spread_coupon: string | null;
    rating: string | null;
    maturity: string | null;
    facility_size: string | null;
    switch_borrower_name: string | null;
    switch_spread_coupon: string | null;
    switch_rating: string | null;
    switch_maturity: string | null;
    switch_facility_size: string | null;
    panel_id: string;
  }>(
    `SELECT analysis_type, borrower_name, spread_coupon, rating, maturity, facility_size,
            switch_borrower_name, switch_spread_coupon, switch_rating, switch_maturity, switch_facility_size,
            panel_id
     FROM clo_analyses WHERE id = $1`,
    [id]
  );

  if (analyses.length === 0 || analyses[0].analysis_type !== "switch") {
    return <p style={{ padding: "2rem", color: "var(--color-text-muted)" }}>Waterfall impact is only available for switch analyses.</p>;
  }

  const analysis = analyses[0];

  // Get profile from panel → profile chain
  const profiles = await query<{ profile_id: string }>(
    "SELECT profile_id FROM clo_panels WHERE id = $1",
    [analysis.panel_id]
  );
  if (profiles.length === 0) notFound();

  const profileRows = await query<{ id: string; extracted_constraints: ExtractedConstraints }>(
    "SELECT id, extracted_constraints FROM clo_profiles WHERE id = $1",
    [profiles[0].profile_id]
  );
  if (profileRows.length === 0) notFound();

  const constraints = profileRows[0].extracted_constraints;
  const deal = await getDealForProfile(profileRows[0].id);
  if (!deal) {
    return <p style={{ padding: "2rem", color: "var(--color-text-muted)" }}>No deal data available. Upload a compliance report first.</p>;
  }

  const reportPeriod = await getLatestReportPeriod(deal.id);
  if (!reportPeriod) {
    return <p style={{ padding: "2rem", color: "var(--color-text-muted)" }}>No compliance report data. Upload a compliance report to enable waterfall analysis.</p>;
  }

  const [tranches, trancheSnapshots, periodData, holdings] = await Promise.all([
    getTranches(deal.id),
    getTrancheSnapshots(reportPeriod.id),
    getReportPeriodData(reportPeriod.id),
    getHoldings(reportPeriod.id),
  ]);

  const maturityDate = deal.statedMaturityDate ?? constraints.keyDates?.maturityDate ?? null;
  const reinvestmentPeriodEnd = deal.reinvestmentPeriodEnd ?? constraints.keyDates?.reinvestmentPeriodEnd ?? null;

  const { resolved, warnings } = resolveWaterfallInputs(
    constraints,
    { poolSummary: periodData.poolSummary, complianceTests: periodData.complianceTests, concentrations: periodData.concentrations },
    tranches,
    trancheSnapshots,
    holdings,
    { maturity: maturityDate, reinvestmentPeriodEnd },
  );

  return (
    <SwitchWaterfallImpact
      resolved={resolved}
      sellLoan={{
        borrowerName: analysis.borrower_name ?? "",
        spreadCoupon: analysis.spread_coupon ?? "",
        rating: analysis.rating ?? "",
        maturity: analysis.maturity ?? "",
        facilitySize: analysis.facility_size ?? "",
      }}
      buyLoan={{
        borrowerName: analysis.switch_borrower_name ?? "",
        spreadCoupon: analysis.switch_spread_coupon ?? "",
        rating: analysis.switch_rating ?? "",
        maturity: analysis.switch_maturity ?? "",
        facilitySize: analysis.switch_facility_size ?? "",
      }}
    />
  );
}
