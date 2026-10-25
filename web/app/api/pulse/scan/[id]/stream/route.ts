import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { pulseUnauthorized } from "@/lib/pulse/auth";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const unauthorized = await pulseUnauthorized();
  if (unauthorized) return unauthorized;

  const { id } = await params;

  const check = await query<{ id: string }>(
    "SELECT id FROM pulse_scans WHERE id = $1",
    [id]
  );
  if (check.length === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      const maxAttempts = 900;

      for (let attempts = 0; attempts < maxAttempts; attempts++) {
        const rows = await query<{
          status: string;
          current_phase: string | null;
          raw_files: Record<string, string> | null;
          signals_found: number;
          movements_created: number;
          movements_updated: number;
          error_message: string | null;
        }>(
          "SELECT status, current_phase, raw_files, signals_found, movements_created, movements_updated, error_message FROM pulse_scans WHERE id = $1",
          [id]
        );

        if (rows.length === 0) {
          send({ status: "error", message: "Scan not found" });
          controller.close();
          return;
        }

        const { status, current_phase, raw_files, signals_found, movements_created, movements_updated, error_message } = rows[0];
        const completedPhases = raw_files
          ? Object.keys(raw_files).map((k) => k.replace(/\.json$/, ""))
          : [];

        send({
          status,
          currentPhase: current_phase,
          phases: completedPhases,
          signalsFound: signals_found,
          movementsCreated: movements_created,
          movementsUpdated: movements_updated,
        });

        if (status === "complete") {
          send({ status: "complete", signalsFound: signals_found, movementsCreated: movements_created, movementsUpdated: movements_updated });
          controller.close();
          return;
        }

        if (status === "error") {
          send({ status: "error", message: error_message || "Scan failed" });
          controller.close();
          return;
        }

        await new Promise((r) => setTimeout(r, 2000));
      }

      send({ status: "error", message: "Timeout waiting for scan" });
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
