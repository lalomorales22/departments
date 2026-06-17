/**
 * THE SINGLE SOURCE OF TRUTH for the lifecycle pipeline.
 *
 * The engine's 4th phase is `improve`; the UI labels that same stage `OPTIMIZE`.
 * They are the SAME stage. `Run.phase` uses `improve`; the dashboard renders
 * `OPTIMIZE`. Bind every label, color, and ordering decision to this table — never
 * hardcode the mapping anywhere else.
 *
 * Colors here are SEMANTIC KEYS only (`cyan|green|purple|amber|blue`). The actual
 * hex lives in exactly one place: the web design system's `statusTheme` map, keyed
 * by these same names. That keeps "no inlined hex anywhere" honest across the stack.
 */
import type { CyclePhase } from './enums';

/** Semantic accent keys. The web `statusTheme` map resolves these to hex + glow. */
export type AccentKey = 'cyan' | 'green' | 'purple' | 'amber' | 'blue' | 'red';

export interface PipelineStage {
  /** Engine phase value as persisted on `Run.phase`. */
  readonly phase: CyclePhase;
  /** UI stage label shown in the LoopPipeline (UPPERCASE). */
  readonly label: string;
  /** Semantic accent key — resolved to hex by the design system, never inlined. */
  readonly accent: AccentKey;
  /** What this stage reads in. */
  readonly consumes: string;
  /** What this stage writes out. */
  readonly produces: string;
  /** One-line description for tooltips / the inspector. */
  readonly blurb: string;
}

/**
 * The canonical, ordered pipeline. Index order IS the render order:
 * PLAN → EXECUTE → EVALUATE → OPTIMIZE → MEMORY → (wrap to PLAN).
 */
export const PIPELINE: readonly PipelineStage[] = [
  {
    phase: 'plan',
    label: 'PLAN',
    accent: 'cyan',
    consumes: 'mission, latest HANDOFF.md, memory, prior REPORT.md',
    produces: 'refreshed TASKS.md, goals/strategy delta, agent assignments',
    blurb: 'Define goals, strategy and inputs.',
  },
  {
    phase: 'execute',
    label: 'EXECUTE',
    accent: 'green',
    consumes: 'TASKS.md, agent roster, memory/context',
    produces: 'code, content, drafts, task-state changes, sub-artifacts',
    blurb: 'Agents act and produce work.',
  },
  {
    phase: 'evaluate',
    label: 'EVALUATE',
    accent: 'purple',
    consumes: 'execution outputs, success metrics',
    produces: 'per-gate pass/fail, metric deltas, evaluation notes',
    blurb: 'Review results, run the four gates.',
  },
  {
    // Engine phase `improve` renders as `OPTIMIZE`. Same stage. Do not split.
    phase: 'improve',
    label: 'OPTIMIZE',
    accent: 'amber',
    consumes: 'evaluation results, learnings',
    produces: 'optimizations, refined strategy, reprioritized backlog, REPORT.md',
    blurb: 'Optimize, fix bottlenecks and learn.',
  },
  {
    phase: 'memory',
    label: 'MEMORY',
    accent: 'blue',
    consumes: 'all cycle artifacts, decisions, insights',
    produces: 'updated HANDOFF.md, distilled memory entries',
    blurb: 'Save context, artifacts and improve.',
  },
] as const;

/** Look up a stage by its engine phase. */
export function stageForPhase(phase: CyclePhase): PipelineStage {
  const stage = PIPELINE.find((s) => s.phase === phase);
  if (!stage) throw new Error(`No pipeline stage for phase: ${phase}`);
  return stage;
}

/** The UI label for an engine phase (e.g. `improve` → `OPTIMIZE`). */
export function uiLabelForPhase(phase: CyclePhase): string {
  return stageForPhase(phase).label;
}

/** Accent key for an engine phase. */
export function accentForPhase(phase: CyclePhase): AccentKey {
  return stageForPhase(phase).accent;
}
