/**
 * Loop Engine CLI. Runs real cycles against the local driver (FakeCmaRuntime + real
 * git artifacts).
 *
 *   pnpm --filter @departments/orchestration loop:run software-builder            # human summary
 *   pnpm --filter @departments/orchestration loop:run software-builder --cycles 3
 *   tsx src/cli.ts marketing --stream                                             # NDJSON events
 *   tsx src/cli.ts marketing --stream --step                                      # manual single-step (stdin)
 *   tsx src/cli.ts marketing --stream --stall --cycles 5                          # demo no-progress auto-pause
 *
 * In --stream mode ONLY newline-delimited DeptEvent JSON goes to stdout (the cockpit's
 * run-a-loop route relays it); all human text goes to stderr.
 *
 * --step: pause before EVERY phase and wait for a newline on stdin to advance one step
 * (the cockpit's `/step` route writes a newline to this process's stdin). --stall:
 * simulate a stuck loop so the no-progress detector auto-pauses.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { defaultArtifactsRoot } from '@departments/artifacts';
import { FakeCmaRuntime } from '@departments/agent-runtime';
import type { DeptEvent } from '@departments/events';
import { runLoopLocally } from './local-driver.js';
import { ManualStepGate } from './step-gate.js';

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const loopId = args.find((a) => !a.startsWith('-')) ?? 'software-builder';
  const stream = args.includes('--stream');
  const step = args.includes('--step');
  const stall = args.includes('--stall');
  const cycles = Number(flag(args, '--cycles') ?? '1') || 1;
  const mission = flag(args, '--mission');

  const out = (s: string) => process.stdout.write(s);
  const err = (s: string) => process.stderr.write(s);

  const onEvent = stream ? (e: DeptEvent) => out(`${JSON.stringify(e)}\n`) : undefined;
  if (!stream) err(`▶ loop "${loopId}" · ${cycles} cycle(s)${step ? ' · STEP' : ''}${stall ? ' · STALL' : ''}\n`);

  // Manual single-step: each newline on stdin advances one phase.
  let stepGate: ManualStepGate | undefined;
  if (step) {
    stepGate = new ManualStepGate();
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk: string) => {
      const steps = (chunk.match(/\n/g) ?? []).length || (chunk.trim() ? 1 : 0);
      for (let i = 0; i < steps; i += 1) stepGate?.step();
    });
    process.stdin.resume();
  }

  const { results, workspaceDir, noProgressPaused, health } = await runLoopLocally({
    loopId,
    mission,
    cycles,
    onEvent,
    stepGate,
    runtime: stall ? new FakeCmaRuntime({ stall: true }) : undefined,
    memoryDir: join(defaultArtifactsRoot(), '..', 'memory'),
  });

  stepGate?.releaseAll();

  if (stream) {
    // Let stdin stop holding the event loop open in step mode.
    if (step) process.stdin.pause();
    return;
  }

  for (const r of results) {
    err(
      `cycle ${r.cycle}: ${r.phasesRun.length} phase-runs · reworks=${r.reworks} · ` +
        `verdict=${r.finalVerdict?.result ?? 'n/a'} · $${r.costUsd.toFixed(4)} · ` +
        `cacheRead=${r.cacheReadTokens}${r.paused ? ' · PAUSED (budget)' : ''}${r.downgraded ? ' · DOWNGRADED' : ''}\n`,
    );
  }
  err(`health=${health}%${noProgressPaused ? ' · PAUSED (no-progress)' : ''}\n`);

  for (const file of ['HANDOFF.md', 'REPORT.md']) {
    try {
      const content = await readFile(join(workspaceDir, file), 'utf8');
      out(`\n===== ${file} (${join(workspaceDir, file)}) =====\n${content}\n`);
    } catch {
      // not produced this run
    }
  }
}

main().catch((e: unknown) => {
  process.stderr.write(`${e instanceof Error ? (e.stack ?? e.message) : String(e)}\n`);
  process.exit(1);
});
