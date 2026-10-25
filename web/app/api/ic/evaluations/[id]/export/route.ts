import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth-helpers";
import { query } from "@/lib/db";
import { verifyEvaluationAccess } from "@/lib/ic/access";
import { renderMarkdown } from "@/lib/markdown";
import type { ParsedEvaluation, CommitteeMember } from "@/lib/ic/types";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const hasAccess = await verifyEvaluationAccess(id, user.id);
  if (!hasAccess) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const rows = await query<{
    title: string;
    opportunity_type: string | null;
    company_name: string | null;
    thesis: string | null;
    terms: string | null;
    parsed_data: ParsedEvaluation | null;
    committee_id: string;
    dynamic_specialists: CommitteeMember[] | null;
    created_at: string;
    completed_at: string | null;
  }>(
    "SELECT title, opportunity_type, company_name, thesis, terms, parsed_data, committee_id, dynamic_specialists, created_at, completed_at FROM ic_evaluations WHERE id = $1",
    [id]
  );

  if (rows.length === 0 || !rows[0].parsed_data) {
    return NextResponse.json({ error: "Evaluation not found or not complete" }, { status: 404 });
  }

  const eval_ = rows[0];
  const parsed = eval_.parsed_data!;

  const committees = await query<{ members: CommitteeMember[] }>(
    "SELECT members FROM ic_committees WHERE id = $1",
    [eval_.committee_id]
  );
  const members = [
    ...(committees[0]?.members || []),
    ...(eval_.dynamic_specialists || []),
  ];

  const md = (text: string) => renderMarkdown(text);
  const esc = (text: string) =>
    text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  const VERDICT_LABELS: Record<string, string> = {
    strongly_favorable: "Strongly Favorable",
    favorable: "Favorable",
    mixed: "Mixed",
    unfavorable: "Unfavorable",
    strongly_unfavorable: "Strongly Unfavorable",
    strong_buy: "Strongly Favorable",
    buy: "Favorable",
    hold: "Mixed",
    pass: "Unfavorable",
    strong_pass: "Strongly Unfavorable",
  };

  const RISK_LABELS: Record<string, string> = {
    low: "Low",
    moderate: "Moderate",
    high: "High",
    "very-high": "Very High",
  };

  const sections: string[] = [];

  // Header
  const date = eval_.completed_at
    ? new Date(eval_.completed_at).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })
    : new Date(eval_.created_at).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

  sections.push(`
    <header class="report-header">
      <div class="report-badge">Investment Committee Analysis</div>
      <h1>${esc(eval_.title)}</h1>
      <div class="report-meta">
        ${eval_.company_name ? `<span>${esc(eval_.company_name)}</span>` : ""}
        ${eval_.opportunity_type ? `<span>${esc(eval_.opportunity_type)}</span>` : ""}
        <span>${date}</span>
      </div>
    </header>
  `);

  // Committee Perspective (verdict)
  if (parsed.recommendation) {
    const verdictLabel = VERDICT_LABELS[parsed.recommendation.verdict] || parsed.recommendation.verdict;
    sections.push(`
      <section class="verdict-section">
        <h2>Committee Perspective</h2>
        <div class="verdict-badge verdict-${parsed.recommendation.verdict}">${esc(verdictLabel)}</div>
      </section>
    `);
  }

  // Investment Memo
  if (parsed.memo) {
    sections.push('<section class="memo-section"><h2>Investment Memo</h2>');
    if (parsed.memo.sections?.length > 0) {
      for (const section of parsed.memo.sections) {
        const isCaveat = /what we don.?t know|information gaps/i.test(section.heading);
        sections.push(`
          <div class="memo-subsection ${isCaveat ? "caveat" : ""}">
            <h3>${esc(section.heading)}</h3>
            ${md(section.content)}
          </div>
        `);
      }
    } else if (parsed.memo.raw) {
      sections.push(md(parsed.memo.raw));
    }
    sections.push("</section>");
  }

  // Risk Assessment
  if (parsed.riskAssessment) {
    const risk = parsed.riskAssessment;
    const riskLabel = RISK_LABELS[risk.overallRisk] || risk.overallRisk;
    sections.push(`
      <section class="risk-section">
        <h2>Risk Assessment — <span class="risk-level risk-${risk.overallRisk}">${esc(riskLabel)}</span></h2>
    `);
    if (risk.categories?.length > 0) {
      sections.push('<div class="risk-grid">');
      for (const cat of risk.categories) {
        sections.push(`
          <div class="risk-category">
            <div class="risk-cat-header">
              <strong>${esc(cat.name)}</strong>
              <span class="risk-level risk-${cat.level?.toLowerCase()}">${esc(cat.level)}</span>
            </div>
            <p>${esc(cat.analysis)}</p>
          </div>
        `);
      }
      sections.push("</div>");
    }
    if (risk.mitigants?.length > 0) {
      sections.push("<h3>Mitigants</h3><ul>");
      for (const m of risk.mitigants) {
        sections.push(`<li>${esc(m)}</li>`);
      }
      sections.push("</ul>");
    }
    sections.push("</section>");
  }

  // Member Perspectives (votes)
  if (parsed.recommendation?.votes?.length) {
    sections.push('<section class="votes-section"><h2>Member Perspectives</h2><div class="votes-grid">');
    for (const vote of parsed.recommendation.votes) {
      const member = members.find((m) => m.name === vote.memberName);
      const voteLabel = VERDICT_LABELS[vote.vote] || vote.vote;
      sections.push(`
        <div class="vote-card">
          <div class="vote-card-header">
            <strong>${esc(vote.memberName)}</strong>
            ${member?.role ? `<span class="vote-role">${esc(member.role)}</span>` : ""}
          </div>
          <div class="vote-verdict">${esc(voteLabel)}${vote.engagement ? ` · ${esc(vote.engagement)} engagement` : ""}</div>
          <p>${esc(vote.rationale)}</p>
        </div>
      `);
    }
    sections.push("</div>");

    if (parsed.recommendation.dissents?.length) {
      sections.push("<h3>Dissenting Views</h3><ul>");
      for (const d of parsed.recommendation.dissents) {
        sections.push(`<li>${esc(d)}</li>`);
      }
      sections.push("</ul>");
    }

    if (parsed.recommendation.conditions?.length) {
      sections.push("<h3>Conditions &amp; Considerations</h3><ul>");
      for (const c of parsed.recommendation.conditions) {
        sections.push(`<li>${esc(c)}</li>`);
      }
      sections.push("</ul>");
    }
    sections.push("</section>");
  }

  // Debate
  if (parsed.debate?.length) {
    sections.push('<section class="debate-section"><h2>Committee Debate</h2>');
    for (const round of parsed.debate) {
      sections.push(`<h3>Round ${round.round}</h3>`);
      for (const ex of round.exchanges) {
        sections.push(`<div class="debate-exchange"><strong>${esc(ex.speaker)}:</strong> ${md(ex.content)}</div>`);
      }
    }
    sections.push("</section>");
  }

  const slug = eval_.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 50);

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(eval_.title)} — IC Analysis</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;600;700&family=Source+Sans+3:wght@300;400;500;600&family=JetBrains+Mono:wght@400;500&display=swap');

  :root {
    --font-display: 'Playfair Display', Georgia, serif;
    --font-body: 'Source Sans 3', -apple-system, sans-serif;
    --font-mono: 'JetBrains Mono', monospace;
  }

  * { margin: 0; padding: 0; box-sizing: border-box; }

  body {
    font-family: var(--font-body);
    color: #2d2a26;
    max-width: 800px;
    margin: 0 auto;
    padding: 3rem 2rem;
    font-size: 10.5pt;
    line-height: 1.7;
  }

  @media print {
    body { padding: 0; font-size: 10pt; }
    section { break-inside: avoid; }
    .no-print { display: none; }
  }

  h1 { font-family: var(--font-display); font-size: 2rem; font-weight: 700; margin-bottom: 0.5rem; }
  h2 { font-family: var(--font-display); font-size: 1.3rem; font-weight: 600; margin: 2rem 0 0.75rem; padding-bottom: 0.3rem; border-bottom: 1px solid #e8e4df; }
  h3 { font-family: var(--font-display); font-size: 1.05rem; font-weight: 600; margin: 1.25rem 0 0.5rem; }

  p { margin-bottom: 0.6rem; }
  ul, ol { padding-left: 1.5rem; margin-bottom: 0.6rem; }
  li { margin-bottom: 0.3rem; }

  .report-header { margin-bottom: 2rem; }
  .report-badge {
    display: inline-block;
    font-family: var(--font-mono);
    font-size: 0.65rem;
    font-weight: 500;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: #b54a32;
    border: 1px solid #b54a32;
    border-radius: 2px;
    padding: 0.2rem 0.5rem;
    margin-bottom: 1rem;
  }

  .report-meta {
    display: flex;
    gap: 1.5rem;
    font-size: 0.9rem;
    color: #7a756e;
    margin-top: 0.5rem;
  }

  .verdict-section { text-align: center; margin: 2rem 0; }
  .verdict-badge {
    display: inline-block;
    font-family: var(--font-display);
    font-size: 1.4rem;
    font-weight: 700;
    padding: 0.5rem 1.5rem;
    border-radius: 6px;
  }
  .verdict-strongly_favorable, .verdict-strong_buy { color: #1a5c36; background: #d4edda; border: 1px solid #1a5c36; }
  .verdict-favorable, .verdict-buy { color: #2d6a4f; background: #e8f5e9; border: 1px solid #2d6a4f; }
  .verdict-mixed, .verdict-hold { color: #b58a1b; background: #fff8e1; border: 1px solid #b58a1b; }
  .verdict-unfavorable, .verdict-pass { color: #c53030; background: #fee2e2; border: 1px solid #c53030; }
  .verdict-strongly_unfavorable, .verdict-strong_pass { color: #7f1d1d; background: #fecaca; border: 1px solid #7f1d1d; }

  .memo-subsection { margin: 1rem 0; }
  .memo-subsection.caveat {
    background: #fff8e1;
    border: 1px solid #b58a1b;
    border-radius: 4px;
    padding: 0.8rem 1rem;
    margin: 1rem 0;
  }
  .memo-subsection.caveat h3 { color: #b58a1b; border: none; margin-top: 0; }

  .risk-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem; margin: 0.75rem 0; }
  .risk-category { padding: 0.75rem; border: 1px solid #e8e4df; border-radius: 4px; }
  .risk-cat-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.4rem; }
  .risk-level { font-size: 0.8rem; font-weight: 600; text-transform: capitalize; }
  .risk-low { color: #2d6a4f; }
  .risk-moderate { color: #b58a1b; }
  .risk-high { color: #c53030; }
  .risk-very-high { color: #7f1d1d; }
  .risk-category p { font-size: 0.85rem; color: #5a564f; margin: 0; }

  .votes-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem; margin: 0.75rem 0; }
  .vote-card { padding: 0.75rem; border: 1px solid #e8e4df; border-radius: 4px; }
  .vote-card-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.25rem; }
  .vote-role { font-size: 0.75rem; color: #7a756e; }
  .vote-verdict { font-size: 0.85rem; color: #5a564f; margin-bottom: 0.4rem; }
  .vote-card p { font-size: 0.85rem; color: #5a564f; margin: 0; }

  .debate-exchange { margin: 0.5rem 0; }
  .debate-exchange strong { color: #2d2a26; }

  .report-footer {
    margin-top: 3rem;
    padding: 1rem 0;
    border-top: 1px solid #e8e4df;
    text-align: center;
    font-family: var(--font-mono);
    font-size: 0.7rem;
    color: #a09b94;
  }

  .print-btn {
    position: fixed;
    bottom: 2rem;
    right: 2rem;
    padding: 0.75rem 1.5rem;
    background: #2d2a26;
    color: #fff;
    border: none;
    border-radius: 6px;
    font-family: var(--font-body);
    font-size: 0.9rem;
    cursor: pointer;
  }
  .print-btn:hover { background: #4a4640; }
</style>
</head>
<body>
${sections.join("\n")}

<footer class="report-footer">
  AI-generated analysis based on user-provided information. Not investment advice.<br/>
  Generated by Million Minds &middot; ${date}
</footer>

<button class="print-btn no-print" onclick="window.print()">Print / Save as PDF</button>
</body>
</html>`;

  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Disposition": `inline; filename="${slug}-analysis.html"`,
    },
  });
}
