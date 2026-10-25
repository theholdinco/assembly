import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  verifyAccessCode,
  createPulseAccessToken,
  verifyPulseAccessToken,
  isPulseAccessConfigured,
} from "../auth";

const saved = { ...process.env };

describe("pulse access gate", () => {
  beforeEach(() => {
    process.env.PULSE_ACCESS_CODE = "test-code-for-unit-tests";
    process.env.AUTH_SECRET = "test-secret-for-unit-tests";
    delete process.env.NEXTAUTH_SECRET;
  });
  afterEach(() => {
    process.env = { ...saved };
  });

  it("fails closed when the access code is not configured", () => {
    delete process.env.PULSE_ACCESS_CODE;
    expect(isPulseAccessConfigured()).toBe(false);
    expect(verifyAccessCode("pulse2026")).toBe(false);
    expect(verifyAccessCode("")).toBe(false);
    expect(createPulseAccessToken()).toBeNull();
  });

  it("fails closed when no server secret is configured", () => {
    delete process.env.AUTH_SECRET;
    expect(isPulseAccessConfigured()).toBe(false);
    expect(verifyAccessCode("test-code-for-unit-tests")).toBe(false);
  });

  it("accepts only the configured code", () => {
    expect(verifyAccessCode("test-code-for-unit-tests")).toBe(true);
    expect(verifyAccessCode("pulse2026")).toBe(false);
    expect(verifyAccessCode("test-code-for-unit-test")).toBe(false);
    expect(verifyAccessCode(undefined)).toBe(false);
    expect(verifyAccessCode({})).toBe(false);
  });

  it("issues a cookie value that verifies, and rejects the old constant", () => {
    const token = createPulseAccessToken();
    expect(token).toBeTruthy();
    expect(verifyPulseAccessToken(token)).toBe(true);
    expect(verifyPulseAccessToken("granted")).toBe(false);
    expect(verifyPulseAccessToken(undefined)).toBe(false);
  });

  it("rejects tampered and expired cookie values", () => {
    const now = Date.now();
    const token = createPulseAccessToken(now)!;
    const [v, exp, sig] = token.split(".");
    expect(verifyPulseAccessToken(`${v}.${Number(exp) + 1000}.${sig}`, now)).toBe(false);
    expect(verifyPulseAccessToken(`${v}.${exp}.${sig.slice(0, -2)}AA`, now)).toBe(false);
    expect(verifyPulseAccessToken(token, (Number(exp) + 1) * 1000)).toBe(false);
  });

  it("invalidates issued cookies when the access code is rotated", () => {
    const token = createPulseAccessToken();
    process.env.PULSE_ACCESS_CODE = "rotated-code";
    expect(verifyPulseAccessToken(token)).toBe(false);
  });
});
