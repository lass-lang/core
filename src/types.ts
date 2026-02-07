/**
 * Type definitions for @lass-lang/core
 *
 * All public and internal types used by the transpiler.
 */

// ============================================================================
// PUBLIC TYPES
// ============================================================================

/**
 * Result from transpile().
 */
export interface TranspileResult {
  /** The generated JavaScript module code */
  code: string;
  /** Source map for error tracing (if enabled) */
  map?: string;
}

/**
 * Options for transpile().
 */
export interface TranspileOptions {
  /** Source file path for error messages */
  filename?: string;
  /** Generate source maps */
  sourceMap?: boolean;
}

// ============================================================================
// INTERNAL TYPES
// ============================================================================

/**
 * Result from zone detection (Step 1).
 */
export interface DetectedZones {
  /** JavaScript preamble content (above ---) */
  preamble: string;
  /** CSS zone content (below ---) */
  cssZone: string;
  /** Whether a valid --- separator was found */
  hasSeparator: boolean;
}

/**
 * Result from expression processing (Step 5).
 */
export interface ProcessedTemplate {
  /** The template literal body with ${} interpolations */
  templateBody: string;
  /** Whether any {{ expr }} expressions were found */
  hasExpressions: boolean;
  /** Whether any $param variables were found */
  hasDollarVariables: boolean;
}

/**
 * Result from dollar variable resolution (Step 4).
 */
export interface DollarResolutionResult {
  /** The CSS zone with $param replaced by helper calls */
  cssZone: string;
  /** Whether any $param variables were found */
  hasDollarVariables: boolean;
}
