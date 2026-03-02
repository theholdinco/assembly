import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { getProfileForUser, getPanelForUser } from "@/lib/clo/access";
import { query } from "@/lib/db";
import type { PanelMember, ParsedAnalysis } from "@/lib/clo/types";
import MemberProfileClient from "./MemberProfileClient";

interface AnalysisRow {
  id: string;
  title: string;
  borrower_name: string;
  parsed_data: ParsedAnalysis;
}

interface AnalysisHistoryEntry {
  analysisId: string;
  title: string;
  type: "assessment" | "debate";
  excerpt: string;
}

export default async function MemberProfilePage({
  params,
}: {
  params: Promise<{ num: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/");
  }

  const profile = await getProfileForUser(session.user.id);
  if (!profile) {
    redirect("/clo/onboarding");
  }

  const panel = await getPanelForUser(session.user.id);
  if (!panel || panel.status !== "active") {
    redirect("/clo/panel");
  }

  const { num } = await params;
  const memberNumber = Number(num);
  const members = (panel.members || []) as PanelMember[];
  const member = members.find((m) => m.number === memberNumber);

  if (!member) {
    redirect("/clo/panel");
  }

  const analysisRows = await query<AnalysisRow>(
    `SELECT id, title, borrower_name, parsed_data
     FROM clo_analyses
     WHERE panel_id = $1 AND status = 'complete'
     ORDER BY created_at DESC`,
    [panel.id]
  );

  const analysisOptions = analysisRows.map((r) => ({
    id: r.id,
    title: r.title,
    borrowerName: r.borrower_name,
  }));

  const analysisHistory: AnalysisHistoryEntry[] = [];

  for (const row of analysisRows) {
    const parsed = row.parsed_data;
    if (!parsed) continue;

    if (parsed.individualAssessments) {
      for (const assessment of parsed.individualAssessments) {
        if (assessment.memberName === member.name) {
          const excerpt = (assessment.raw || assessment.position || "").slice(0, 150);
          analysisHistory.push({
            analysisId: row.id,
            title: row.title,
            type: "assessment",
            excerpt,
          });
        }
      }
    }

    if (parsed.debate) {
      for (const round of parsed.debate) {
        for (const exchange of round.exchanges) {
          if (exchange.speaker === member.name) {
            analysisHistory.push({
              analysisId: row.id,
              title: row.title,
              type: "debate",
              excerpt: exchange.content.slice(0, 150),
            });
          }
        }
      }
    }
  }

  const memberIndex = members.findIndex((m) => m.number === memberNumber);
  const prev = members[memberIndex - 1] ?? null;
  const next = members[memberIndex + 1] ?? null;

  return (
    <div className="ic-content">
      <MemberProfileClient
        member={member}
        members={members}
        panelId={panel.id}
        analysisOptions={analysisOptions}
        analysisHistory={analysisHistory}
        prev={prev}
        next={next}
      />
    </div>
  );
}
