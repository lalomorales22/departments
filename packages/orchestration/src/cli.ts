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
import { runLoopLocally, runTreeLocally, type RunTreeResult } from './local-driver.js';
import type { RollupNode } from './rollup.js';
import { ManualStepGate } from './step-gate.js';
import { autoApproveToolGate, denyToolGate, ManualToolGate, type ToolGate } from './tool-gate.js';
import { ManualSpawnGate, SpawnController, type SpawnRequest } from './spawn.js';

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
  // --ask approve|deny demos the always_ask gate on an irreversible tool (deploy).
  const ask = flag(args, '--ask');
  const orgCap = flag(args, '--org-cap');
  // --approvals: interactive Commander approval over stdin (the cockpit drives it):
  //   lines `tool:allow|tool:deny` resolve an always_ask tool confirmation;
  //   lines `spawn:allow|spawn:deny` resolve a child-spawn request; bare newline = step.
  const approvals = args.includes('--approvals');

  const out = (s: string) => process.stdout.write(s);
  const err = (s: string) => process.stderr.write(s);

  const onEvent = stream ? (e: DeptEvent) => out(`${JSON.stringify(e)}\n`) : undefined;

  // --tree: the CEO meta-loop demo — a CEO over two units on one shared org cap +
  // concurrency semaphore; the CEO batch-reviews them and reallocates budget.
  if (args.includes('--tree')) {
    if (!stream) err(`▶ tree "ceo → marketing, sales" · ${cycles} cycle(s)/child${orgCap ? ` · org cap $${orgCap}` : ''}\n`);
    const res = await runTreeLocally({
      orgId: 'org-demo',
      loops: [
        { loopId: 'p4-ceo', parentLoopId: null, level: 1, displayName: 'CEO' },
        { loopId: 'p4-marketing', parentLoopId: 'p4-ceo', level: 1, displayName: 'Marketing', budgetCapUsd: 60 },
        { loopId: 'p4-sales', parentLoopId: 'p4-ceo', level: 1, displayName: 'Sales', budgetCapUsd: 60 },
      ],
      cyclesPerChild: cycles,
      orgBudgetCapUsd: orgCap ? Number(orgCap) : undefined,
      reallocateUsd: 20,
      maxConcurrent: 2,
      memoryDir: join(defaultArtifactsRoot(), '..', 'memory'),
      onEvent,
    });
    if (!stream) printTree(res, err);
    return;
  }
  if (!stream) err(`▶ loop "${loopId}" · ${cycles} cycle(s)${step ? ' · STEP' : ''}${stall ? ' · STALL' : ''}${approvals ? ' · APPROVALS' : ''}\n`);

  // Gates fed from stdin (the cockpit's /step + /decide routes write these lines).
  const stepGate = step ? new ManualStepGate() : undefined;
  const manualToolGate = approvals ? new ManualToolGate() : undefined;
  const spawnGate = approvals ? new ManualSpawnGate() : undefined;
  if (step || approvals) {
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk: string) => {
      for (const raw of chunk.split('\n')) {
        const line = raw.trim();
        if (line === '') {
          stepGate?.step();
        } else if (line === 'tool:allow') {
          manualToolGate?.decide({ allow: true });
        } else if (line === 'tool:deny') {
          manualToolGate?.decide({ allow: false, reason: 'denied by Commander' });
        } else if (line === 'spawn:allow') {
          spawnGate?.decide({ approve: true });
        } else if (line === 'spawn:deny') {
          spawnGate?.decide({ approve: false, reason: 'denied by Commander' });
        }
      }
    });
    process.stdin.resume();
  }

  // Tool gate: interactive (--approvals) > policy (--ask) > none.
  let toolGate: ToolGate | undefined = manualToolGate;
  let runtime = stall ? new FakeCmaRuntime({ stall: true }) : undefined;
  if (approvals) {
    runtime = new FakeCmaRuntime({ stall, irreversible: { tool: 'github.deploy', summary: 'deploy build to production' } });
  } else if (ask) {
    toolGate = ask === 'deny' ? denyToolGate() : autoApproveToolGate;
    runtime = new FakeCmaRuntime({ stall, irreversible: { tool: 'github.deploy', summary: 'deploy build to production' } });
  }

  // Child-spawn approval demo: in --approvals mode the loop requests a child loop and
  // waits for the Commander's decision (the cockpit's approval banner drives it).
  if (approvals && stream && onEvent) {
    const ts = () => new Date().toISOString();
    const req: SpawnRequest = { orgId: 'org-local', parentLoopId: loopId, childName: `${loopId}-worker`, mission: `Worker loop spawned by ${loopId}.`, parentLevel: 2 };
    onEvent({ id: `${loopId}-spawn-req`, seq: 0, loopId, ts: ts(), kind: 'log', payload: { level: 'warn', source: 'spawn', message: `spawn request: child "${req.childName}" (L${req.parentLevel + 1}) — awaiting Commander approval.` } } as DeptEvent);
    const verdict = await new SpawnController().resolve(req, spawnGate!);
    onEvent({ id: `${loopId}-spawn-out`, seq: 0, loopId, ts: ts(), kind: 'log', payload: { level: verdict.decision === 'allow' ? 'info' : 'warn', source: 'spawn', message: verdict.decision === 'allow' ? `spawn approved: "${req.childName}" created (L${verdict.childLevel}).` : `spawn denied: ${verdict.reason}` } } as DeptEvent);
  }

  const { results, workspaceDir, noProgressPaused, health } = await runLoopLocally({
    loopId,
    mission,
    cycles,
    onEvent,
    stepGate,
    runtime,
    toolGate,
    orgBudgetCapUsd: orgCap ? Number(orgCap) : undefined,
    memoryDir: join(defaultArtifactsRoot(), '..', 'memory'),
  });

  stepGate?.releaseAll();
  manualToolGate?.releaseAll();
  spawnGate?.releaseAll();

  if (stream) {
    // Let stdin stop holding the event loop open in step / approvals mode.
    if (step || approvals) process.stdin.pause();
    return;
  }

  for (const r of results) {
    err(
      `cycle ${r.cycle}: ${r.phasesRun.length} phase-runs · reworks=${r.reworks} · ` +
        `verdict=${r.finalVerdict?.result ?? 'n/a'} · $${r.costUsd.toFixed(4)} · ` +
        `cacheRead=${r.cacheReadTokens}${r.paused ? ' · PAUSED (budget)' : ''}${r.downgraded ? ' · DOWNGRADED' : ''}` +
        `${r.escalated ? ' · ESCALATED' : ''}${r.toolDenied ? ' · TOOL-DENIED' : ''}\n`,
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

function printRollup(node: RollupNode, err: (s: string) => void, depth = 0): void {
  const pad = '  '.repeat(depth);
  err(
    `${pad}• ${node.name} (L${node.level}) — rolled health ${node.rolledHealth}% ` +
      `(own ${node.ownHealth}%) · status ${node.rolledStatus} · spend $${node.rolledSpentUsd.toFixed(2)}/$${node.rolledBudgetUsd.toFixed(2)}\n`,
  );
  for (const child of node.children) printRollup(child, err, depth + 1);
}

function printTree(res: RunTreeResult, err: (s: string) => void): void {
  err(`\nTREE ROLLUP:\n`);
  for (const node of res.rollup) printRollup(node, err);
  err(`\nCEO OBJECTIVES (reprioritized after a batched review):\n`);
  for (const o of res.ceoReview?.objectives ?? []) err(`  ${o.loopId}: ${o.objective}\n`);
  err(
    `\norg spend: $${res.orgSpentUsd.toFixed(4)} · ` +
      `CEO review (Batch API, 50% off): $${res.ceoReview?.reviewCostUsd.toFixed(4) ?? 'n/a'}\n`,
  );
}

main().catch((e: unknown) => {
  process.stderr.write(`${e instanceof Error ? (e.stack ?? e.message) : String(e)}\n`);
  process.exit(1);
});
