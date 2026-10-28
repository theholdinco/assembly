import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { pulseUnauthorized } from "@/lib/pulse/auth";

const MIN_SCAN_INTERVAL_MINUTES = 10;

export async function POST() {
  const unauthorized = await pulseUnauthorized();
  if (unauthorized) return unauthorized;

  const recent = await query<{ id: string }>(
    `SELECT id FROM pulse_scans
     WHERE created_at > NOW() - INTERVAL '${MIN_SCAN_INTERVAL_MINUTES} minutes'
     LIMIT 1`
  );
  if (recent.length > 0) {
    return NextResponse.json(
      { error: `A scan was already started in the last ${MIN_SCAN_INTERVAL_MINUTES} minutes. Please wait.` },
      { status: 429 }
    );
  }

  const rows = await query<{ id: string }>(
    `INSERT INTO pulse_scans (trigger_type, status)
     VALUES ('manual', 'queued')
     RETURNING id`
  );

  return NextResponse.json({ id: rows[0].id }, { status: 201 });
}
