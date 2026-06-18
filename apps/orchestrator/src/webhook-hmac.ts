/**
 * webhook-hmac.ts — PURE, dependency-free HMAC-SHA256 sign/verify (Phase 4 webhooks).
 *
 * An external trigger (a CI hook, a cron, a partner system) can wake a loop's next cycle
 * by POSTing `{loopId}` to the orchestrator's webhook receiver (see `./webhook.ts`). The
 * request is authenticated with a shared-secret HMAC over the raw body so only a holder of
 * `DEPT_WEBHOOK_SECRET` can fire a `run_now` — no creds, no signature, no signal.
 *
 * This module is intentionally PURE (node:crypto only): no IO, no env, no Temporal. It is
 * the unit-tested core the receiver composes. Verification uses `crypto.timingSafeEqual`
 * to avoid leaking the secret through string-compare timing, guarding the length mismatch
 * that `timingSafeEqual` itself throws on.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

/** Compute the hex HMAC-SHA256 of `body` under `secret`. The wire signature format. */
export function signPayload(secret: string, body: string): string {
  return createHmac('sha256', secret).update(body, 'utf8').digest('hex');
}

/**
 * Verify `signature` is the HMAC-SHA256 of `body` under `secret`, in constant time.
 *
 * `crypto.timingSafeEqual` THROWS if the two buffers differ in length, which would both
 * leak length and crash the receiver — so we compare lengths first (a cheap, non-secret
 * check: the expected length is fixed at 64 hex chars) and only then do the timing-safe
 * byte compare. A malformed/short/long signature returns `false`, never throws.
 */
export function verifyHmac(secret: string, body: string, signature: string): boolean {
  const expected = signPayload(secret, body);
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(signature, 'utf8');
  // Length guard: timingSafeEqual requires equal-length buffers (else it throws). Bailing
  // here is safe — the expected length is public (64 hex chars), so this leaks nothing.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
