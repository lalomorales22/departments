/**
 * The Temporal Worker host.
 *
 * A Worker polls the `departments` task queue, runs `loopWorkflow` (bundled from
 * `./workflows`) deterministically, and executes its activities (`./activities`) in
 * this Node process where real I/O is allowed. One worker fleet serves every loop's
 * workflow; the workflow-per-loop fan-out is a Temporal scheduling concern, not a
 * process-per-loop one.
 */
import { createRequire } from 'node:module';
import { NativeConnection, Worker } from '@temporalio/worker';
import { activities } from './activities';

// `require.resolve` for the workflow bundle path, made available in this ESM module.
const require = createRequire(import.meta.url);

/** Task queue the LoopWorkflow + its activities are registered on. */
export const TASK_QUEUE = 'departments';

/** Temporal frontend address; the dev stack exposes `127.0.0.1:7233`. */
export function temporalAddress(): string {
  return process.env.TEMPORAL_ADDRESS ?? '127.0.0.1:7233';
}

/**
 * Create and run the Worker until the process is signalled. Resolves only when the
 * worker shuts down; rejects if it cannot connect (the caller in `main.ts` degrades
 * that into a clean idle exit so the orchestrator runs without Docker).
 */
export async function runWorker(): Promise<void> {
  const connection = await NativeConnection.connect({ address: temporalAddress() });
  try {
    const worker = await Worker.create({
      connection,
      namespace: process.env.TEMPORAL_NAMESPACE ?? 'default',
      taskQueue: TASK_QUEUE,
      // The workflow bundle is built from this module path (separate from activities,
      // which run in the Node sandbox). Extensionless on purpose — the bundler resolves it.
      workflowsPath: require.resolve('./workflows'),
      activities,
    });
    // eslint-disable-next-line no-console
    console.log(`[orchestrator] worker polling task queue "${TASK_QUEUE}" at ${temporalAddress()}`);
    await worker.run();
  } finally {
    await connection.close();
  }
}
