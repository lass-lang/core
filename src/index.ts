/**
 * @lass-lang/core
 *
 * Lass language transpiler core package.
 * Converts .lass files to executable JavaScript modules that produce CSS.
 *
 * Transpilation Pipeline (The Story):
 * 1. detectZones() - Split source into preamble and CSS zones
 * 2. stripLineComments() - Remove // comments from CSS zone
 * 3. normalizeStyleLookupShorthands() - @prop -> @(prop)
 * 4. resolvePropertyAccessors() - @(prop) -> value
 * 5. resolveDollarVariables() - $param -> ${...}
 * 6. processExpressions() - {{ expr }} -> ${...}
 * 7. buildOutput() - Assemble final JS module
 *
 * This is the "igloo" view - each function is a building block.
 * Drill into transpiler.ts for step implementations.
 */

import {
  detectZones,
  stripLineComments,
  normalizeStyleLookupShorthands,
  resolvePropertyAccessors,
  resolveDollarVariables,
  processExpressions,
  buildOutput,
} from './transpiler.js';
import type { TranspileResult, TranspileOptions } from './types.js';

// ============================================================================
// MAIN ENTRY POINT
// ============================================================================

/**
 * Transpiles Lass source code to a JavaScript module.
 *
 * The Story (Igloo Principle):
 * 1. Split the file into preamble and CSS zones at the ---
 * 2. Strip // comments from CSS zone
 * 3. Normalize @prop -> @(prop) shorthands
 * 4. Resolve @(prop) accessors to their values
 * 5. Replace $param with ${...} for variable substitution
 * 6. Find {{ expressions }} and make them interpolations
 * 7. Wrap it all in a JS module that exports CSS
 *
 * Implementation History:
 * - Story 1.4: CSS passthrough - wraps input in JS module export
 * - Story 2.1: Two-zone detection - splits on ---, identifies preamble and CSS zones
 * - Story 2.2: Preamble execution - includes preamble in output, executes when imported
 * - Story 2.3: Expression interpolation - transforms {{ expr }} to ${expr} in template literal
 * - Story 2.4: Array auto-join - wraps expressions in __lassScriptExpression() for array/null handling
 * - Story 2.5: Universal {{ }} - processed everywhere in CSS zone (strings, url(), comments)
 * - Story 3.2: @(prop) resolution - resolves @(prop) to previously-declared CSS values (Phase 1)
 * - Story 3.3: @(prop) in {{ }} - detects @(prop) inside expressions, quotes values for JS context
 * - Refactored: Changed from @prop to @(prop) for unambiguous syntax (supports custom properties)
 * - Story 4.1: $param substitution - replaces $param with ${$param} for template literal interpolation
 * - Story 4.2: @prop shorthand - normalizes @prop to @(prop) before resolution
 * - Story 4.4: // comment stripping - removes single-line comments from CSS zone
 *
 * @param source - The Lass source code
 * @param options - Transpilation options
 * @returns The transpiled JavaScript module code
 */
export function transpile(
  source: string,
  options: TranspileOptions = {}
): TranspileResult {
  // Step 1: Split source into preamble and CSS zones
  const zones = detectZones(source, options);

  // Step 2: Strip // comments from CSS zone (before any symbol resolution)
  const strippedCssZone = stripLineComments(zones.cssZone);

  // Step 3a: Normalize @prop shorthands to @(prop) form
  const normalizedCssZone = normalizeStyleLookupShorthands(strippedCssZone);

  // Step 3b: Resolve @(prop) accessors (Phase 1 - before {{ }} processing)
  const resolvedCssZone = resolvePropertyAccessors(normalizedCssZone, options);

  // Step 4: Replace $param with __lassScriptLookup() calls for variable substitution
  const dollarResult = resolveDollarVariables(resolvedCssZone, options);

  // Step 5: Process {{ expressions }} in CSS zone (Phase 2)
  const template = processExpressions(dollarResult.cssZone, dollarResult.hasDollarVariables, options);

  // Step 6: Assemble final JS module
  const code = buildOutput(zones, template);

  return { code };
}

// ============================================================================
// RE-EXPORTS: PUBLIC TYPES
// ============================================================================

export type { TranspileResult, TranspileOptions } from './types.js';

// ============================================================================
// RE-EXPORTS: SCANNER
// ============================================================================

export { Scanner } from './scanner.js';
/**
 * Re-exported types from scanner module.
 * - ScanResult: Result of a scan operation
 * - ScanOptions: Options for scanner customization
 * - ZoneSplit: Result of zone separation (preamble/CSS)
 * - ExpressionSplit: Result of {{ }} expression splitting
 * - PropertyAccessor: Info about detected @(prop) accessor (propName, indices)
 * - DollarVariable: Info about detected $param variable (varName, indices)
 * - StyleLookupShorthand: Info about detected @prop shorthand (propName, indices)
 */
export type { ScanResult, ScanOptions, ZoneSplit, ExpressionSplit, PropertyAccessor, DollarVariable, StyleLookupShorthand } from './scanner.js';

// ============================================================================
// RE-EXPORTS: ERRORS
// ============================================================================

export {
  LassTranspileError,
  ErrorCategory,
  formatLocation,
  type SourceLocation,
  type FileLocation,
} from './errors.js';

// ============================================================================
// RE-EXPORTS: SCOPE TRACKER (for consumers needing low-level access)
// ============================================================================

export {
  cutByBraces,
  findPropertyValue,
  areSiblingTrees,
  isInsideAtRule,
  type ScopeSlice,
  type ScopeSlices,
} from './scope-tracker.js';


