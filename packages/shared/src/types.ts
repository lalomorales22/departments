/**
 * Domain entity types — the relational core (mirrors the Postgres schema in
 * `packages/db`). Every tenant-scoped row carries `orgId`. Timestamps are ISO-8601
 * strings for transport-safety across the WS/REST/GraphQL boundary.
 */
import type {
  AgentRole,
  AgentStatus,
  ArtifactKind,
  GoodDirection,
  LoopLevel,
  LoopStatus,
  OutcomeResult,
  Phase,
  RubricCategory,
  TaskArea,
  TaskPriority,
  TaskState,
  UserRole,
} from './enums';
import type { AccentKey } from './pipeline';

/** Branded id aliases — documentation only, structurally still strings. */
export type Id<_Brand extends string> = string;
export type IsoDate = string;

// ─────────────────────────────────────────────────────────────────────────────

export interface Org {
  id: Id<'Org'>;
  name: string;
  slug: string;
  createdAt: IsoDate;
}

export interface User {
  id: Id<'User'>;
  orgId: Id<'Org'>;
  name: string;
  email: string;
  role: UserRole;
  avatarUrl?: string;
  initials: string;
  createdAt: IsoDate;
}

/** A Loop = an autonomous department. Self-referential tree via `parentLoopId`. */
export interface Loop {
  id: Id<'Loop'>;
  orgId: Id<'Org'>;
  parentLoopId: Id<'Loop'> | null;
  /** The one-word handle used by `loop <name>` (e.g. "marketing"). */
  name: string;
  /** Display label (e.g. "Marketing"). */
  displayName: string;
  level: LoopLevel;
  /** The durable single objective this loop exists to achieve. */
  mission: string;
  status: LoopStatus;
  /** 0–100 rolling gate-pass health. */
  health: number;
  /** Current engine phase (null when never run / stopped). */
  phase: Phase | null;
  /** Completed full cycles. */
  cycleCount: number;
  /** Human-readable cadence (e.g. "continuous", "nightly", "manual"). */
  cadence: string;
  /** CMA primitives (null until provisioned). */
  cmaAgentId: string | null;
  memoryStoreId: string | null;
  repoUrl: string | null;
  /** Hard budget cap in USD; soft cap derived as a fraction (see cost ledger). */
  budgetCapUsd: number;
  spentUsd: number;
  createdAt: IsoDate;
  updatedAt: IsoDate;
}

export interface Agent {
  id: Id<'Agent'>;
  orgId: Id<'Org'>;
  loopId: Id<'Loop'>;
  role: AgentRole;
  /** Display name (e.g. "Market Researcher"). */
  name: string;
  modelId: string;
  /** Effort knob; null/undefined for Haiku workers (the param errors there). */
  effort: string | null;
  status: AgentStatus;
  /** Short description of what this agent is doing right now. */
  activity?: string;
  /** Recent activity samples for the agent card sparkline (0–1). */
  activitySeries?: number[];
  createdAt: IsoDate;
}

export interface Subagent {
  id: Id<'Subagent'>;
  orgId: Id<'Org'>;
  agentId: Id<'Agent'>;
  cmaThreadId: string | null;
  status: AgentStatus;
  label: string;
}

export interface Task {
  id: Id<'Task'>;
  orgId: Id<'Org'>;
  loopId: Id<'Loop'>;
  title: string;
  area: TaskArea;
  priority: TaskPriority;
  state: TaskState;
  /** Owning agent id, if assigned. */
  assigneeId?: Id<'Agent'>;
  tags?: string[];
  createdAt: IsoDate;
  updatedAt: IsoDate;
}

export interface Run {
  id: Id<'Run'>;
  orgId: Id<'Org'>;
  loopId: Id<'Loop'>;
  phase: Phase;
  tickNo: number;
  cmaSessionId: string | null;
  /** Token usage snapshot. */
  usage?: TokenUsage;
  costUsd: number;
  startedAt: IsoDate;
  endedAt?: IsoDate;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
}

export interface Metric {
  id: Id<'Metric'>;
  orgId: Id<'Org'>;
  loopId: Id<'Loop'>;
  /** Stable key (e.g. "bounce_rate"). */
  key: string;
  /** Display name (e.g. "Bounce Rate"). */
  name: string;
  value: number;
  /** Formatted display value (e.g. "42.3%", "$12.4k"). */
  display: string;
  /** Percent change vs prior sample. */
  delta: number;
  /** Which direction is good — colors the delta chip. */
  goodDirection: GoodDirection;
  /** Recent samples for the sparkline. */
  series: number[];
  unit?: string;
  ts: IsoDate;
}

export interface MemoryItem {
  id: Id<'Memory'>;
  orgId: Id<'Org'>;
  loopId: Id<'Loop'>;
  /** Path / source of the memory (e.g. "HANDOFF.md#decisions"). */
  path: string;
  summary: string;
  /** Reference to the full content blob (S3 / git SHA). */
  contentRef?: string;
  /** Cosine relevance when surfaced via search (0–1), UI-only. */
  relevance?: number;
  createdAt: IsoDate;
}

export interface Artifact {
  id: Id<'Artifact'>;
  orgId: Id<'Org'>;
  loopId: Id<'Loop'>;
  kind: ArtifactKind;
  path: string;
  /** Latest version label (e.g. "v12"). */
  version: string;
  /** Bytes of the latest version. */
  sizeBytes: number;
  updatedAt: IsoDate;
}

export interface ArtifactVersion {
  id: Id<'ArtifactVersion'>;
  artifactId: Id<'Artifact'>;
  version: string;
  gitSha: string;
  blobRef: string;
  createdAt: IsoDate;
}

export interface Outcome {
  id: Id<'Outcome'>;
  orgId: Id<'Org'>;
  runId: Id<'Run'>;
  result: OutcomeResult;
  iterations: number;
  maxIterations: number;
  notes?: string;
}

export interface Rubric {
  id: Id<'Rubric'>;
  category: RubricCategory;
  /** Pass/fail for this gate in the most recent evaluation. */
  passed: boolean;
  /** 0–100 score. */
  score: number;
  notes?: string;
}

export interface Vault {
  id: Id<'Vault'>;
  orgId: Id<'Org'>;
  cmaVaultId: string;
  label: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// View models — convenience shapes the UI binds to (composed from the above).
// ─────────────────────────────────────────────────────────────────────────────

/** A node in the hierarchy tree (loops nested by `parentLoopId`). */
export interface LoopTreeNode {
  loop: Loop;
  children: LoopTreeNode[];
}

/** Live pipeline state for a loop's center pipeline render. */
export interface PipelineState {
  /** Engine phase currently active. */
  activePhase: Phase | null;
  /** Per-stage status keyed by engine phase. */
  stageStatus: Partial<Record<Phase, 'pending' | 'active' | 'complete' | 'error'>>;
  cycleCount: number;
  /** Seconds elapsed in the current cycle. */
  elapsedSeconds: number;
}

/** Resolved accent (key + hex + glow) — produced by the design system, not here. */
export interface ResolvedAccent {
  key: AccentKey;
  hex: string;
  glow: string;
}
