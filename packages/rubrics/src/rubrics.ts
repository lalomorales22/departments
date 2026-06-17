/**
 * The four gates as gradeable Markdown criteria — the checks-&-balances rubric
 * library. Drawn from the README "The four gates":
 *
 *   | Quality        | Standards met, outputs correct and complete         |
 *   | Data validation| Accuracy of facts, numbers, and claims              |
 *   | Alignment/Risk | On-mission, safe, and within policy                 |
 *   | Performance    | Measured against success metrics; optimize          |
 *
 * These criteria are the gate definitions handed to the *independent* grader. The
 * AUTHORITATIVE grader is the CMA Outcome run in its own context on Opus 4.8
 * (`user.define_outcome` + this rubric) — never the executor (no self-grading). The
 * local heuristic in `./grade` exists only for the fake/offline path and tests.
 */
import type { RubricCategory } from '@departments/shared';

/**
 * Concise, gradeable Markdown criteria per gate. Each value is a self-contained
 * checklist the grader can score independently; bullets are the pass conditions.
 */
export const GATE_CRITERIA: Record<RubricCategory, string> = {
  quality: [
    '## Quality',
    'Standards are met; the output is correct and complete.',
    '',
    '- The work fulfils the stated task with no obvious gaps or TODOs left behind.',
    '- A real, meaningful change exists (source/content/decision), not empty or churn-only edits.',
    '- Code/content follows project conventions and is clean and readable.',
    '- Tests/checks that apply to the change exist and would pass.',
  ].join('\n'),
  data_validation: [
    '## Data validation',
    'Facts, numbers, and claims are accurate.',
    '',
    '- Every factual claim is verifiable against a source or the artifacts themselves.',
    '- Numbers, metrics, and calculations are correct and internally consistent.',
    '- No fabricated, hallucinated, or unverified assertions are presented as fact.',
    '- Cited references resolve and actually support the claim made.',
  ].join('\n'),
  alignment_risk: [
    '## Alignment / Risk & Security',
    'The work is on-mission, safe, and within policy.',
    '',
    "- The output advances the loop's mission and stays within its declared scope.",
    '- No unsafe, out-of-policy, or irreversible action is taken without an approval gate.',
    '- No secrets, credentials, or PII leak into artifacts, prompts, or event history.',
    '- This gate is scored by an INDEPENDENT reviewer, never the agent that produced the work.',
  ].join('\n'),
  performance: [
    '## Performance',
    'Measured against the success metrics; optimize.',
    '',
    '- The relevant success metrics moved in the intended (good) direction.',
    '- No tracked metric regressed without an explicit, justified trade-off.',
    '- The result is measured against the mission goals, not merely asserted as done.',
    '- Cost/effort is proportionate to the value delivered.',
  ].join('\n'),
};

/**
 * Structural mirror of `RubricPort` from `@departments/orchestration`. Declared
 * locally so this package does not depend on the engine (the engine wires this
 * library at its composition root, not the reverse). `RubricLibrary` satisfies the
 * engine's `RubricPort` by shape.
 */
export interface RubricCriteriaProvider {
  criteria(loopId: string): Record<RubricCategory, string>;
}

/**
 * The default rubric library. Returns the shared `GATE_CRITERIA` for every loop.
 *
 * The `loopId` parameter is accepted now so per-loop rubric overrides can be layered
 * in later (e.g. a marketing loop tightening its data-validation criteria) without a
 * signature change; for now it is intentionally ignored.
 */
export class RubricLibrary implements RubricCriteriaProvider {
  criteria(loopId: string): Record<RubricCategory, string> {
    void loopId;
    return GATE_CRITERIA;
  }
}
