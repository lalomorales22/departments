/**
 * scripts/provision.ts — one-time CMA agent/environment provisioning loader.
 *
 * Reads the version-controlled `provision-agents.yaml` (the `ant`-style control-plane
 * spec), validates EVERY (model, knob) pairing against the authoritative tier policy in
 * `@departments/agent-runtime` (validateKnobs — a guaranteed-400 surfaces here at
 * provision time, not against the live API), and prints the plan.
 *
 *   • DRY-RUN by default — prints what WOULD be created; touches nothing.
 *   • A real apply against CMA is gated behind BOTH `ANTHROPIC_API_KEY` (env) AND a
 *     `--apply` flag, and is left as a documented TODO (see applyPlan()).
 *
 * Run:  pnpm tsx scripts/provision.ts            # dry-run (validate + print)
 *       pnpm tsx scripts/provision.ts --apply    # apply (requires ANTHROPIC_API_KEY)
 *
 * ⚠️  AGENTS ARE CREATED ONCE AND REFERENCED BY ID — NEVER in the request path. This
 *     script is the setup step (control plane). The orchestration engine starts CMA
 *     Sessions per loop run and points them at these agent IDs + versions.
 *
 * Dependency-light: rather than add a `yaml` dep for one fixed-shape file, this module
 * hand-parses exactly the structure `provision-agents.yaml` uses (block mappings,
 * `- ` sequences, scalars, `[]` empty inline lists, `#` comments). It is deliberately
 * NOT a general YAML parser — it validates the shape it understands and errors loudly
 * on anything it doesn't, so a malformed spec fails fast instead of mis-provisioning.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import {
  validateKnobs,
  getTier,
  type Effort,
  type ModelId,
  type ModelKnobs,
} from '@departments/agent-runtime';

// ─── The typed shape we parse the YAML into ─────────────────────────────────────

/** The known model ids — mirrors `ModelId` from the runtime; used to narrow scalars. */
const KNOWN_MODELS: readonly ModelId[] = [
  'claude-opus-4-8',
  'claude-fable-5',
  'claude-sonnet-4-6',
  'claude-haiku-4-5',
];

/** The known effort rungs — mirrors `Effort` from the runtime. */
const KNOWN_EFFORTS: readonly Effort[] = ['low', 'medium', 'high', 'xhigh', 'max'];

interface EnvironmentSpec {
  readonly name: string;
  readonly networking: string;
}

interface AgentSpec {
  readonly role: string;
  readonly name: string;
  readonly modelId: ModelId;
  /** Present iff the spec pinned an effort; undefined means "omit the effort param". */
  readonly effort?: Effort;
  /** 'adaptive' if pinned; undefined means the thinking param is omitted. */
  readonly thinking?: string;
  /** Whether `thinking:{type:"disabled"}` was (wrongly) requested — for validateKnobs. */
  readonly thinkingDisabled: boolean;
  /** Whether this agent is in the default apply set (gated agents set enabled:false). */
  readonly enabled: boolean;
  /** Fable refusal-safe path: beta headers (e.g. server-side-fallback-2026-06-01). */
  readonly betas: readonly string[];
  /** Fable refusal-safe path: server-side fallback model ids. */
  readonly fallbacks: readonly ModelId[];
  /** Fable requires 30-day retention; carried through for the apply step. */
  readonly dataRetentionDays?: number;
}

interface ProvisionSpec {
  readonly department: string;
  readonly environment: EnvironmentSpec;
  readonly agents: readonly AgentSpec[];
}

// ─── Minimal YAML reader (fixed structure only) ─────────────────────────────────

interface RawLine {
  readonly indent: number;
  readonly content: string;
  /** Source line number (1-based) for error messages. */
  readonly lineNo: number;
}

/** Strip a trailing `# comment` that is not inside a quoted string (we have no quotes). */
function stripComment(s: string): string {
  const hash = s.indexOf('#');
  return hash === -1 ? s : s.slice(0, hash);
}

/** Tokenize into indentation-aware lines, dropping blanks and comment-only lines. */
function readLines(src: string): RawLine[] {
  const out: RawLine[] = [];
  const rawLines = src.split('\n');
  for (let i = 0; i < rawLines.length; i++) {
    const raw = rawLines[i] ?? '';
    const noComment = stripComment(raw);
    if (noComment.trim() === '') continue;
    const indent = noComment.length - noComment.trimStart().length;
    out.push({ indent, content: noComment.trimEnd().trimStart(), lineNo: i + 1 });
  }
  return out;
}

/** Parse a scalar value: unquote, and map `[]` to an empty-array sentinel via null. */
function scalar(value: string): string {
  const v = value.trim();
  if (
    v.length >= 2 &&
    ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))
  ) {
    return v.slice(1, -1);
  }
  return v;
}

/** Split `key: value` → [key, valueOrEmpty]; `value` is '' for a bare `key:`. */
function splitKey(content: string, lineNo: number): { key: string; value: string } {
  const idx = content.indexOf(':');
  if (idx === -1) {
    throw new Error(`provision-agents.yaml:${lineNo}: expected "key: value", got "${content}"`);
  }
  return { key: content.slice(0, idx).trim(), value: content.slice(idx + 1).trim() };
}

/**
 * Collect the contiguous block of lines strictly more-indented than `parentIndent`,
 * starting at `start`. Returns the slice and the index just past it.
 */
function childBlock(
  lines: readonly RawLine[],
  start: number,
  parentIndent: number,
): { block: RawLine[]; next: number } {
  const block: RawLine[] = [];
  let i = start;
  while (i < lines.length) {
    const line = lines[i];
    if (line === undefined) break;
    if (line.indent <= parentIndent) break;
    block.push(line);
    i++;
  }
  return { block, next: i };
}

/**
 * Parse a block of `- item` / `- key: val` sequence entries into grouped sub-blocks.
 *
 * A new item begins ONLY on a `- ` marker at the sequence's own indent (the minimum
 * indent in the block). Deeper `- ` lines belong to a *nested* sequence inside the
 * current item (e.g. `multiagent.agents`), so they are appended verbatim, not split out.
 */
function parseSequence(block: readonly RawLine[]): RawLine[][] {
  const seqIndent = block.reduce(
    (min, line) => (line.indent < min ? line.indent : min),
    Number.POSITIVE_INFINITY,
  );
  const items: RawLine[][] = [];
  let current: RawLine[] | null = null;
  for (const line of block) {
    const isTopDash =
      line.indent === seqIndent && (line.content.startsWith('- ') || line.content === '-');
    if (isTopDash && line.content.startsWith('- ')) {
      if (current) items.push(current);
      // Re-emit the remainder of the dash line as a child at a deeper virtual indent.
      const rest = line.content.slice(2);
      current = [{ indent: line.indent + 2, content: rest, lineNo: line.lineNo }];
    } else if (isTopDash && line.content === '-') {
      if (current) items.push(current);
      current = [];
    } else {
      if (!current) {
        throw new Error(
          `provision-agents.yaml:${line.lineNo}: sequence item content before any "- " marker`,
        );
      }
      current.push(line);
    }
  }
  if (current) items.push(current);
  return items;
}

/** Read the inline `role_ref: x` (or `role: x`) value from a one-line roster entry. */
function rosterRoleRef(item: readonly RawLine[]): string | null {
  for (const line of item) {
    const { key, value } = splitKey(line.content, line.lineNo);
    if (key === 'role_ref' || key === 'role') return scalar(value);
  }
  return null;
}

// ─── Spec parsing ───────────────────────────────────────────────────────────────

function narrowModel(value: string, lineNo: number): ModelId {
  const found = KNOWN_MODELS.find((m) => m === value);
  if (found === undefined) {
    throw new Error(
      `provision-agents.yaml:${lineNo}: unknown model id "${value}" (known: ${KNOWN_MODELS.join(', ')})`,
    );
  }
  return found;
}

function narrowEffort(value: string, lineNo: number): Effort {
  const found = KNOWN_EFFORTS.find((e) => e === value);
  if (found === undefined) {
    throw new Error(
      `provision-agents.yaml:${lineNo}: unknown effort "${value}" (known: ${KNOWN_EFFORTS.join(', ')})`,
    );
  }
  return found;
}

function parseBool(value: string, lineNo: number): boolean {
  const v = value.trim().toLowerCase();
  if (v === 'true') return true;
  if (v === 'false') return false;
  throw new Error(`provision-agents.yaml:${lineNo}: expected boolean true/false, got "${value}"`);
}

function parseScalarList(block: readonly RawLine[]): string[] {
  const items = parseSequence(block);
  const out: string[] = [];
  for (const item of items) {
    const first = item[0];
    if (first === undefined) continue;
    // Either a bare scalar (`- foo`) or `- model: foo` / `- type: foo` one-liner.
    if (first.content.includes(':')) {
      const { value } = splitKey(first.content, first.lineNo);
      out.push(scalar(value));
    } else {
      out.push(scalar(first.content));
    }
  }
  return out;
}

function parseAgent(item: readonly RawLine[]): AgentSpec {
  const head = item[0];
  if (head === undefined) {
    throw new Error('provision-agents.yaml: empty agent entry');
  }
  // Each agent entry is a mapping; the dash-line re-emitted its first key at indent+2.
  const baseIndent = head.indent;

  let role: string | undefined;
  let name: string | undefined;
  let modelId: ModelId | undefined;
  let effort: Effort | undefined;
  let thinking: string | undefined;
  let thinkingDisabled = false;
  let enabled = true;
  let betas: string[] = [];
  let fallbacks: ModelId[] = [];
  let dataRetentionDays: number | undefined;

  for (let i = 0; i < item.length; ) {
    const line = item[i];
    if (line === undefined) {
      i++;
      continue;
    }
    if (line.indent !== baseIndent) {
      i++;
      continue;
    }
    const { key, value } = splitKey(line.content, line.lineNo);
    if (value !== '') {
      // Inline scalar value.
      switch (key) {
        case 'role':
          role = scalar(value);
          break;
        case 'name':
          name = scalar(value);
          break;
        case 'model':
          modelId = narrowModel(scalar(value), line.lineNo);
          break;
        case 'effort':
          effort = narrowEffort(scalar(value), line.lineNo);
          break;
        case 'thinking': {
          const t = scalar(value);
          thinking = t;
          if (t === 'disabled') thinkingDisabled = true;
          break;
        }
        case 'enabled':
          enabled = parseBool(value, line.lineNo);
          break;
        case 'data_retention_days':
          dataRetentionDays = Number.parseInt(scalar(value), 10);
          break;
        default:
          // system_ref, context_tokens, etc. — not knob-relevant; ignored here.
          break;
      }
      i++;
    } else {
      // Nested block follows.
      const { block, next } = childBlock(item, i + 1, line.indent);
      switch (key) {
        case 'betas':
          betas = parseScalarList(block);
          break;
        case 'fallbacks': {
          const models = parseScalarList(block);
          fallbacks = models.map((m, idx) => {
            const ln = block[idx]?.lineNo ?? line.lineNo;
            return narrowModel(m, ln);
          });
          break;
        }
        default:
          // tools / skills / mcp_servers / multiagent — placeholders, not knob-relevant.
          break;
      }
      i = next;
    }
  }

  if (role === undefined || name === undefined || modelId === undefined) {
    throw new Error(
      `provision-agents.yaml:${head.lineNo}: agent entry missing required role/name/model`,
    );
  }

  return {
    role,
    name,
    modelId,
    effort,
    thinking,
    thinkingDisabled,
    enabled,
    betas,
    fallbacks,
    dataRetentionDays,
  };
}

function parseSpec(src: string): ProvisionSpec {
  const lines = readLines(src);

  let department: string | undefined;
  let environment: EnvironmentSpec | undefined;
  let agents: AgentSpec[] = [];

  for (let i = 0; i < lines.length; ) {
    const line = lines[i];
    if (line === undefined) {
      i++;
      continue;
    }
    if (line.indent !== 0) {
      i++;
      continue;
    }
    const { key, value } = splitKey(line.content, line.lineNo);
    if (value !== '') {
      if (key === 'department') department = scalar(value);
      // `version:` and other top-level scalars: ignored.
      i++;
      continue;
    }
    const { block, next } = childBlock(lines, i + 1, 0);
    if (key === 'environment') {
      environment = parseEnvironment(block);
    } else if (key === 'agents') {
      agents = parseSequence(block).map(parseAgent);
    }
    i = next;
  }

  if (department === undefined) {
    throw new Error('provision-agents.yaml: missing top-level "department"');
  }
  if (environment === undefined) {
    throw new Error('provision-agents.yaml: missing top-level "environment"');
  }
  if (agents.length === 0) {
    throw new Error('provision-agents.yaml: no agents defined');
  }
  return { department, environment, agents };
}

function parseEnvironment(block: readonly RawLine[]): EnvironmentSpec {
  let name: string | undefined;
  let networking = 'unrestricted';
  for (let i = 0; i < block.length; i++) {
    const line = block[i];
    if (line === undefined) continue;
    const { key, value } = splitKey(line.content, line.lineNo);
    if (key === 'name' && value !== '') name = scalar(value);
    if (key === 'type' && value !== '') networking = scalar(value);
  }
  if (name === undefined) {
    throw new Error('provision-agents.yaml: environment missing "name"');
  }
  return { name, networking };
}

// ─── Knob → validateKnobs adaptation ────────────────────────────────────────────

/** Build the {@link ModelKnobs} subset this agent's policy implies, for validation. */
function knobsFor(agent: AgentSpec): ModelKnobs {
  return {
    // Only pass `effort` when the spec pinned one — omitting it is the legal Haiku path.
    ...(agent.effort !== undefined ? { effort: agent.effort } : {}),
    adaptiveThinking: agent.thinking === 'adaptive',
    thinkingDisabled: agent.thinkingDisabled,
    // The YAML never sets budget_tokens or sampling; if it ever did, surface it as a
    // violation rather than silently dropping it.
  };
}

interface AgentPlan {
  readonly agent: AgentSpec;
  readonly violations: readonly string[];
  /** Extra spec-level checks beyond validateKnobs (Fable fallbacks/retention). */
  readonly specErrors: readonly string[];
}

/** Spec-level invariants validateKnobs doesn't cover (refusal-safe Fable wiring). */
function specChecks(agent: AgentSpec): string[] {
  const errors: string[] = [];
  if (agent.modelId === 'claude-fable-5') {
    if (agent.thinking !== undefined) {
      errors.push(
        `${agent.role}: Fable 5 thinking must be OMITTED (always-on); remove the \`thinking\` key (got "${agent.thinking}").`,
      );
    }
    if (!agent.betas.includes('server-side-fallback-2026-06-01')) {
      errors.push(
        `${agent.role}: Fable 5 requires betas:["server-side-fallback-2026-06-01"] for the refusal-safe path.`,
      );
    }
    if (!agent.fallbacks.includes('claude-opus-4-8')) {
      errors.push(
        `${agent.role}: Fable 5 requires a server-side fallback to claude-opus-4-8 (so stop_reason:"refusal" doesn't kill a tick).`,
      );
    }
    if (agent.dataRetentionDays !== 30) {
      errors.push(
        `${agent.role}: Fable 5 requires 30-day data retention (not available under ZDR); set data_retention_days: 30.`,
      );
    }
  }
  return errors;
}

function buildPlan(spec: ProvisionSpec): AgentPlan[] {
  return spec.agents.map((agent) => ({
    agent,
    violations: validateKnobs(agent.modelId, knobsFor(agent)),
    specErrors: specChecks(agent),
  }));
}

// ─── Printing ─────────────────────────────────────────────────────────────────

function fmtEffort(agent: AgentSpec): string {
  return agent.effort === undefined ? '(omitted)' : agent.effort;
}

function fmtThinking(agent: AgentSpec): string {
  if (agent.thinking !== undefined) return agent.thinking;
  // Omitted: Fable omits BECAUSE thinking is always-on; Haiku omits because it has none.
  return agent.modelId === 'claude-fable-5' ? '(omitted — always-on)' : '(omitted — none)';
}

function printPlan(spec: ProvisionSpec, plans: readonly AgentPlan[], apply: boolean): void {
  const mode = apply ? 'APPLY' : 'DRY-RUN';
  // eslint-disable-next-line no-console
  console.log(`\n◈ DEPARTMENTS — CMA provisioning plan [${mode}]`);
  // eslint-disable-next-line no-console
  console.log(`  department:  ${spec.department}`);
  // eslint-disable-next-line no-console
  console.log(
    `  environment: ${spec.environment.name} (networking: ${spec.environment.networking})`,
  );
  // eslint-disable-next-line no-console
  console.log(`  agents:      ${plans.length} role template(s)\n`);

  for (const plan of plans) {
    const { agent } = plan;
    const tier = getTier(agent.modelId);
    const gated = agent.enabled ? '' : '  [GATED — not in default apply set]';
    const ok = plan.violations.length === 0 && plan.specErrors.length === 0;
    const mark = ok ? '✓' : '✗';
    // eslint-disable-next-line no-console
    console.log(`  ${mark} ${agent.role.padEnd(12)} ${agent.name}${gated}`);
    // eslint-disable-next-line no-console
    console.log(
      `      model=${agent.modelId}  effort=${fmtEffort(agent)}  thinking=${fmtThinking(agent)}` +
        `  ctx=${tier.contextTokens.toLocaleString()}  $${tier.priceInPerM}/$${tier.priceOutPerM}`,
    );
    if (agent.betas.length > 0 || agent.fallbacks.length > 0) {
      // eslint-disable-next-line no-console
      console.log(
        `      betas=[${agent.betas.join(', ')}]  fallbacks=[${agent.fallbacks.join(', ')}]` +
          (agent.dataRetentionDays !== undefined
            ? `  retention=${agent.dataRetentionDays}d`
            : ''),
      );
    }
    for (const v of plan.violations) {
      // eslint-disable-next-line no-console
      console.log(`      ✗ KNOB VIOLATION: ${v}`);
    }
    for (const e of plan.specErrors) {
      // eslint-disable-next-line no-console
      console.log(`      ✗ SPEC ERROR: ${e}`);
    }
  }
  // eslint-disable-next-line no-console
  console.log('');
}

// ─── Apply (gated, documented TODO) ─────────────────────────────────────────────

/**
 * Apply the plan against CMA. Gated behind `ANTHROPIC_API_KEY` + `--apply`.
 *
 * TODO(phase-2): implement against `@departments/agent-runtime`'s CMA adapter once it
 * lands (`client.beta.{environments,agents}.*` with `managed-agents-2026-04-01`):
 *   1. environments.create / update (idempotent by name) → env_id
 *   2. for each enabled agent: agents.create (or agents.update --version N if it exists),
 *      mapping {model, effort→output_config.effort, thinking, system, tools, skills,
 *      mcp_servers, multiagent}; Fable carries betas + fallbacks + 30d retention.
 *   3. persist {agentId, version} to config — NEVER into the request path (agents are
 *      referenced by ID per tick, never rebuilt).
 * This control-plane apply stays in the `ant`/CLI lane; sessions are the data plane,
 * driven by the engine via the SDK.
 */
function applyPlan(): never {
  throw new Error(
    'apply is not implemented yet (Phase 2 TODO). The dry-run validated the spec; ' +
      'wire applyPlan() to the CMA adapter in @departments/agent-runtime to provision for real.',
  );
}

// ─── Entry point ────────────────────────────────────────────────────────────────

export function loadSpec(yamlPath: string): ProvisionSpec {
  const src = readFileSync(yamlPath, 'utf8');
  return parseSpec(src);
}

export function validateSpec(spec: ProvisionSpec): AgentPlan[] {
  return buildPlan(spec);
}

export function hasViolations(plans: readonly AgentPlan[]): boolean {
  return plans.some((p) => p.violations.length > 0 || p.specErrors.length > 0);
}

export type { ProvisionSpec, AgentSpec, AgentPlan, EnvironmentSpec };

function main(argv: readonly string[]): void {
  const apply = argv.includes('--apply');
  const here = dirname(fileURLToPath(import.meta.url));
  const yamlPath = resolve(here, 'provision-agents.yaml');

  const spec = loadSpec(yamlPath);
  const plans = validateSpec(spec);
  printPlan(spec, plans, apply);

  if (hasViolations(plans)) {
    // eslint-disable-next-line no-console
    console.error('✗ provisioning aborted: one or more (model, knob) violations above.\n');
    process.exitCode = 1;
    return;
  }

  if (!apply) {
    // eslint-disable-next-line no-console
    console.log('✓ all (model, knob) pairings valid. Dry-run only — nothing created.');
    // eslint-disable-next-line no-console
    console.log('  Re-run with --apply (and ANTHROPIC_API_KEY set) to provision for real.\n');
    return;
  }

  if (process.env.ANTHROPIC_API_KEY === undefined || process.env.ANTHROPIC_API_KEY === '') {
    // eslint-disable-next-line no-console
    console.error('✗ --apply requires ANTHROPIC_API_KEY in the environment.\n');
    process.exitCode = 1;
    return;
  }

  applyPlan();
}

// Run only when executed directly (not when imported by the test).
const invokedDirectly =
  typeof process !== 'undefined' &&
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (invokedDirectly) {
  main(process.argv.slice(2));
}
