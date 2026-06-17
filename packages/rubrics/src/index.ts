/**
 * @departments/rubrics — the checks-&-balances rubric library.
 *
 * Exposes the four gates (Quality, Data validation, Alignment/Risk, Performance) as
 * gradeable Markdown criteria (`GATE_CRITERIA` + `RubricLibrary`, which satisfies the
 * engine's `RubricPort`), plus a deterministic heuristic grader (`gradeSignals`) used
 * by the local/offline path and tests. The authoritative grader at runtime is the
 * independent CMA Outcome (Opus 4.8); this heuristic only scaffolds it locally.
 */
export { GATE_CRITERIA, RubricLibrary } from './rubrics';
export type { RubricCriteriaProvider } from './rubrics';
export { gradeSignals } from './grade';
export type { GateResult, GradeSignals } from './grade';
