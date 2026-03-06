import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth-helpers";
import { query } from "@/lib/db";
import { decryptApiKey } from "@/lib/crypto";
import { verifyPanelAccess } from "@/lib/clo/access";
import { processAnthropicStream } from "@/lib/claude-stream";

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { panelId, dealContext } = body;

  if (!panelId) {
    return NextResponse.json({ error: "Missing panelId" }, { status: 400 });
  }

  const hasAccess = await verifyPanelAccess(panelId, user.id);
  if (!hasAccess) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const userRows = await query<{ encrypted_api_key: Buffer; api_key_iv: Buffer }>(
    "SELECT encrypted_api_key, api_key_iv FROM users WHERE id = $1",
    [user.id]
  );

  if (!userRows.length || !userRows[0].encrypted_api_key) {
    return NextResponse.json({ error: "No API key configured" }, { status: 400 });
  }

  const apiKey = decryptApiKey(userRows[0].encrypted_api_key, userRows[0].api_key_iv);

  const systemPrompt = `You are a CLO data quality analyst. Analyze the provided deal data and identify issues that could affect waterfall projection accuracy.

Check for:
1. Missing required fields needed for the waterfall model (maturity date, tranche balances, spreads, OC/IC trigger levels)
2. Cross-reference values for consistency (total tranche principal vs pool total par, test levels matching PPM data)
3. Anything that looks unusual for a CLO deal (e.g., abnormally low/high WAC spread, missing tranches, zero balances)
4. Missing waterfall steps or compliance test data

Output a JSON array of warnings. Each warning must have:
- "severity": "error" (blocking — model can't run), "warning" (model runs but may be wrong), or "info" (FYI)
- "message": brief description of the issue
- "action": what the user should do to fix it

Only output the JSON array, nothing else. If no issues found, output an empty array [].
Keep it concise — at most 5-6 warnings for the most important issues.`;

  const contextSummary = summarizeDealContext(dealContext);

  const anthropicResponse = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 2048,
      system: systemPrompt,
      messages: [{ role: "user", content: `Analyze this CLO deal data for quality issues:\n\n${contextSummary}` }],
      stream: true,
    }),
  });

  if (!anthropicResponse.ok) {
    const errorText = await anthropicResponse.text();
    return NextResponse.json(
      { error: "API error", details: errorText },
      { status: anthropicResponse.status }
    );
  }

  const reader = anthropicResponse.body?.getReader();
  if (!reader) {
    return NextResponse.json({ error: "No response stream" }, { status: 500 });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      await processAnthropicStream(reader, controller, encoder);
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "done" })}\n\n`));
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function summarizeDealContext(ctx: Record<string, any>): string {
  const parts: string[] = [];

  parts.push(`Deal: ${ctx.dealName ?? "UNKNOWN"}`);
  parts.push(`Report Date: ${ctx.reportDate ?? "MISSING"}`);
  parts.push(`Maturity Date: ${ctx.maturityDate ?? "MISSING"}`);
  parts.push(`Reinvestment Period End: ${ctx.reinvestmentPeriodEnd ?? "MISSING"}`);

  // Pool summary — list non-null fields
  const pool = ctx.poolSummary;
  if (pool) {
    const populated = Object.entries(pool).filter(([, v]) => v != null);
    if (populated.length === 0) {
      parts.push("\nPool Summary: ALL FIELDS NULL");
    } else {
      parts.push(`\nPool Summary (${populated.length} fields populated):`);
      for (const [k, v] of populated) {
        parts.push(`  ${k}: ${v}`);
      }
    }
  } else {
    parts.push("\nPool Summary: MISSING (no report period data)");
  }

  // Tranches — compact summary
  const tranches = ctx.tranches as any[] | undefined;
  const trancheById = new Map<string, any>();
  if (tranches && tranches.length > 0) {
    parts.push(`\nTranches (${tranches.length}):`);
    for (const t of tranches) {
      trancheById.set(t.id, t);
      parts.push(`  ${t.className ?? "?"}: balance=${t.originalBalance ?? "NULL"}, spread=${t.spreadBps ?? "NULL"}bps, floating=${t.isFloating ?? "?"}, rank=${t.seniorityRank ?? "?"}, isIncomeNote=${t.isIncomeNote ?? "?"}`);
    }
  } else {
    parts.push("\nTranches: NONE");
  }

  // Tranche snapshots
  const snaps = ctx.trancheSnapshots as any[] | undefined;
  if (snaps && snaps.length > 0) {
    parts.push(`\nTranche Snapshots (${snaps.length}):`);
    for (const s of snaps) {
      const trancheName = trancheById.get(s.trancheId)?.className ?? s.trancheId ?? "?";
      parts.push(`  ${trancheName}: curBal=${s.currentBalance ?? "NULL"}, beginBal=${s.beginningBalance ?? "NULL"}, endBal=${s.endingBalance ?? "NULL"}, intPaid=${s.interestPaid ?? "NULL"}, princPaid=${s.principalPaid ?? "NULL"}`);
    }
  } else {
    parts.push("\nTranche Snapshots: NONE");
  }

  // Compliance tests — compact
  const tests = ctx.complianceTests as any[] | undefined;
  if (tests && tests.length > 0) {
    parts.push(`\nCompliance Tests (${tests.length}):`);
    for (const t of tests) {
      parts.push(`  ${t.testName}${t.testClass ? ` (${t.testClass})` : ""}: actual=${t.actualValue ?? "NULL"}, trigger=${t.triggerLevel ?? "NULL"}, passing=${t.isPassing ?? "NULL"}`);
    }
  } else {
    parts.push("\nCompliance Tests: NONE");
  }

  // Account balances
  const accts = ctx.accountBalances as any[] | undefined;
  if (accts && accts.length > 0) {
    parts.push(`\nAccount Balances (${accts.length}):`);
    for (const a of accts) {
      parts.push(`  ${a.accountName}: ${a.balanceAmount ?? "NULL"} ${a.currency ?? ""}`);
    }
  } else {
    parts.push("\nAccount Balances: NONE");
  }

  // Key constraints from PPM (compact)
  const c = ctx.constraints;
  if (c) {
    if (c.keyDates) parts.push(`\nPPM Key Dates: ${JSON.stringify(c.keyDates)}`);
    if (c.capitalStructure) {
      parts.push(`PPM Capital Structure (${Array.isArray(c.capitalStructure) ? c.capitalStructure.length : 0} tranches)`);
    }
    if (c.coverageTestEntries) {
      parts.push(`PPM Coverage Tests: ${JSON.stringify(c.coverageTestEntries).slice(0, 500)}`);
    }
  }

  return parts.join("\n");
}
