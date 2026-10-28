import { NextRequest, NextResponse } from "next/server";
import {
  verifyAccessCode,
  createPulseAccessToken,
  isPulseAccessConfigured,
  COOKIE_NAME,
  PULSE_ACCESS_MAX_AGE_SECONDS,
} from "@/lib/pulse/auth";

export async function POST(request: NextRequest) {
  if (!isPulseAccessConfigured()) {
    console.error("[pulse/access] PULSE_ACCESS_CODE or AUTH_SECRET is not set; Pulse access is disabled");
  }

  const body = await request.json().catch(() => null);
  const code = typeof body?.code === "string" ? body.code.trim() : "";

  const token = code && verifyAccessCode(code) ? createPulseAccessToken() : null;
  if (!token) {
    return NextResponse.json({ error: "Invalid access code" }, { status: 403 });
  }

  const response = NextResponse.json({ success: true });
  response.cookies.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: PULSE_ACCESS_MAX_AGE_SECONDS,
    path: "/",
  });

  return response;
}
