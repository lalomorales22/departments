/**
 * @departments/shared — cross-package domain contract.
 *
 * Single source of truth for enums, entity types, and the canonical lifecycle
 * pipeline. Imported by web, gateway, orchestrator, events, db, and fixtures so the
 * whole stack speaks one vocabulary.
 */
export * from './enums';
export * from './types';
export * from './pipeline';
