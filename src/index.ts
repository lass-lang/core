/**
 * @lass-lang/core
 *
 * Lass language transpiler core package.
 * Converts .lass files to executable JavaScript modules that produce CSS.
 *
 * Transpilation Pipeline (The Story):
 * 1. detectZones() - Split source into preamble and CSS zones
 * 2. processExpressions() - Find {{ expr }} and build template literal body
 * 3. buildOutput() - Assemble final JS module from parts
 *
 * This is the "igloo" view - each function is a building block.
 * Drill into any function to see the implementation details (the "physics").
 */

import { Scanner } from './scanner.js';
import { cutByBraces, findPropertyValue } from './scope-tracker.js';

export interface TranspileResult {
  /** The generated JavaScript module code */
  code: string;
  /** Source map for error tracing (if enabled) */
  map?: string;
}

export interface TranspileOptions {
  /** Source file path for error messages */
  filename?: string;
  /** Generate source maps */
  sourceMap?: boolean;
}

/**
 * Internal result from zone detection.
 */
interface DetectedZones {
  /** JavaScript preamble content (above ---) */
  preamble: string;
  /** CSS zone content (below ---) */
  cssZone: string;
  /** Whether a valid --- separator was found */
  hasSeparator: boolean;
}

/**
 * Internal result from expression processing.
 */
interface ProcessedTemplate {
  /** The template literal body with ${} interpolations */
  templateBody: string;
  /** Whether any {{ expr }} expressions were found */
  hasExpressions: boolean;
  /** Whether any $param variables were found */
  hasDollarVariables: boolean;
}

// Re-export scanner types for consumers
export { Scanner } from './scanner.js';
/**
 * Re-exported types from scanner module.
 * - ScanResult: Result of a scan operation
 * - ScanOptions: Options for scanner customization
 * - ZoneSplit: Result of zone separation (preamble/CSS)
 * - ExpressionSplit: Result of {{ }} expression splitting
 * - PropertyAccessor: Info about detected @(prop) accessor (propName, indices)
 * - DollarVariable: Info about detected $param variable (varName, indices)
 */
export type { ScanResult, ScanOptions, ZoneSplit, ExpressionSplit, PropertyAccessor, DollarVariable } from './scanner.js';

// Re-export error types for consumers
export {
  LassTranspileError,
  ErrorCategory,
  formatLocation,
  type SourceLocation,
  type FileLocation,
} from './errors.js';

// Re-export scope tracker types and functions for consumers (Story 3.1, 3.3)
export {
  cutByBraces,
  findPropertyValue,
  areSiblingTrees,
  isInsideAtRule,
  type ScopeSlice,
  type ScopeSlices,
} from './scope-tracker.js';

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
const LASS_SCRIPT_EXPRESSION_HELPER = `const __lassScriptExpression = v => v == null ? '' : Array.isArray(v) ? v.flat(Infinity).map(x => x == null ? '' : String(x)).join('') : String(v);`;

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
const LASS_SCRIPT_LOOKUP_HELPER = `const __lassScriptLookup = (n, g) => { try { const v = g(); return v === null ? 'unset' : v === undefined ? '$' + n : v; } catch { return '$' + n; } };`;

// ============================================================================
// TRANSPILATION PIPELINE
// ============================================================================

/**
 * Escapes special characters for template literal embedding.
 * Only escapes backslash and backtick - NOT dollar sign (needed for substitution).
 *
 * @param text - Text to escape
 * @returns Escaped text safe for template literal
 */
function escapeForTemplateLiteral(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/`/g, '\\`');
}

/**
 * Step 1: Detect and split zones.
 *
 * Finds the --- separator and splits source into preamble and CSS zones.
 * If no separator, entire source is the CSS zone (pure CSS passthrough).
 *
 * @param source - Raw Lass source code
 * @param options - Transpile options (filename for errors)
 * @returns Detected zones with preamble and cssZone
 */
function detectZones(source: string, options: TranspileOptions): DetectedZones {
  const scanner = new Scanner(source, { filename: options.filename });
  const zones = scanner.findSeparator();

  return {
    preamble: zones.preamble,
    cssZone: zones.cssZone,
    hasSeparator: zones.hasSeparator,
  };
}

/**
 * Escapes a value for embedding in a JavaScript string literal.
 * Story 3.3: Used when @(prop) is inside {{ }} context.
 *
 * Escapes: backslash, double quote, newline, carriage return
 *
 * @param value - The value to escape
 * @returns Escaped value safe for JS string embedding
 */
function escapeForJs(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r');
}

/**
 * Step 2: Resolve @(prop) accessors in CSS zone.
 *
 * Story 3.2: Basic Property Lookup
 * Story 3.3: Lookup in {{ }} Context
 * Refactored: Changed from @prop to @(prop) for unambiguous syntax
 *
 * Finds @(prop) patterns in CSS value position and resolves them to their
 * previously-declared values using scope tracking utilities.
 *
 * Resolution rules:
 * - Property found in CSS context -> Replace @(prop) with resolved value
 * - Property found in JS context (inside {{ }}) -> Replace with quoted value
 * - Property not found -> Preserve @(prop) unchanged (PostCSS/future CSS compatibility)
 *
 * This is Phase 1 of transpilation and runs BEFORE {{ }} processing.
 *
 * @param cssZone - The CSS zone content
 * @param options - Transpile options (filename for errors)
 * @returns CSS zone with @(prop) accessors resolved (or preserved if not found)
 */
function resolvePropertyAccessors(cssZone: string, _options: TranspileOptions): string {
  if (!cssZone) {
    return cssZone;
  }

  // Use static method to avoid creating unnecessary Scanner instance
  const accessors = Scanner.findPropertyAccessorsStatic(cssZone);

  if (accessors.length === 0) {
    return cssZone;
  }

  // Get scope slices for property lookup
  const { slices } = cutByBraces(cssZone);

  // Build a map of character positions to slice indices
  // cutByBraces splits at { and }, so we need to track where each slice starts
  // Account for {{ (2 chars) vs { (1 char) by reconstructing from slice content and types
  const sliceStartPositions: number[] = [];
  let pos = 0;
  for (let s = 0; s < slices.length; s++) {
    sliceStartPositions.push(pos);
    pos += slices[s]!.content.length;
    // Add brace characters between slices (except after last)
    if (s < slices.length - 1) {
      // Look at the NEXT slice to determine what brace opened it
      const nextSlice = slices[s + 1]!;
      // If next slice is JS type, we crossed {{ (2 chars)
      // If current slice is JS type and next is CSS, we crossed }} (2 chars)
      // Otherwise single brace (1 char)
      if (nextSlice.type === 'js' || (slices[s]!.type === 'js' && nextSlice.type === 'css')) {
        pos += 2; // {{ or }}
      } else {
        pos += 1; // { or }
      }
    }
  }

  // Build result by replacing @(prop) with resolved values (or preserving)
  // Process from end to start so indices remain valid
  let result = cssZone;

  for (let i = accessors.length - 1; i >= 0; i--) {
    const accessor = accessors[i]!;
    const { propName, startIndex, endIndex } = accessor;

    // Find which slice contains this @(prop)
    let sliceIndex = 0;
    for (let s = slices.length - 1; s >= 0; s--) {
      if (startIndex >= sliceStartPositions[s]!) {
        sliceIndex = s;
        break;
      }
    }

    // Position within the slice (for self-reference protection)
    const positionInSlice = startIndex - sliceStartPositions[sliceIndex]!;

    // Look up the property value
    const value = findPropertyValue(propName, slices, sliceIndex, positionInSlice);

    // Only replace if we found a value (non-empty string)
    // If not found, preserve the original @(prop) (PostCSS/future CSS compatibility)
    if (value !== '') {
      // Story 3.3: If @(prop) is inside a JS-type slice, quote the value
      const slice = slices[sliceIndex]!;
      const replacement = slice.type === 'js' 
        ? `"${escapeForJs(value)}"` 
        : value;
      result = result.slice(0, startIndex) + replacement + result.slice(endIndex);
    }
  }

  return result;
}

/**
 * Result from dollar variable resolution.
 */
interface DollarResolutionResult {
  /** The CSS zone with $param replaced by helper calls */
  cssZone: string;
  /** Whether any $param variables were found */
  hasDollarVariables: boolean;
}

/**
 * Step 3: Replace $param variables with __lassScriptLookup() calls.
 *
 * Story 4.1: Variable Substitution
 *
 * Finds $param patterns in CSS zone and converts them to helper function calls.
 * This enables $-prefixed variables from the preamble to be substituted into CSS
 * with proper handling of null (→ 'unset') and undefined/missing (→ preserved).
 *
 * Protected contexts (strings, url(), comments) are skipped - $param inside these
 * remains as literal text. Use {{ $param }} for dynamic content in protected contexts.
 *
 * @param cssZone - The CSS zone content
 * @param _options - Transpile options (filename for errors)
 * @returns Result with modified CSS zone and flag indicating if helpers needed
 */
function resolveDollarVariables(cssZone: string, _options: TranspileOptions): DollarResolutionResult {
  if (!cssZone) {
    return { cssZone, hasDollarVariables: false };
  }

  // Use static method to find all $param occurrences
  const variables = Scanner.findDollarVariablesStatic(cssZone);

  if (variables.length === 0) {
    return { cssZone, hasDollarVariables: false };
  }

  // Process from end to start so indices remain valid
  let result = cssZone;

  for (let i = variables.length - 1; i >= 0; i--) {
    const variable = variables[i]!;
    const { varName, startIndex, endIndex } = variable;

    // Replace $varName with ${__lassScriptLookup('name', () => $varName)}
    // The name parameter is without the $ prefix (helper adds it back for preserved output)
    const nameWithoutDollar = varName.slice(1); // Remove leading $
    const replacement = `\${__lassScriptLookup('${nameWithoutDollar}', () => ${varName})}`;
    result = result.slice(0, startIndex) + replacement + result.slice(endIndex);
  }

  return { cssZone: result, hasDollarVariables: true };
}

/**
 * Step 4: Process expressions in CSS zone.
 *
 * Finds {{ expr }} expressions and converts them to template literal interpolations.
 * Story 2.5: Expressions are processed EVERYWHERE in CSS zone (strings, url(), comments).
 *
 * @param cssZone - The CSS zone content
 * @param hasDollarVariables - Whether $param variables were found (passed through)
 * @param options - Transpile options (filename for errors)
 * @returns Processed template with body and expression flag
 */
function processExpressions(cssZone: string, hasDollarVariables: boolean, options: TranspileOptions): ProcessedTemplate {
  const scanner = new Scanner(cssZone, { filename: options.filename });
  const exprSplit = scanner.findExpressions(cssZone);

  const hasExpressions = exprSplit.parts.length > 1;

  // Build template literal content with ${} interpolations
  let templateBody = '';
  for (let i = 0; i < exprSplit.parts.length; i++) {
    if (i % 2 === 0) {
      // CSS chunk - escape for template literal
      templateBody += escapeForTemplateLiteral(exprSplit.parts[i]!);
    } else {
      // JS expression - wrap in ${__lassScriptExpression(...)} for array/null handling
      templateBody += '${__lassScriptExpression(' + exprSplit.parts[i] + ')}';
    }
  }

  return { templateBody, hasExpressions, hasDollarVariables };
}

/**
 * Step 5: Build final JavaScript module output.
 *
 * Assembles preamble, helper functions (if needed), and template literal export.
 *
 * @param zones - Detected zones from step 1
 * @param template - Processed template from step 4
 * @returns Final JavaScript module code
 */
function buildOutput(zones: DetectedZones, template: ProcessedTemplate): string {
  // Include helper functions as needed
  let helpers = '';
  if (template.hasExpressions) {
    helpers += LASS_SCRIPT_EXPRESSION_HELPER + '\n';
  }
  if (template.hasDollarVariables) {
    helpers += LASS_SCRIPT_LOOKUP_HELPER + '\n';
  }
  if (helpers) {
    helpers += '\n'; // Extra blank line after helpers
  }

  // Include preamble if present (non-empty after trimming)
  if (zones.hasSeparator && zones.preamble.trim()) {
    // Helpers (if needed) + Preamble + blank line + export
    // Preamble executes when module is imported, variables are in scope
    return `${helpers}${zones.preamble}\n\nexport default \`${template.templateBody}\`;`;
  } else {
    // No separator or empty/whitespace-only preamble - just export (with helpers if needed)
    return `${helpers}export default \`${template.templateBody}\`;`;
  }
}

// ============================================================================
// MAIN ENTRY POINT
// ============================================================================

/**
 * Transpiles Lass source code to a JavaScript module.
 *
 * The Story (Igloo Principle):
 * 1. Split the file into preamble and CSS zones at the ---
 * 2. Resolve @(prop) accessors to their values (Phase 1)
 * 3. Replace $param with ${$param} for variable substitution
 * 4. Find {{ expressions }} and make them interpolations (Phase 2)
 * 5. Wrap it all in a JS module that exports CSS
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

  // Step 2: Resolve @(prop) accessors (Phase 1 - before {{ }} processing)
  const resolvedCssZone = resolvePropertyAccessors(zones.cssZone, options);

  // Step 3: Replace $param with __lassScriptLookup() calls for variable substitution
  const dollarResult = resolveDollarVariables(resolvedCssZone, options);

  // Step 4: Process {{ expressions }} in CSS zone (Phase 2)
  const template = processExpressions(dollarResult.cssZone, dollarResult.hasDollarVariables, options);

  // Step 5: Assemble final JS module
  const code = buildOutput(zones, template);

  return { code };
}
