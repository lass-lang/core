/**
 * Transpiler pipeline functions for @lass-lang/core
 *
 * Each function represents a step in the transpilation story.
 * See index.ts for the main entry point that orchestrates these steps.
 */

import { Scanner } from './scanner.js';
import { cutByBraces, findPropertyValue, type ScopeSlice } from './scope-tracker.js';
import { escapeForTemplateLiteral, escapeForJs } from './helpers.js';
import { LASS_SCRIPT_EXPRESSION_HELPER, LASS_SCRIPT_LOOKUP_HELPER } from './constants.js';
import { createContextState, updateContextState, isInProtectedContext } from './context-tracker.js';
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
  // cutByBraces splits at braces, so we need to track where each slice starts
  // Use openedBy to determine brace size: '{{' = 2, '@{' = 2, '{' = 1, null = 0
  const sliceStartPositions: number[] = [];
  let pos = 0;
  for (let s = 0; s < slices.length; s++) {
    sliceStartPositions.push(pos);
    pos += slices[s]!.content.length;
    // Add brace characters between slices (except after last)
    if (s < slices.length - 1) {
      // Look at the NEXT slice to determine what brace opened it
      const nextSlice = slices[s + 1]!;
      switch (nextSlice.openedBy) {
        case '{{':
        case '@{':
          pos += 2; // {{ or @{ are 2 chars
          break;
        case '{':
          pos += 1; // { is 1 char
          break;
        default:
          // Closing brace - need to determine size from current slice's context
          // If current was opened by {{ → closing is }} (2 chars)
          // If current was opened by @{ → closing is } (1 char)
          // If current was opened by { → closing is } (1 char)
          const currentSlice = slices[s]!;
          if (currentSlice.openedBy === '{{') {
            pos += 2; // }}
          } else {
            pos += 1; // }
          }
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
// STEP 5a: STYLE BLOCK TRANSLATION
// ============================================================================

/**
 * Result from style block translation.
 */
export interface StyleBlockTranslationResult {
  /** The translated text */
  text: string;
  /** Whether any $param variables were found in style blocks */
  hasDollarVariables: boolean;
}

/**
 * Translates @{ } style blocks to JS template literals.
 *
 * Story 5.1: Style Block Syntax
 *
 * @{ } is purely delimiter translation:
 * - @{ → backtick (`)
 * - } (matching @{) → backtick (`)
 * - {{ }} inside @{ } → ${ } with __lassScriptExpression helper
 * - $param inside @{ } → ${__lassScriptLookup(...)} for proper null/undefined handling
 *
 * This function handles brace matching to find the correct closing }.
 * Nested braces (from object literals, ternaries, etc.) are tracked.
 *
 * Protected contexts (where @{ is NOT translated):
 * - Inside string literals ("..." or '...')
 * - Inside block comments
 * - Note: url() is NOT protected - @{ inside url() IS translated
 *
 * @param text - JS code containing @{ } style blocks
 * @returns Result with translated text and flag for $param usage
 */
export function translateStyleBlocks(text: string): StyleBlockTranslationResult {
  if (!text || !text.includes('@{')) {
    return { text, hasDollarVariables: false };
  }

  const state = createContextState();
  let result = '';
  let i = 0;
  let hasDollarVars = false;

  while (i < text.length) {
    const char = text[i]!;
    const nextChar = text[i + 1];

    // Update context state for strings and block comments
    const consumed = updateContextState(text, i, state);
    if (consumed === 2) {
      result += text.slice(i, i + 2);
      i += 2;
      continue;
    }

    // Skip string quote characters
    if (char === '"' || char === "'") {
      result += char;
      i++;
      continue;
    }

    // Skip if in protected context
    if (isInProtectedContext(state)) {
      result += char;
      i++;
      continue;
    }

    // Check for @{ style block opener
    if (char === '@' && nextChar === '{') {
      // Found style block - find matching }
      const closeIndex = findStyleBlockClose(text, i + 2);

      if (closeIndex === -1) {
        // No matching } found - treat as literal text
        result += '@{';
        i += 2;
        continue;
      }

      // Extract content between @{ and }
      const content = text.slice(i + 2, closeIndex);

      // Recursively translate any nested @{ } inside
      const nestedResult = translateStyleBlocks(content);
      if (nestedResult.hasDollarVariables) {
        hasDollarVars = true;
      }

      // Translate $param to ${__lassScriptLookup(...)} inside the style block content
      const dollarResult = translateDollarVariablesInStyleBlock(nestedResult.text);
      if (dollarResult.hasDollarVariables) {
        hasDollarVars = true;
      }

      // Translate {{ }} to ${__lassScriptExpression(...)} inside the style block content
      const finalContent = translateMustacheToInterpolation(dollarResult.text);

      // Output as template literal
      result += '`' + finalContent + '`';
      i = closeIndex + 1;
      continue;
    }

    result += char;
    i++;
  }

  return { text: result, hasDollarVariables: hasDollarVars };
}

/**
 * Finds the matching closing } for a style block.
 *
 * Tracks brace depth to handle nested braces from:
 * - Object literals: { key: value }
 * - Ternary expressions: { ... } in conditionals
 * - CSS blocks inside {{ }}
 *
 * But {{ and }} are treated specially - they don't affect brace depth.
 *
 * @param text - Full text to scan
 * @param startIndex - Index right after @{ (first char of content)
 * @returns Index of closing } or -1 if not found
 */
function findStyleBlockClose(text: string, startIndex: number): number {
  const state = createContextState();
  let braceDepth = 0;
  let i = startIndex;

  while (i < text.length) {
    const char = text[i]!;
    const nextChar = text[i + 1];

    // Update context state for strings and block comments
    const consumed = updateContextState(text, i, state);
    if (consumed === 2) {
      i += 2;
      continue;
    }

    // Skip string quote characters
    if (char === '"' || char === "'") {
      i++;
      continue;
    }

    // Skip if in protected context
    if (isInProtectedContext(state)) {
      i++;
      continue;
    }

    // Handle {{ - don't count as single {
    if (char === '{' && nextChar === '{') {
      i += 2;
      continue;
    }

    // Handle }} - don't count as single }
    if (char === '}' && nextChar === '}') {
      i += 2;
      continue;
    }

    // Handle nested @{ - increase depth
    if (char === '@' && nextChar === '{') {
      braceDepth++;
      i += 2;
      continue;
    }

    // Single { increases depth
    if (char === '{') {
      braceDepth++;
      i++;
      continue;
    }

    // Single } decreases depth or closes style block
    if (char === '}') {
      if (braceDepth === 0) {
        // This is our closing }
        return i;
      }
      braceDepth--;
      i++;
      continue;
    }

    i++;
  }

  // No matching } found
  return -1;
}

/**
 * Translates {{ expr }} to ${__lassScriptExpression(expr)} inside style block content.
 *
 * This is applied after @{ } is translated to backticks, so any {{ }} inside
 * becomes template literal interpolations with proper array/null handling.
 *
 * @param text - Content inside a style block
 * @returns Text with {{ }} translated to ${__lassScriptExpression(...)}
 */
function translateMustacheToInterpolation(text: string): string {
  let result = '';
  let i = 0;

  while (i < text.length) {
    // Check for {{
    if (text[i] === '{' && text[i + 1] === '{') {
      // Find matching }}
      let depth = 0;
      let j = i + 2;
      while (j < text.length - 1) {
        if (text[j] === '{') {
          depth++;
        } else if (text[j] === '}') {
          if (depth === 0 && text[j + 1] === '}') {
            // Found closing }}
            break;
          }
          depth--;
        }
        j++;
      }

      if (j < text.length - 1 && text[j] === '}' && text[j + 1] === '}') {
        // Extract expression and wrap with helper
        const expr = text.slice(i + 2, j).trim();
        result += '${__lassScriptExpression(' + expr + ')}';
        i = j + 2;
        continue;
      }
    }

    result += text[i];
    i++;
  }

  return result;
}

/**
 * Result from dollar variable translation in style blocks.
 */
interface DollarTranslationResult {
  text: string;
  hasDollarVariables: boolean;
}

/**
 * Translates $param variables to ${__lassScriptLookup(...)} inside style block content.
 *
 * Story 5.1: Inside @{ } style blocks, $param should use the same helper as
 * CSS zone to properly handle:
 * - null -> 'unset' (CSS-meaningful fallback)
 * - undefined or ReferenceError -> preserve '$name' unchanged
 * - other values -> String coercion
 *
 * Reuses Scanner.findDollarVariablesStatic() for detection, which handles:
 * - Protected contexts (strings, block comments)
 * - {{ }} script block depth tracking
 *
 * @param text - Content inside a style block
 * @returns Result with text and flag for $param usage
 */
function translateDollarVariablesInStyleBlock(text: string): DollarTranslationResult {
  // Reuse Scanner's detection logic - it handles all protected contexts and {{ }}
  const variables = Scanner.findDollarVariablesStatic(text);

  if (variables.length === 0) {
    return { text, hasDollarVariables: false };
  }

  // Process from end to start so indices remain valid
  let result = text;

  for (let i = variables.length - 1; i >= 0; i--) {
    const variable = variables[i]!;
    const { varName, startIndex, endIndex } = variable;

    // Replace $varName with ${__lassScriptLookup('name', () => $varName)}
    const nameWithoutDollar = varName.slice(1);
    const replacement = `\${__lassScriptLookup('${nameWithoutDollar}', () => ${varName})}`;
    result = result.slice(0, startIndex) + replacement + result.slice(endIndex);
  }

  return { text: result, hasDollarVariables: true };
}

// ============================================================================
// STEP 5a-v2: SLICE-BASED STYLE BLOCK TRANSLATION
// ============================================================================

/**
 * Translates @{ } style blocks using a slice-based approach.
 * 
 * This is the v2 implementation that replaces the recursive translateStyleBlocks.
 * It uses cutByBraces to split the text into slices, then reassembles with
 * proper delimiters. This avoids the nested context issues of the recursive approach.
 * 
 * Algorithm:
 * 1. Cut text into slices using cutByBraces (handles @{, {{, { with proper nesting)
 * 2. Process each slice based on its context type
 * 3. Reassemble with appropriate delimiters:
 *    - @{ → backtick (template literal)
 *    - {{ → ${__lassScriptExpression(
 *    - { → { (pass through)
 *    - Corresponding closing delimiters
 * 
 * @param text - JS code containing @{ } style blocks
 * @returns Result with translated text and flag for $param usage
 */
export function translateStyleBlocksV2(text: string): StyleBlockTranslationResult {
  if (!text || !text.includes('@{')) {
    return { text, hasDollarVariables: false };
  }

  const { slices } = cutByBraces(text);
  
  if (slices.length <= 1) {
    // No braces found, return as-is
    return { text, hasDollarVariables: false };
  }

  let result = '';
  let hasDollarVars = false;

  for (let i = 0; i < slices.length; i++) {
    const slice = slices[i]!;
    const nextSlice = slices[i + 1];
    
    // Process slice content based on its type
    let content = slice.content;
    
    // Translate $param in style block content (CSS context inside @{)
    if (slice.openedBy === '@{') {
      const dollarResult = translateDollarVariablesInStyleBlock(content);
      content = dollarResult.text;
      if (dollarResult.hasDollarVariables) {
        hasDollarVars = true;
      }
    }
    
    // Output the slice content
    result += content;
    
    // Determine what delimiter to output based on transition to next slice
    if (nextSlice) {
      const isOpening = nextSlice.parent === i;
      const isClosing = !isOpening && nextSlice.parent !== null && nextSlice.parent < i;
      const isClosingToRoot = !isOpening && nextSlice.parent === null && slice.parent !== null;
      
      if (isOpening) {
        // We're going deeper - output opening delimiter
        switch (nextSlice.openedBy) {
          case '@{':
            result += '`';  // Style block becomes template literal
            break;
          case '{{':
            result += '${__lassScriptExpression(';  // JS expression wrapper
            break;
          case '{':
            result += '{';  // Regular brace
            break;
        }
      } else if (isClosing || isClosingToRoot) {
        // We're going back up - output closing delimiter(s)
        result += getClosingDelimiters(slices, i, nextSlice);
      }
    }
  }

  return { text: result, hasDollarVariables: hasDollarVars };
}

/**
 * Determines what closing delimiters to emit when transitioning between slices.
 * 
 * When moving from slice[i] to slice[i+1], we may need to close one or more
 * scopes if the next slice's parent is higher up the tree.
 * 
 * @param slices - All slices from cutByBraces
 * @param currentIndex - Current slice index
 * @param nextSlice - The next slice we're transitioning to
 * @returns String of closing delimiters to emit
 */
function getClosingDelimiters(
  slices: ScopeSlice[],
  currentIndex: number,
  nextSlice: ScopeSlice
): string {
  // We need to close scopes from current slice back to next slice's parent level.
  // 
  // Key insight: When we transition from slice[i] to slice[i+1], we're closing
  // the scope that CONTAINS slice[i]. That scope is indicated by slice[i].openedBy.
  // 
  // We walk up the parent chain, closing each scope until we reach the parent
  // of nextSlice. But we don't close the scope that nextSlice is IN - we stop
  // when we reach it.
  //
  // Example: Going from slice[3] (parent=2) to slice[4] (parent=1)
  // - slice[3].openedBy = @{ → close with `
  // - slice[3].parent = 2, but nextSlice.parent = 1
  // - We need to check: is slice[3]'s parent (2) still above nextSlice.parent (1)?
  // - Yes, so continue walking... but slice[2] is the {{ that nextSlice is still inside!
  // 
  // The fix: Only close the CURRENT slice's openedBy, then check if we need to
  // close more by comparing parents.
  
  let closers = '';
  const currentSlice = slices[currentIndex]!;
  
  // Close the current slice's scope
  closers += getCloserForBrace(currentSlice.openedBy);
  
  // Check if we need to close more scopes
  // We need to close additional scopes if we're jumping multiple levels
  let walkParent = currentSlice.parent;
  const targetParent = nextSlice.parent;
  
  // Walk up and close scopes until we reach the target parent level
  while (walkParent !== null && walkParent !== targetParent) {
    const parentSlice = slices[walkParent]!;
    
    // Check if this parent is still above the target
    // If the parent's parent is >= targetParent, we need to close this level too
    if (parentSlice.parent === targetParent || 
        (targetParent !== null && parentSlice.parent !== null && parentSlice.parent < targetParent)) {
      // We've reached or passed the target level, stop
      break;
    }
    
    // Close this scope
    closers += getCloserForBrace(parentSlice.openedBy);
    walkParent = parentSlice.parent;
  }
  
  return closers;
}

/**
 * Returns the closing delimiter for a given brace type.
 */
function getCloserForBrace(braceType: import('./scope-tracker.js').BraceType): string {
  switch (braceType) {
    case '@{':
      return '`';  // Close template literal
    case '{{':
      return ')}';  // Close __lassScriptExpression(
    case '{':
      return '}';  // Close regular brace
    default:
      return '';
  }
}

// ============================================================================
// STEP 5b: EXPRESSION PROCESSING
// ============================================================================

/**
 * Step 5b: Process expressions in CSS zone.
 *
 * Finds {{ expr }} expressions and converts them to template literal interpolations.
 * Story 2.5: Expressions are processed EVERYWHERE in CSS zone (strings, url(), comments).
 * Story 5.1: Also translates @{ } style blocks within expressions.
 *
 * @param cssZone - The CSS zone content
 * @param hasDollarVariables - Whether $param variables were found in CSS zone
 * @param options - Transpile options (filename for errors)
 * @returns Processed template with body and expression flag
 */
export function processExpressions(cssZone: string, hasDollarVariables: boolean, options: TranspileOptions): ProcessedTemplate {
  const scanner = new Scanner(cssZone, { filename: options.filename });
  const exprSplit = scanner.findExpressions(cssZone);

  const hasExpressions = exprSplit.parts.length > 1;
  let styleBlockHasDollarVars = false;

  // Build template literal content with ${} interpolations
  let templateBody = '';
  for (let i = 0; i < exprSplit.parts.length; i++) {
    if (i % 2 === 0) {
      // CSS chunk - escape for template literal
      templateBody += escapeForTemplateLiteral(exprSplit.parts[i]!);
    } else {
      // JS expression - translate @{ } style blocks, then wrap in helper
      const styleBlockResult = translateStyleBlocksV2(exprSplit.parts[i]!);
      if (styleBlockResult.hasDollarVariables) {
        styleBlockHasDollarVars = true;
      }
      templateBody += '${__lassScriptExpression(' + styleBlockResult.text + ')}';
    }
  }

  // Include $param usage from both CSS zone and style blocks
  const finalHasDollarVariables = hasDollarVariables || styleBlockHasDollarVars;

  return { templateBody, hasExpressions, hasDollarVariables: finalHasDollarVariables };
}

// ============================================================================
// STEP 6: OUTPUT BUILDING
// ============================================================================

/**
 * Step 6: Build final JavaScript module output.
 *
 * Assembles preamble, helper functions (if needed), and template literal export.
 * Story 5.1: Also translates @{ } style blocks in preamble.
 *
 * @param zones - Detected zones from step 1
 * @param template - Processed template from step 5
 * @returns Final JavaScript module code
 */
export function buildOutput(zones: DetectedZones, template: ProcessedTemplate): string {
  // Translate @{ } style blocks in preamble (Story 5.1)
  let preambleHasDollarVars = false;
  let translatedPreamble = zones.preamble;
  if (zones.hasSeparator && zones.preamble.trim()) {
    const preambleResult = translateStyleBlocksV2(zones.preamble);
    translatedPreamble = preambleResult.text;
    preambleHasDollarVars = preambleResult.hasDollarVariables;
  }

  // Include helper functions as needed
  let helpers = '';
  if (template.hasExpressions) {
    helpers += LASS_SCRIPT_EXPRESSION_HELPER + '\n';
  }
  if (template.hasDollarVariables || preambleHasDollarVars) {
    helpers += LASS_SCRIPT_LOOKUP_HELPER + '\n';
  }
  if (helpers) {
    helpers += '\n'; // Extra blank line after helpers
  }

  // Include preamble if present (non-empty after trimming)
  if (zones.hasSeparator && zones.preamble.trim()) {
    // Helpers (if needed) + Preamble + blank line + export
    // Preamble executes when module is imported, variables are in scope
    return `${helpers}${translatedPreamble}\n\nexport default \`${template.templateBody}\`;`;
  } else {
    // No separator or empty/whitespace-only preamble - just export (with helpers if needed)
    return `${helpers}export default \`${template.templateBody}\`;`;
  }
}
