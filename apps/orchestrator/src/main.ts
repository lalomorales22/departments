/**
 * @departments/orchestrator — Phase 1 STUB (empty workflow host).
 *
 * In Phase 2 this becomes a Temporal worker host: it registers workflows +
 * activities, connects to the Temporal cluster (see TEMPORAL_ADDRESS, served by
 * the `temporal` service in docker-compose.yml), and runs the per-loop engine.
 *
 * The `@temporalio/*` packages (worker, workflow, client, activity) are
 * intentionally NOT dependencies yet — they are added in Phase 2. For now this
 * file only logs and exits so the monorepo typechecks and the topology is real.
 */
import type { Id } from '@departments/shared';

/**
 * Placeholder signature for the per-loop workflow. NOT wired to Temporal yet.
 *
 * Phase 2: decorate/register as a Temporal Workflow. It drives the loop through
 * the frozen PIPELINE phases, emits `DeptEvent`s onto the loop's Redis Stream,
 * and reacts to control signals (see `runNow`).
 *
 * @param loopId the loop this workflow instance orchestrates.
 */
export async function LoopWorkflow(loopId: Id<'Loop'>): Promise<void> {
  // TODO(Phase 2): register as a Temporal Workflow and run the loop engine.
  void loopId;
}

/**
 * Placeholder for the `run_now` control signal. NOT wired to Temporal yet.
 *
 * Phase 2: expose as a Temporal Signal handler on `LoopWorkflow` so an operator
 * can force an immediate cycle (gated by RBAC at the gateway). Kept un-wired and
 * unexported-as-a-signal here; only the shape is committed.
 */
// export const runNow = defineSignal<[reason?: string]>('run_now'); // Phase 2

function bootstrap(): void {
  // eslint-disable-next-line no-console
  console.log('[orchestrator] stub (Temporal worker host arrives in Phase 2)');
}

bootstrap();
