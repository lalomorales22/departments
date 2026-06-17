/**
 * The resumable, idempotent bootstrap sequence (see README "bootstrap sequence"):
 *   1. HANDOFF.md exists?  → resume at the next cycle.
 *   2. else README.md exists? → parse project (loaded by PLAN); seed missing artifacts.
 *   3. TASKS.md exists?   → loaded by PLAN; else generated from README.
 *   4. cold start: seed README/TASKS/HANDOFF.
 */
import type { ArtifactPort } from './ports.js';

export interface BootstrapResult {
  /** Cycle to run next (last completed + 1, or 1 on cold start). */
  cycle: number;
  /** True if we resumed from an existing HANDOFF.md. */
  resumed: boolean;
  /** True if no README existed (a genuine cold start). */
  cold: boolean;
}

const CYCLE_RE = /Cycle:\s*(\d+)/i;

export async function bootstrap(
  loopId: string,
  artifacts: ArtifactPort,
  seeds: Record<string, string>,
): Promise<BootstrapResult> {
  await artifacts.provision(loopId);

  const handoff = await artifacts.read(loopId, 'HANDOFF.md');
  if (handoff) {
    const match = CYCLE_RE.exec(handoff);
    const lastCycle = match ? Number.parseInt(match[1] ?? '0', 10) : 0;
    return { cycle: lastCycle + 1, resumed: true, cold: false };
  }

  const readme = await artifacts.read(loopId, 'README.md');
  await artifacts.seedIfEmpty(loopId, seeds);
  return { cycle: 1, resumed: false, cold: readme === null };
}
