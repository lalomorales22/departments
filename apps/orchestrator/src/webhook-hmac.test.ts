import { describe, expect, it } from 'vitest';
import { signPayload, verifyHmac } from './webhook-hmac.js';

const SECRET = 'super-secret-shared-key';
const BODY = JSON.stringify({ loopId: 'marketing' });

describe('signPayload', () => {
  it('produces a stable 64-char lowercase hex HMAC-SHA256', () => {
    const sig = signPayload(SECRET, BODY);
    expect(sig).toMatch(/^[0-9a-f]{64}$/);
    // Deterministic: the same (secret, body) always signs to the same value.
    expect(signPayload(SECRET, BODY)).toBe(sig);
  });

  it('changes with the secret and with the body', () => {
    const base = signPayload(SECRET, BODY);
    expect(signPayload('different-secret', BODY)).not.toBe(base);
    expect(signPayload(SECRET, JSON.stringify({ loopId: 'sales' }))).not.toBe(base);
  });
});

describe('verifyHmac', () => {
  it('verifies a correct signature', () => {
    const sig = signPayload(SECRET, BODY);
    expect(verifyHmac(SECRET, BODY, sig)).toBe(true);
  });

  it('rejects a tampered body (same signature)', () => {
    const sig = signPayload(SECRET, BODY);
    const tamperedBody = JSON.stringify({ loopId: 'marketing', evil: true });
    expect(verifyHmac(SECRET, tamperedBody, sig)).toBe(false);
  });

  it('rejects a tampered signature (flip one hex digit)', () => {
    const sig = signPayload(SECRET, BODY);
    const flipped = (sig[0] === 'a' ? 'b' : 'a') + sig.slice(1);
    expect(verifyHmac(SECRET, BODY, flipped)).toBe(false);
  });

  it('rejects a signature made with the wrong secret', () => {
    const wrong = signPayload('not-the-secret', BODY);
    expect(verifyHmac(SECRET, BODY, wrong)).toBe(false);
  });

  it('timing-safe compare handles unequal lengths WITHOUT throwing (returns false)', () => {
    // crypto.timingSafeEqual throws on length mismatch; the length guard must catch it.
    expect(() => verifyHmac(SECRET, BODY, '')).not.toThrow();
    expect(verifyHmac(SECRET, BODY, '')).toBe(false);
    expect(verifyHmac(SECRET, BODY, 'short')).toBe(false);
    expect(verifyHmac(SECRET, BODY, 'f'.repeat(128))).toBe(false);
    // A non-hex, correct-length string is still rejected (and never throws).
    expect(() => verifyHmac(SECRET, BODY, 'z'.repeat(64))).not.toThrow();
    expect(verifyHmac(SECRET, BODY, 'z'.repeat(64))).toBe(false);
  });
});
