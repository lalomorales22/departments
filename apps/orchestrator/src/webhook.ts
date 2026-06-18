/**
 * webhook.ts — an HMAC-authenticated HTTP receiver that fires `run_now` on a loop.
 *
 * An external trigger (CI, cron, a partner system) wakes a loop's next cycle by POSTing
 * `{"loopId":"…"}` with an `X-Departments-Signature: <hex>` header that is the HMAC-SHA256
 * of the raw request body under the shared `DEPT_WEBHOOK_SECRET`. On a VALID signature the
 * receiver sends the `runNow` signal to the durable workflow `loop-${loopId}` (the same
 * signal the cockpit's "run now" button raises), which wakes a workflow idling on its
 * cadence floor (see the IDLE_WAIT in `./workflows`).
 *
 * ── Gating (fail loud, never silently no-op a real path) ────────────────────────
 * The signature check is ALWAYS enforced — an unsigned/bad request is rejected (401),
 * never honored. What's GATED is the durable side effect:
 *   - No `DEPT_WEBHOOK_SECRET`  → there is no way to authenticate anything, so the receiver
 *     refuses to start a SIGNAL path and runs as an explicit no-op (logs once, 503s the
 *     signal route). It does NOT fabricate a run_now.
 *   - No reachable `TEMPORAL_ADDRESS` → a valid request still can't be delivered; the
 *     signal attempt surfaces the connection error as a 502 (the caller can retry) rather
 *     than pretending success.
 * This mirrors the worker's connection-as-clean-degradation: the process never crashes on
 * a missing dev stack, but it never lies about having signalled either.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { Connection, WorkflowClient } from '@temporalio/client';
import { verifyHmac } from './webhook-hmac.js';

/** The signature header the sender must set (hex HMAC-SHA256 of the raw body). */
export const SIGNATURE_HEADER = 'x-departments-signature';

/** Temporal frontend address; the dev stack exposes `127.0.0.1:7233`. */
function temporalAddress(): string {
  return process.env.TEMPORAL_ADDRESS ?? '127.0.0.1:7233';
}

/** Webhook port; defaults to 4100 (distinct from the gateway's 4000). */
export function webhookPort(): number {
  return Number(process.env.DEPT_WEBHOOK_PORT ?? 4100);
}

/** Read the full request body as a UTF-8 string (bounded to avoid unbounded buffering). */
async function readBody(req: IncomingMessage, maxBytes = 64 * 1024): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    req.on('data', (chunk: Buffer) => {
      total += chunk.length;
      if (total > maxBytes) {
        reject(new Error('webhook body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(payload);
}

/**
 * Deliver a `runNow` signal to the durable workflow `loop-${loopId}`. Opens a short-lived
 * client connection per call (the webhook is low-volume). Throws on a connection/RPC fault
 * so the route can surface it as a 502 (no silent success).
 */
export async function signalRunNow(loopId: string): Promise<void> {
  const connection = await Connection.connect({ address: temporalAddress() });
  try {
    const client = new WorkflowClient({
      connection,
      namespace: process.env.TEMPORAL_NAMESPACE ?? 'default',
    });
    const handle = client.getHandle(`loop-${loopId}`);
    // Plain string signal name — matches `defineSignal('runNow')` in ./workflows without
    // importing workflow-sandbox code into this Node module.
    await handle.signal('runNow');
  } finally {
    await connection.close();
  }
}

/**
 * Build (but do not start) the receiver. Returns a node:http Server with a single
 * `POST /webhook/run-now` route. Pure-ish: it reads `DEPT_WEBHOOK_SECRET` per request so a
 * test can set the env before a call.
 */
export function createWebhookServer(): Server {
  return createServer((req: IncomingMessage, res: ServerResponse): void => {
    void (async (): Promise<void> => {
      if (req.method === 'GET' && req.url === '/health') {
        json(res, 200, { status: 'ok', service: 'orchestrator-webhook' });
        return;
      }
      if (req.method !== 'POST' || req.url !== '/webhook/run-now') {
        json(res, 404, { error: 'not found' });
        return;
      }

      const secret = process.env.DEPT_WEBHOOK_SECRET;
      if (!secret) {
        // GATED: no secret means no way to authenticate — refuse the signal path rather
        // than honor an unauthenticated trigger. Explicit no-op, not a silent one.
        // eslint-disable-next-line no-console
        console.warn('[webhook] DEPT_WEBHOOK_SECRET unset — run_now webhook disabled (no-op).');
        json(res, 503, { error: 'webhook disabled: DEPT_WEBHOOK_SECRET not configured' });
        return;
      }

      let body: string;
      try {
        body = await readBody(req);
      } catch (err) {
        json(res, 413, { error: err instanceof Error ? err.message : 'bad request body' });
        return;
      }

      const signature = req.headers[SIGNATURE_HEADER];
      const sig = Array.isArray(signature) ? (signature[0] ?? '') : (signature ?? '');
      if (!verifyHmac(secret, body, sig)) {
        json(res, 401, { error: 'invalid signature' });
        return;
      }

      let loopId: string;
      try {
        const parsed = JSON.parse(body) as { loopId?: unknown };
        if (typeof parsed.loopId !== 'string' || parsed.loopId.length === 0) {
          json(res, 400, { error: 'missing or invalid "loopId"' });
          return;
        }
        loopId = parsed.loopId;
      } catch {
        json(res, 400, { error: 'body is not valid JSON' });
        return;
      }

      try {
        await signalRunNow(loopId);
        json(res, 202, { ok: true, loopId, signalled: 'runNow' });
      } catch (err) {
        // A reachable signature but unreachable Temporal — surface, don't fake success.
        // eslint-disable-next-line no-console
        console.error(`[webhook] failed to signal loop-${loopId}:`, err);
        json(res, 502, { error: 'failed to deliver run_now (Temporal unreachable?)' });
      }
    })();
  });
}

/**
 * Start the receiver. Gated: with NO `DEPT_WEBHOOK_SECRET` the server still listens (so a
 * health probe works) but every signal request 503s — a documented, explicit no-op
 * receiver that never crashes the orchestrator when the dev stack/secret isn't present.
 */
export async function runWebhook(): Promise<Server> {
  const server = createWebhookServer();
  const port = webhookPort();
  await new Promise<void>((resolve) => server.listen(port, resolve));
  // eslint-disable-next-line no-console
  console.log(
    `[webhook] listening on :${port} (POST /webhook/run-now)` +
      (process.env.DEPT_WEBHOOK_SECRET ? '' : ' — DISABLED: set DEPT_WEBHOOK_SECRET to enable'),
  );
  return server;
}
