/**
 * Loop Engine CLI. Runs real cycles against the local driver (FakeCmaRuntime + real
 * git artifacts).
 *
 *   pnpm --filter @departments/orchestration loop:run software-builder            # human summary
 *   pnpm --filter @departments/orchestration loop:run software-builder --cycles 3
 *   tsx src/cli.ts marketing --stream                                             # NDJSON events
 *
 * In --stream mode ONLY newline-delimited DeptEvent JSON goes to stdout (the cockpit's
 * run-a-loop route relays it); all human text goes to stderr.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { defaultArtifactsRoot } from '@departments/artifacts';
import type { DeptEvent } from '@departments/events';
import { runLoopLocally } from './local-driver.js';

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const loopId = args.find((a) => !a.startsWith('-')) ?? 'software-builder';
  const stream = args.includes('--stream');
  const cycles = Number(flag(args, '--cycles') ?? '1') || 1;
  const mission = flag(args, '--mission');

  const out = (s: string) => process.stdout.write(s);
  const err = (s: string) => process.stderr.write(s);

  const onEvent = stream ? (e: DeptEvent) => out(`${JSON.stringify(e)}\n`) : undefined;
  if (!stream) err(`▶ loop "${loopId}" · ${cycles} cycle(s)\n`);

  const { results, workspaceDir } = await runLoopLocally({
    loopId,
    mission,
    cycles,
    onEvent,
    memoryDir: join(defaultArtifactsRoot(), '..', 'memory'),
  });

  if (stream) return;

  for (const r of results) {
    err(
      `cycle ${r.cycle}: ${r.phasesRun.length} phase-runs · reworks=${r.reworks} · ` +
        `verdict=${r.finalVerdict?.result ?? 'n/a'} · $${r.costUsd.toFixed(4)} · ` +
        `cacheRead=${r.cacheReadTokens}${r.paused ? ' · PAUSED (budget)' : ''}${r.downgraded ? ' · DOWNGRADED' : ''}\n`,
    );
  }

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
