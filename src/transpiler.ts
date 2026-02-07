/**
 * Transpiler pipeline functions for @lass-lang/core
 *
 * Each function represents a step in the transpilation story.
 * See index.ts for the main entry point that orchestrates these steps.
 */

import { Scanner } from './scanner.js';
import { cutByBraces, findPropertyValue } from './scope-tracker.js';
import { escapeForTemplateLiteral, escapeForJs } from './helpers.js';
import { LASS_SCRIPT_EXPRESSION_HELPER, LASS_SCRIPT_LOOKUP_HELPER } from './constants.js';
import type { DetectedZones, ProcessedTemplate, DollarResolutionResult, TranspileOptions } from './types.js';

// ============================================================================
// STEP 1: ZONE DETECTION
// ============================================================================

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
export function detectZones(source: string, options: TranspileOptions): DetectedZones {
  const scanner = new Scanner(source, { filename: options.filename });
  const zones = scanner.findSeparator();

  return {
    preamble: zones.preamble,
    cssZone: zones.cssZone,
    hasSeparator: zones.hasSeparator,
  };
}

// ============================================================================
// STEP 2: COMMENT STRIPPING
// ============================================================================

/**
 * Step 2: Strip // comments from CSS zone.
 *
 * Story 4.4: Single-line comment stripping.
 * Removes // comments while respecting protected contexts (strings, url(), block comments).
 *
 * @param cssZone - The CSS zone content
 * @returns CSS zone with // comments removed
 */
export function stripLineComments(cssZone: string): string {
  return Scanner.stripLineCommentsStatic(cssZone);
}

// ============================================================================
// STEP 3a: STYLE LOOKUP SHORTHAND NORMALIZATION
// ============================================================================

/**
 * Step 3a: Normalize @prop shorthands to @(prop) form.
 *
 * Story 4.2: Style Lookup Shorthand
 *
 * Finds @prop patterns in CSS value position and converts them to @(prop).
 * This runs BEFORE @(prop) resolution so all lookups are handled uniformly.
 *
 * Detection rules:
 * - @prop shorthand only works when identifier starts with a letter [a-zA-Z]
 * - NOT detected inside {{ }} script blocks
 * - NOT detected inside protected contexts: strings, comments, url()
 *
 * @param cssZone - The CSS zone content
 * @returns CSS zone with @prop normalized to @(prop)
 */
export function normalizeStyleLookupShorthands(cssZone: string): string {
  if (!cssZone) {
    return cssZone;
  }

  const shorthands = Scanner.findStyleLookupShorthandsStatic(cssZone);

  if (shorthands.length === 0) {
    return cssZone;
  }

  // Process from end to start so indices remain valid
  let result = cssZone;

  for (let i = shorthands.length - 1; i >= 0; i--) {
    const shorthand = shorthands[i]!;
    const { propName, startIndex, endIndex } = shorthand;

    // Replace @prop with @(prop)
    result = result.slice(0, startIndex) + `@(${propName})` + result.slice(endIndex);
  }

  return result;
}

// ============================================================================
// STEP 3b: PROPERTY ACCESSOR RESOLUTION
// ============================================================================

/**
 * Step 3b: Resolve @(prop) accessors in CSS zone.
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
export function resolvePropertyAccessors(cssZone: string, _options: TranspileOptions): string {
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

// ============================================================================
// STEP 4: DOLLAR VARIABLE RESOLUTION
// ============================================================================

/**
 * Step 4: Replace $param variables with __lassScriptLookup() calls.
 *
 * Story 4.1: Variable Substitution
 *
 * Finds $param patterns in CSS zone and converts them to helper function calls.
 * This enables $-prefixed variables from the preamble to be substituted into CSS
 * with proper handling of null (-> 'unset') and undefined/missing (-> preserved).
 *
 * Protected contexts (strings, url(), comments) are skipped - $param inside these
 * remains as literal text. Use {{ $param }} for dynamic content in protected contexts.
 *
 * @param cssZone - The CSS zone content
 * @param _options - Transpile options (filename for errors)
 * @returns Result with modified CSS zone and flag indicating if helpers needed
 */
export function resolveDollarVariables(cssZone: string, _options: TranspileOptions): DollarResolutionResult {
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

// ============================================================================
// STEP 5: EXPRESSION PROCESSING
// ============================================================================

/**
 * Step 5: Process expressions in CSS zone.
 *
 * Finds {{ expr }} expressions and converts them to template literal interpolations.
 * Story 2.5: Expressions are processed EVERYWHERE in CSS zone (strings, url(), comments).
 *
 * @param cssZone - The CSS zone content
 * @param hasDollarVariables - Whether $param variables were found (passed through)
 * @param options - Transpile options (filename for errors)
 * @returns Processed template with body and expression flag
 */
export function processExpressions(cssZone: string, hasDollarVariables: boolean, options: TranspileOptions): ProcessedTemplate {
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

// ============================================================================
// STEP 6: OUTPUT BUILDING
// ============================================================================

/**
 * Step 6: Build final JavaScript module output.
 *
 * Assembles preamble, helper functions (if needed), and template literal export.
 *
 * @param zones - Detected zones from step 1
 * @param template - Processed template from step 5
 * @returns Final JavaScript module code
 */
export function buildOutput(zones: DetectedZones, template: ProcessedTemplate): string {
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
