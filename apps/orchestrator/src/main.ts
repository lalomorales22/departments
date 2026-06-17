/**
 * @departments/orchestrator — the Temporal worker host entrypoint.
 *
 * Phase 2: this boots a Temporal {@link runWorker | Worker} that runs the durable
 * `loopWorkflow` (one instance per Loop) and its `runCycleActivity` (which ticks the
 * `@departments/orchestration` engine — PLAN→EXECUTE→EVALUATE→IMPROVE→MEMORY — one
 * cycle per call). The worker connects to `TEMPORAL_ADDRESS` (the `temporal` service in
 * docker-compose.yml, default `127.0.0.1:7233`).
 *
 * Degrades cleanly WITHOUT Docker: if the Temporal frontend is unreachable we log a
 * clear hint and exit 0 (idle), so `pnpm dev` doesn't crash the monorepo when the dev
 * stack isn't up. A reachable-but-failing worker still surfaces as a non-zero exit.
 */
import { runWorker, temporalAddress } from './worker';

/** Connection-shaped failures we treat as "Temporal not running" (clean idle exit). */
function isConnectionFailure(err: unknown): boolean {
  const msg = err instanceof Error ? `${err.message}` : String(err);
  return (
    /ECONNREFUSED|ENOTFOUND|EAI_AGAIN|UNAVAILABLE|Connection refused|deadline|failed to connect|Failed to connect|getaddrinfo|14 UNAVAILABLE/i.test(
      msg,
    ) || (err as { code?: string } | null)?.code === 'ECONNREFUSED'
  );
}

async function main(): Promise<void> {
  try {
    await runWorker();
  } catch (err) {
    if (isConnectionFailure(err)) {
      // eslint-disable-next-line no-console
      console.warn(
        `[orchestrator] Temporal not reachable at ${temporalAddress()} ` +
          `(start the dev stack: docker compose up -d) — orchestrator idle.`,
      );
      process.exit(0);
    }
    // A real fault (bad workflow bundle, activity registration error, etc.) — fail loud.
    // eslint-disable-next-line no-console
    console.error('[orchestrator] worker crashed:', err);
    process.exit(1);
  }
}

void main();
