/**
 * String escape utilities for @lass-lang/core
 *
 * Functions for escaping text when embedding in various contexts.
 */

/**
 * Escapes special characters for template literal embedding.
 * Only escapes backslash and backtick - NOT dollar sign (needed for substitution).
 *
 * @param text - Text to escape
 * @returns Escaped text safe for template literal
 */
export function escapeForTemplateLiteral(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/`/g, '\\`');
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
export function escapeForJs(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r');
}
