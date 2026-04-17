import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth-helpers";
import { query } from "@/lib/db";

export async function PATCH(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();

  const rows = await query<{ id: string }>(
    `UPDATE clo_profiles
     SET equity_inception_data = $1, updated_at = now()
     WHERE user_id = $2
     RETURNING id`,
    [JSON.stringify(body.equityInceptionData), user.id]
  );

  if (rows.length === 0) {
    return NextResponse.json({ error: "Profile not found" }, { status: 404 });
  }

  return NextResponse.json({ profileId: rows[0].id });
}
