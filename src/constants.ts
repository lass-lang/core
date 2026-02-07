/**
 * Runtime helper constants for @lass-lang/core
 *
 * These are JavaScript code strings that get injected into the transpiled
 * output. They provide runtime behavior for Lass symbols.
 */

/**
 * Runtime helper function for {{ expression }} output.
 * Story 2.4: Array auto-join and null/undefined handling.
 *
 * - null/undefined -> '' (React-style silent handling)
 * - arrays -> recursively flattened then joined with empty string (enables .map() patterns)
 *   - Nested arrays like [[1,2], [3,4]] become '1234' (fully flattened)
 *   - null/undefined elements in arrays are converted to empty string
 * - other values -> String coercion
 */
export const LASS_SCRIPT_EXPRESSION_HELPER = `const __lassScriptExpression = v => v == null ? '' : Array.isArray(v) ? v.flat(Infinity).map(x => x == null ? '' : String(x)).join('') : String(v);`;

/**
 * Runtime helper function for $param variable substitution.
 * Story 4.1: Variable Substitution
 *
 * - null -> 'unset' (CSS-meaningful fallback)
 * - undefined or ReferenceError -> preserve '$name' unchanged
 * - other values -> String coercion
 *
 * The getter function (g) delays evaluation so we can catch ReferenceError
 * for non-existent variables.
 */
export const LASS_SCRIPT_LOOKUP_HELPER = `const __lassScriptLookup = (n, g) => { try { const v = g(); return v === null ? 'unset' : v === undefined ? '$' + n : v; } catch { return '$' + n; } };`;
