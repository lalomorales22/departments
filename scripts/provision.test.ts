/**
 * Tests for the provisioning loader + (model, knob) validator.
 *
 * The point of this script is that a guaranteed-400 (model, knob) pairing is caught at
 * provision time, not against the live API. These tests prove:
 *   1. the SHIPPED `provision-agents.yaml` parses and is policy-clean;
 *   2. each forbidden pairing, written into a spec, is REJECTED through the same loader;
 *   3. the legal pairings (omitted effort on Haiku, omitted thinking on Fable, etc.) pass.
 *
 * No network, no SDK — `validateKnobs` from @departments/agent-runtime is pure, and the
 * apply step is gated behind ANTHROPIC_API_KEY + --apply (untouched here).
 */
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

import { describe, it, expect, afterAll } from 'vitest';

import { loadSpec, validateSpec, hasViolations, type AgentPlan } from './provision';

const here = dirname(fileURLToPath(import.meta.url));
const SHIPPED_YAML = resolve(here, 'provision-agents.yaml');

/** Write a transient spec to a temp file and run it through the real loader. */
const tmpRoot = mkdtempSync(join(tmpdir(), 'departments-provision-'));
afterAll(() => rmSync(tmpRoot, { recursive: true, force: true }));

let tmpCounter = 0;
function planFromYaml(yaml: string): AgentPlan[] {
  const path = join(tmpRoot, `spec-${tmpCounter++}.yaml`);
  writeFileSync(path, yaml, 'utf8');
  return validateSpec(loadSpec(path));
}

function planForRole(plans: readonly AgentPlan[], role: string): AgentPlan {
  const plan = plans.find((p) => p.agent.role === role);
  if (plan === undefined) throw new Error(`no plan for role "${role}"`);
  return plan;
}

const ENV_HEADER = `
version: 1
department: test
environment:
  name: test-env
  config:
    type: cloud
    networking:
      type: unrestricted
agents:
`;

// ─── The shipped spec ───────────────────────────────────────────────────────────

describe('the shipped provision-agents.yaml', () => {
  const plans = validateSpec(loadSpec(SHIPPED_YAML));

  it('parses into the full canonical roster + worker + gated strategy', () => {
    const roles = plans.map((p) => p.agent.role).sort();
    expect(roles).toEqual(
      ['coordinator', 'docs', 'executor', 'planner', 'qa', 'reviewer', 'strategy', 'worker'].sort(),
    );
  });

  it('has ZERO (model, knob) violations or spec errors — the table is policy-clean', () => {
    for (const plan of plans) {
      expect(plan.violations, `${plan.agent.role} violations`).toEqual([]);
      expect(plan.specErrors, `${plan.agent.role} spec errors`).toEqual([]);
    }
    expect(hasViolations(plans)).toBe(false);
  });

  it('pins the EXACT model tiering from README/TASKS per role', () => {
    expect(planForRole(plans, 'planner').agent.modelId).toBe('claude-opus-4-8');
    expect(planForRole(plans, 'executor').agent.modelId).toBe('claude-sonnet-4-6');
    expect(planForRole(plans, 'qa').agent.modelId).toBe('claude-sonnet-4-6');
    expect(planForRole(plans, 'docs').agent.modelId).toBe('claude-sonnet-4-6');
    expect(planForRole(plans, 'reviewer').agent.modelId).toBe('claude-opus-4-8');
    expect(planForRole(plans, 'coordinator').agent.modelId).toBe('claude-opus-4-8');
    expect(planForRole(plans, 'strategy').agent.modelId).toBe('claude-fable-5');
    expect(planForRole(plans, 'worker').agent.modelId).toBe('claude-haiku-4-5');
  });

  it('pins the effort knob per tier (planner high, executor medium, reviewer high)', () => {
    expect(planForRole(plans, 'planner').agent.effort).toBe('high');
    expect(planForRole(plans, 'executor').agent.effort).toBe('medium');
    expect(planForRole(plans, 'reviewer').agent.effort).toBe('high');
    expect(planForRole(plans, 'coordinator').agent.effort).toBe('high');
    expect(planForRole(plans, 'strategy').agent.effort).toBe('xhigh');
  });

  it('OMITS effort and adaptive thinking on the Haiku worker (both 400 otherwise)', () => {
    const worker = planForRole(plans, 'worker').agent;
    expect(worker.effort).toBeUndefined();
    expect(worker.thinking).toBeUndefined();
  });

  it('OMITS the thinking param on Fable (always-on) and wires the refusal-safe path', () => {
    const strategy = planForRole(plans, 'strategy').agent;
    expect(strategy.thinking).toBeUndefined(); // never thinking:{type:"disabled"}
    expect(strategy.betas).toContain('server-side-fallback-2026-06-01');
    expect(strategy.fallbacks).toContain('claude-opus-4-8');
    expect(strategy.dataRetentionDays).toBe(30);
  });

  it('gates the strategy agent out of the default apply set', () => {
    expect(planForRole(plans, 'strategy').agent.enabled).toBe(false);
    // Every other role is enabled by default.
    for (const plan of plans) {
      if (plan.agent.role !== 'strategy') {
        expect(plan.agent.enabled, `${plan.agent.role} enabled`).toBe(true);
      }
    }
  });
});

// ─── Forbidden pairings are rejected through the same loader ─────────────────────

describe('forbidden (model, knob) pairings are rejected at provision time', () => {
  function badAgent(model: string, extra: string): string {
    return `${ENV_HEADER}  - role: bad
    name: bad-agent
    model: ${model}
${extra}`;
  }

  it('rejects Sonnet 4.6 + xhigh (no xhigh rung — caps at max)', () => {
    const plans = planFromYaml(badAgent('claude-sonnet-4-6', '    effort: xhigh\n    thinking: adaptive'));
    expect(hasViolations(plans)).toBe(true);
    expect(planForRole(plans, 'bad').violations.join(' ')).toMatch(/xhigh/i);
  });

  it('rejects Haiku 4.5 + effort (the effort param errors on Haiku)', () => {
    const plans = planFromYaml(badAgent('claude-haiku-4-5', '    effort: low'));
    expect(hasViolations(plans)).toBe(true);
    expect(planForRole(plans, 'bad').violations.join(' ')).toMatch(/effort/i);
  });

  it('rejects Haiku 4.5 + adaptive thinking (Haiku is not adaptive)', () => {
    const plans = planFromYaml(badAgent('claude-haiku-4-5', '    thinking: adaptive'));
    expect(hasViolations(plans)).toBe(true);
    expect(planForRole(plans, 'bad').violations.join(' ')).toMatch(/adaptive/i);
  });

  it('rejects Fable 5 + thinking:disabled (must omit the param)', () => {
    const plans = planFromYaml(
      badAgent(
        'claude-fable-5',
        '    effort: xhigh\n    thinking: disabled\n    betas:\n      - server-side-fallback-2026-06-01\n    fallbacks:\n      - claude-opus-4-8\n    data_retention_days: 30',
      ),
    );
    expect(hasViolations(plans)).toBe(true);
    expect(planForRole(plans, 'bad').violations.join(' ')).toMatch(/disabled|omit/i);
  });

  it('rejects a Fable 5 agent missing the server-side fallback wiring', () => {
    // Knob-legal (effort xhigh, thinking omitted) but spec-incomplete: no fallbacks.
    const plans = planFromYaml(badAgent('claude-fable-5', '    effort: xhigh'));
    expect(hasViolations(plans)).toBe(true);
    const errs = planForRole(plans, 'bad').specErrors.join(' ');
    expect(errs).toMatch(/fallback/i);
    expect(errs).toMatch(/retention/i);
  });
});

// ─── Legal pairings pass clean ───────────────────────────────────────────────────

describe('legal pairings pass clean through the loader', () => {
  it('Opus 4.8 + high + adaptive is clean', () => {
    const plans = planFromYaml(`${ENV_HEADER}  - role: ok
    name: ok
    model: claude-opus-4-8
    effort: high
    thinking: adaptive`);
    expect(planForRole(plans, 'ok').violations).toEqual([]);
    expect(planForRole(plans, 'ok').specErrors).toEqual([]);
  });

  it('Sonnet 4.6 + max + adaptive is clean (max is the ceiling, not xhigh)', () => {
    const plans = planFromYaml(`${ENV_HEADER}  - role: ok
    name: ok
    model: claude-sonnet-4-6
    effort: max
    thinking: adaptive`);
    expect(planForRole(plans, 'ok').violations).toEqual([]);
  });

  it('Haiku 4.5 with NO effort and NO thinking is clean', () => {
    const plans = planFromYaml(`${ENV_HEADER}  - role: ok
    name: ok
    model: claude-haiku-4-5`);
    expect(planForRole(plans, 'ok').violations).toEqual([]);
    expect(planForRole(plans, 'ok').agent.effort).toBeUndefined();
  });

  it('Fable 5 + xhigh, thinking omitted, fallbacks + 30d retention is clean', () => {
    const plans = planFromYaml(`${ENV_HEADER}  - role: ok
    name: ok
    model: claude-fable-5
    effort: xhigh
    betas:
      - server-side-fallback-2026-06-01
    fallbacks:
      - claude-opus-4-8
    data_retention_days: 30`);
    expect(planForRole(plans, 'ok').violations).toEqual([]);
    expect(planForRole(plans, 'ok').specErrors).toEqual([]);
  });
});
