/**
 * Canonical enums for Departments.
 *
 * Every enum is expressed as a `readonly` tuple (for runtime iteration / zod / DB
 * checks) plus a derived union type. Keep this file free of any UI / hex concerns —
 * colors and labels live in {@link ./pipeline.ts} (semantic keys) and in the web
 * design system (the single `statusTheme` map owns the actual hex).
 */

// ─────────────────────────────────────────────────────────────────────────────
// Org / identity
// ─────────────────────────────────────────────────────────────────────────────

/** Roles a user can hold inside an org (RBAC). `commander` holds the kill switch. */
export const USER_ROLES = ['owner', 'commander', 'operator', 'viewer'] as const;
export type UserRole = (typeof USER_ROLES)[number];

// ─────────────────────────────────────────────────────────────────────────────
// Loop hierarchy
// ─────────────────────────────────────────────────────────────────────────────

/** The 4-level ownership/supervision hierarchy. A loop at level N supervises N+1. */
export const LOOP_LEVELS = [1, 2, 3, 4] as const;
export type LoopLevel = (typeof LOOP_LEVELS)[number];

/** Human-readable label for each level (L1–L4). */
export const LOOP_LEVEL_LABELS: Record<LoopLevel, string> = {
  1: 'Company Departments',
  2: 'Business / Product Units',
  3: 'Execution Departments',
  4: 'Worker Loops',
};

/** Runtime status of a loop. Drives the status dot + glow in the tree. */
export const LOOP_STATUSES = ['running', 'idle', 'paused', 'stopped', 'error'] as const;
export type LoopStatus = (typeof LOOP_STATUSES)[number];

// ─────────────────────────────────────────────────────────────────────────────
// Lifecycle phases (the canonical state machine)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Engine phases. `bootstrap` is the resumable cold-start; the five cycle phases run
 * indefinitely. NOTE: engine phase `improve` === UI stage `OPTIMIZE` — see
 * {@link ./pipeline.ts}. This is the one vocabulary that must never drift.
 */
export const PHASES = [
  'bootstrap',
  'plan',
  'execute',
  'evaluate',
  'improve',
  'memory',
] as const;
export type Phase = (typeof PHASES)[number];

/** The five cycle phases only (excludes bootstrap) — the repeating traversal. */
export const CYCLE_PHASES = ['plan', 'execute', 'evaluate', 'improve', 'memory'] as const;
export type CyclePhase = (typeof CYCLE_PHASES)[number];

// ─────────────────────────────────────────────────────────────────────────────
// Agents
// ─────────────────────────────────────────────────────────────────────────────

/** The canonical agent roster every loop runs. `coordinator` is the meta/CEO role. */
export const AGENT_ROLES = [
  'planner',
  'executor',
  'qa',
  'docs',
  'reviewer',
  'coordinator',
] as const;
export type AgentRole = (typeof AGENT_ROLES)[number];

/** Live status of an agent or subagent. */
export const AGENT_STATUSES = ['running', 'idle', 'blocked', 'error'] as const;
export type AgentStatus = (typeof AGENT_STATUSES)[number];

// ─────────────────────────────────────────────────────────────────────────────
// Tasks (Kanban)
// ─────────────────────────────────────────────────────────────────────────────

export const TASK_STATES = ['todo', 'in_progress', 'review', 'done'] as const;
export type TaskState = (typeof TASK_STATES)[number];

export const TASK_STATE_LABELS: Record<TaskState, string> = {
  todo: 'TODO',
  in_progress: 'IN PROGRESS',
  review: 'REVIEW',
  done: 'DONE',
};

export const TASK_PRIORITIES = ['P1', 'P2', 'P3'] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

/** Execution area a task belongs to (mirrors L3 execution departments). */
export const TASK_AREAS = [
  'research',
  'content',
  'seo',
  'analytics',
  'campaign',
  'design',
  'engineering',
  'ops',
] as const;
export type TaskArea = (typeof TASK_AREAS)[number];

// ─────────────────────────────────────────────────────────────────────────────
// Events (the frozen terminal/realtime feed — see packages/events for the contract)
// ─────────────────────────────────────────────────────────────────────────────

export const EVENT_KINDS = [
  'log',
  'debug',
  'output',
  'agent_msg',
  'tool_use',
  'status',
  'metric',
  'error',
] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

// ─────────────────────────────────────────────────────────────────────────────
// Checks & balances
// ─────────────────────────────────────────────────────────────────────────────

/** The four gate categories scored by the independent grader. */
export const RUBRIC_CATEGORIES = [
  'quality',
  'data_validation',
  'alignment_risk',
  'performance',
] as const;
export type RubricCategory = (typeof RUBRIC_CATEGORIES)[number];

export const RUBRIC_CATEGORY_LABELS: Record<RubricCategory, string> = {
  quality: 'Quality',
  data_validation: 'Data Validation',
  alignment_risk: 'Alignment / Risk',
  performance: 'Performance',
};

/** Outcome verdicts mapped from CMA `span.outcome_evaluation_*`. */
export const OUTCOME_RESULTS = [
  'satisfied',
  'needs_revision',
  'max_iterations_reached',
  'failed',
] as const;
export type OutcomeResult = (typeof OUTCOME_RESULTS)[number];

// ─────────────────────────────────────────────────────────────────────────────
// Artifacts (files as memory)
// ─────────────────────────────────────────────────────────────────────────────

export const ARTIFACT_KINDS = [
  'readme',
  'tasks',
  'handoff',
  'report',
  'strategy',
  'source',
  'dashboard',
] as const;
export type ArtifactKind = (typeof ARTIFACT_KINDS)[number];

// ─────────────────────────────────────────────────────────────────────────────
// Metrics
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Which direction is "good" for a metric. A delta is colored green when it moves in
 * the good direction (e.g. Bounce Rate `down` going down is green), red otherwise.
 */
export const GOOD_DIRECTIONS = ['up', 'down'] as const;
export type GoodDirection = (typeof GOOD_DIRECTIONS)[number];

// ─────────────────────────────────────────────────────────────────────────────
// Run phases (audit spine) — re-uses Phase
// ─────────────────────────────────────────────────────────────────────────────

export const RUN_PHASES = PHASES;
export type RunPhase = Phase;
