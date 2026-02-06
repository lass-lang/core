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
}

// Re-export scanner types for consumers
export { Scanner } from './scanner.js';
export type { ScanResult, ScanOptions, ZoneSplit, ExpressionSplit } from './scanner.js';

// Re-export error types for consumers
export {
  LassTranspileError,
  ErrorCategory,
  formatLocation,
  type SourceLocation,
  type FileLocation,
} from './errors.js';

/**
 * Runtime helper function for expression output.
 * Story 2.4: Array auto-join and null/undefined handling.
 *
 * - null/undefined -> '' (React-style silent handling)
 * - arrays -> recursively flattened then joined with empty string (enables .map() patterns)
 *   - Nested arrays like [[1,2], [3,4]] become '1234' (fully flattened)
 *   - null/undefined elements in arrays are converted to empty string
 * - other values -> String coercion
 */
const LASS_EXPR_HELPER = `const __lassExpr = v => v == null ? '' : Array.isArray(v) ? v.flat(Infinity).map(x => x == null ? '' : String(x)).join('') : String(v);`;

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
 * Step 2: Process expressions in CSS zone.
 *
 * Finds {{ expr }} expressions and converts them to template literal interpolations.
 * Story 2.5: Expressions are processed EVERYWHERE in CSS zone (strings, url(), comments).
 *
 * @param cssZone - The CSS zone content
 * @param options - Transpile options (filename for errors)
 * @returns Processed template with body and expression flag
 */
function processExpressions(cssZone: string, options: TranspileOptions): ProcessedTemplate {
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
      // JS expression - wrap in ${__lassExpr(...)} for array/null handling
      templateBody += '${__lassExpr(' + exprSplit.parts[i] + ')}';
    }
  }

  return { templateBody, hasExpressions };
}

/**
 * Step 3: Build final JavaScript module output.
 *
 * Assembles preamble, helper function (if needed), and template literal export.
 *
 * @param zones - Detected zones from step 1
 * @param template - Processed template from step 2
 * @returns Final JavaScript module code
 */
function buildOutput(zones: DetectedZones, template: ProcessedTemplate): string {
  // Include helper function if expressions are present
  const helperLine = template.hasExpressions ? `${LASS_EXPR_HELPER}\n\n` : '';

  // Include preamble if present (non-empty after trimming)
  if (zones.hasSeparator && zones.preamble.trim()) {
    // Helper (if needed) + Preamble + blank line + export
    // Preamble executes when module is imported, variables are in scope
    return `${helperLine}${zones.preamble}\n\nexport default \`${template.templateBody}\`;`;
  } else {
    // No separator or empty/whitespace-only preamble - just export (with helper if needed)
    return `${helperLine}export default \`${template.templateBody}\`;`;
  }
}

// ============================================================================
// MAIN ENTRY POINT
// ============================================================================

/**
 * Transpiles Lass source code to a JavaScript module.
 *
 * The Story (Igloo Principle):
 * 1. First, we split the file into preamble and CSS zones at the ---
 * 2. Then, we find {{ expressions }} and make them interpolations
 * 3. Finally, we wrap it all in a JS module that exports CSS
 *
 * Implementation History:
 * - Story 1.4: CSS passthrough - wraps input in JS module export
 * - Story 2.1: Two-zone detection - splits on ---, identifies preamble and CSS zones
 * - Story 2.2: Preamble execution - includes preamble in output, executes when imported
 * - Story 2.3: Expression interpolation - transforms {{ expr }} to ${expr} in template literal
 * - Story 2.4: Array auto-join - wraps expressions in __lassExpr() for array/null handling
 * - Story 2.5: Universal {{ }} - processed everywhere in CSS zone (strings, url(), comments)
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

  // Step 2: Process {{ expressions }} in CSS zone
  const template = processExpressions(zones.cssZone, options);

  // Step 3: Assemble final JS module
  const code = buildOutput(zones, template);

  return { code };
}
