/**
 * Runtime helper constants for @lass-lang/core
 *
 * These are JavaScript code strings that get injected into the transpiled
 * output. They provide runtime behavior for Lass symbols.
 */

/**
 * Runtime helper function for {{ expression }} output.
 * Story 2.4: Array auto-join and null/undefined handling.
 * Enhanced: Falsy suppression and multi-line re-indentation.
 *
 * - null/undefined/false -> '' (React-style silent handling)
 * - arrays -> recursively flattened, filtered, stringified, then joined
 *   - If any element contains newline, join with newline (multi-line blocks)
 *   - Otherwise join with empty string (inline values)
 * - other values -> String coercion
 * - Multi-line strings are re-indented using the optional indent parameter
 */
export const LASS_SCRIPT_EXPRESSION_HELPER = `const __lassScriptExpression = (v, indent = '') => { if (v == null || v === false) return ''; if (Array.isArray(v)) { const a = v.flat(Infinity).map(x => (x == null || x === false) ? '' : String(x)).filter(x => x); const sep = a.some(x => x.includes('\\n')) ? '\\n' : ''; return a.join(sep); } const s = String(v); if (!indent || !s.includes('\\n')) return s; return s.split('\\n').map((l, i) => i === 0 ? l : indent + l).join('\\n'); };`;

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
