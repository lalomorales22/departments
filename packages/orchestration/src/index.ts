/**
 * @departments/orchestration — the Loop Engine.
 *
 * Owns the PLAN→EXECUTE→EVALUATE→IMPROVE→MEMORY cycle, the state machine, gate
 * routing, the resumable bootstrap, and the budget-cap precedence rule. Talks to the
 * model only through `@departments/agent-runtime` and to the world only through the
 * ports here. The Temporal `LoopWorkflow` (apps/orchestrator) and the local driver
 * are two composition roots over this same engine.
 */
export * from './ports.js';
export * from './state-machine.js';
export * from './bootstrap.js';
export * from './engine.js';
export * from './local-driver.js';
// `./cli` is a runnable entry (see package.json exports), not re-exported here.
