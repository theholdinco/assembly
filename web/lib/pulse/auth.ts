import { createHash, createHmac, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

// Pulse is gated by a shared access code (PULSE_ACCESS_CODE). Entering the code
// sets an HMAC-signed, expiring cookie. The gate fails closed: with no access
// code or no server secret configured, nobody gets in.

const COOKIE_NAME = "pulse_access";
const PULSE_ACCESS_MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days
const TOKEN_VERSION = "v1";

function configuredAccessCode(): string | null {
  const code = process.env.PULSE_ACCESS_CODE?.trim();
  return code ? code : null;
}

function serverSecret(): string | null {
  return process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET || null;
}

// Derived from the server secret and the current access code, so rotating either
// one invalidates every cookie issued before.
function signingKey(): Buffer | null {
  const code = configuredAccessCode();
  const secret = serverSecret();
  if (!code || !secret) return null;
  return createHmac("sha256", secret).update(`pulse-access-cookie:${code}`).digest();
}

function sign(key: Buffer, payload: string): string {
  return createHmac("sha256", key).update(payload).digest("base64url");
}

// Constant-time string comparison (hashing first makes the lengths equal).
function safeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

export function isPulseAccessConfigured(): boolean {
  return signingKey() !== null;
}

export function verifyAccessCode(code: unknown): boolean {
  const expected = configuredAccessCode();
  if (!expected || !isPulseAccessConfigured() || typeof code !== "string") return false;
  return safeEqual(code, expected);
}

export function createPulseAccessToken(now: number = Date.now()): string | null {
  const key = signingKey();
  if (!key) return null;
  const exp = Math.floor(now / 1000) + PULSE_ACCESS_MAX_AGE_SECONDS;
  const payload = `${TOKEN_VERSION}.${exp}`;
  return `${payload}.${sign(key, payload)}`;
}

export function verifyPulseAccessToken(token: string | null | undefined, now: number = Date.now()): boolean {
  if (!token) return false;
  const key = signingKey();
  if (!key) return false;
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== TOKEN_VERSION || !/^\d{1,12}$/.test(parts[1])) return false;
  if (Number(parts[1]) * 1000 <= now) return false;
  return safeEqual(parts[2], sign(key, `${parts[0]}.${parts[1]}`));
}

export async function hasPulseAccess(): Promise<boolean> {
  const cookieStore = await cookies();
  return verifyPulseAccessToken(cookieStore.get(COOKIE_NAME)?.value);
}

/** For API routes: a 401 response when the caller has no valid Pulse cookie, else null. */
export async function pulseUnauthorized(): Promise<NextResponse | null> {
  if (await hasPulseAccess()) return null;
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

export { COOKIE_NAME, PULSE_ACCESS_MAX_AGE_SECONDS };
