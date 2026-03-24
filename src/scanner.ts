/**
 * Single-pass text scanner for Lass language.
 *
 * The scanner processes input in a single pass. It does NOT parse CSS - it
 * only scans for Lass symbols within CSS text.
 *
 * Story 1.4: Passthrough-only
 * Story 2.1: Zone detection (--- separator)
 */

import { LassTranspileError, ErrorCategory } from './errors.js';
import { createContextState, updateContextState, isInProtectedContext } from './context-tracker.js';

/**
 * Result of a scan operation.
 * For passthrough mode, this simply returns the input unchanged.
 */
export interface ScanResult {
  /** The processed CSS text (unchanged in passthrough mode) */
  css: string;
}

/**
 * Result of zone separation.
 * Story 2.1: Detects --- separator and splits into JS preamble and CSS zone.
 */
export interface ZoneSplit {
  /** Content above --- (empty string if no separator or empty preamble) */
  preamble: string;
  /** Content below --- (entire file if no separator) */
  cssZone: string;
  /** Whether a --- separator was found */
  hasSeparator: boolean;
}

/**
 * Result of expression splitting.
 * Story 2.3: Detects {{ expr }} and splits CSS zone into alternating parts.
 */
export interface ExpressionSplit {
  /** Alternating: [css, expr, css, expr, ...] - always starts and ends with css (possibly empty) */
  parts: string[];
  /** Character offsets of expression starts ({{ positions) for error reporting */
  expressionPositions: number[];
}

/**
 * Information about a detected @(prop) accessor.
 * Story 3.2: Basic Property Lookup
 * Refactored: Changed from @prop to @(prop) for unambiguous syntax
 */
export interface PropertyAccessor {
  /** The property name (without @ and parentheses) */
  propName: string;
  /** Start index of @(propname) in the CSS string */
  startIndex: number;
  /** End index (exclusive) of @(propname) in the CSS string */
  endIndex: number;
}

/**
 * Information about a detected $param variable.
 * Story 4.1: Variable Substitution
 */
export interface DollarVariable {
  /** The variable name including $ prefix (e.g., '$primary', '$$var') */
  varName: string;
  /** Start index of $varname in the CSS string */
  startIndex: number;
  /** End index (exclusive) of $varname in the CSS string */
  endIndex: number;
}

/**
 * Scanner options for customizing scan behavior.
 */
export interface ScanOptions {
  /** Source file path for error messages */
  filename?: string;
}

/**
 * Single-pass text scanner for Lass language.
 *
 * Story 1.4: Passthrough mode - returns input unchanged
 * Story 2.1: Zone detection - finds --- separator, splits into preamble/CSS
 * Story 3.2: @(prop) detection - finds property accessors in value position
 *
 * Future implementations will:
 * - Detect $name, $(name), {{ expr }}, @{ } symbols
 * - Track context to skip symbols inside strings, urls, and comments
 */
export class Scanner {
  private readonly source: string;

  constructor(source: string, _options: ScanOptions = {}) {
    this.source = source;
    // Note: options.filename is accepted for API compatibility but not yet used
    // Future: include filename in error messages for better debugging
  }

  /**
   * Finds the --- delimiters and splits source into preamble and CSS zones.
   *
   * Story 2.1: Zone detection (updated Story 10.1: Preamble Format Change)
   *
   * Rules for surrounding delimiters:
   * - Opening delimiter must be on line 0 (first line of file)
   * - Delimiter must be exactly "---" at column 0 (start of line)
   * - May have extra dashes: "------"
   * - May have optional comment after space: "--- comment text"
   * - "---nospace" is NOT a delimiter (no space before text, not extra dashes)
   * - Second delimiter closes the preamble
   * - Must NOT be inside a multi-line comment in CSS zone
   *
   * Format:
   * ```
   * --- optional comment
   * JS preamble code
   * --- optional comment
   * CSS zone
   * ```
   *
   * Note: Line endings are normalized to \n during processing.
   * When no opening delimiter is found on line 0, cssZone returns the original source unchanged.
   *
   * @returns Zone split result with preamble, cssZone, and hasSeparator
   */
  findSeparator(): ZoneSplit {
    // Normalize line endings to \n for consistent processing
    const normalized = this.source.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const lines = normalized.split('\n');

    // Check if line 0 is the opening delimiter
    if (lines.length === 0 || !this.isSeparatorLine(lines[0]!)) {
      // No opening delimiter on line 0 - entire file is CSS zone
      return {
        preamble: '',
        cssZone: this.source,
        hasSeparator: false,
      };
    }

    // Opening delimiter found on line 0. Find the closing delimiter.
    let closingLineIndex = -1;

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i]!;

      // Check if this line is the closing delimiter (only if not inside a block comment)
      // Note: We only check for comments in what will become the CSS zone (after closing)
      // The preamble is JS, so we don't apply CSS comment logic there
      if (this.isSeparatorLine(line)) {
        closingLineIndex = i;
        break; // First delimiter after opening is the closing delimiter
      }
    }

    if (closingLineIndex === -1) {
      // No closing delimiter - entire file after line 0 is JS preamble, empty CSS zone
      const preambleLines = lines.slice(1);
      return {
        preamble: preambleLines.join('\n'),
        cssZone: '',
        hasSeparator: true,
      };
    }

    // Split at delimiters
    const preambleLines = lines.slice(1, closingLineIndex);
    const cssLines = lines.slice(closingLineIndex + 1);

    return {
      preamble: preambleLines.join('\n'),
      cssZone: cssLines.join('\n'),
      hasSeparator: true,
    };
  }

  /**
   * Checks if a line is the --- delimiter.
   * Must be exactly "---" with optional extra dashes or comment.
   *
   * Story 8.1: Separator Comment Support
   * Story 10.1: Preamble Format Change (updated regex)
   * 
   * Matches:
   * - "---"              (bare three dashes)
   * - "--- comment"      (three dashes + space + comment text)
   * - "---\tcomment"     (three dashes + tab + comment text)
   * - "------"           (three+ dashes for visual separator)
   * - "--- title ---"    (decorative comment style)
   * 
   * Does NOT match:
   * - "---nospace"       (no whitespace before text, not extra dashes)
   * - " ---"             (leading whitespace)
   * - "--"               (only two dashes)
   */
  private isSeparatorLine(line: string): boolean {
    // ^---         line must start with exactly three dashes
    // (\s.*|-*)    followed by either: whitespace + anything (comment), OR more dashes
    // $            end of line
    return /^---(\s.*|-*)$/.test(line);
  }

  /**
   * Checks if line at index is inside a block comment.
   * Scans from start of file to determine comment state at the START of the line.
   */
  private isInBlockComment(lines: string[], targetLineIndex: number): boolean {
    let inComment = false;

    for (let i = 0; i < targetLineIndex; i++) {
      const line = lines[i]!;
      let j = 0;
      while (j < line.length) {
        if (inComment) {
          const endIdx = line.indexOf('*/', j);
          if (endIdx !== -1) {
            inComment = false;
            j = endIdx + 2;
          } else {
            break;
          }
        } else {
          const startIdx = line.indexOf('/*', j);
          if (startIdx !== -1) {
            inComment = true;
            j = startIdx + 2;
          } else {
            break;
          }
        }
      }
    }

    // Also check if comment started on a previous line and extends to current line
    // At this point, inComment tells us if we're in a comment at the START of targetLineIndex
    return inComment;
  }

  /**
   * Calculates character offset for a given line.
   */
  private getOffset(lines: string[], lineIndex: number): number {
    let offset = 0;
    for (let i = 0; i < lineIndex; i++) {
      offset += lines[i]!.length + 1; // +1 for newline
    }
    return offset;
  }

  /**
   * Scans the input and returns processed CSS.
   *
   * In passthrough mode (Story 1.4), this returns the input unchanged.
   *
   * @returns Scan result with processed CSS
   */
  scan(): ScanResult {
    // Story 1.4: Passthrough mode - return input unchanged
    return {
      css: this.source,
    };
  }

  /**
   * Finds {{ expr }} expressions in CSS zone and splits into alternating parts.
   *
   * Story 2.3: Expression interpolation
   * Story 2.5: Universal {{ }} processing - works EVERYWHERE in CSS zone
   *
   * Returns alternating CSS chunks and JS expressions:
   * - [css, expr, css, expr, css] - always starts and ends with CSS (possibly empty)
   * - Expression content is trimmed of leading/trailing whitespace
   *
   * Handles nested braces in expressions (e.g., {{ fn({x:1}) }}) by tracking brace depth.
   *
   * Universal processing: {{ }} is detected and processed in ALL contexts:
   * - Value position: `color: {{ x }};`
   * - Inside strings: `content: "Hello {{ name }}!";`
   * - Inside url(): `background: url("{{ path }}.jpg");`
   * - Inside comments: `/* Version: {{ version }} *‍/`
   *
   * @param cssZone - The CSS zone content to scan
   * @returns ExpressionSplit with parts and expression positions
   * @throws LassTranspileError for empty or unclosed expressions
   */
  findExpressions(cssZone: string): ExpressionSplit {
    const parts: string[] = [];
    const expressionPositions: number[] = [];

    let currentPos = 0;
    let cssStart = 0;

    while (currentPos < cssZone.length) {
      // Find next {{ using simple indexOf - process everywhere in CSS zone
      const openPos = cssZone.indexOf('{{', currentPos);

      if (openPos === -1) {
        // No more expressions - add remaining CSS
        parts.push(cssZone.slice(cssStart));
        break;
      }

      // Found {{ - add CSS chunk before it
      parts.push(cssZone.slice(cssStart, openPos));
      expressionPositions.push(openPos);

      // Find matching }} with brace depth tracking
      const exprStart = openPos + 2;
      let braceDepth = 0;
      let closePos = -1;

      for (let j = exprStart; j < cssZone.length - 1; j++) {
        const char = cssZone[j];

        if (char === '{') {
          braceDepth++;
        } else if (char === '}') {
          if (braceDepth === 0 && cssZone[j + 1] === '}') {
            // Found matching }}
            closePos = j;
            break;
          }
          braceDepth--;
        }
      }

      if (closePos === -1) {
        // Unclosed expression
        const line = this.getLineNumber(cssZone, openPos);
        const col = this.getColumnNumber(cssZone, openPos);
        throw LassTranspileError.at(
          'Unclosed {{ expression',
          ErrorCategory.SCAN,
          line,
          col,
          openPos
        );
      }

      // Extract and trim expression content
      const exprContent = cssZone.slice(exprStart, closePos).trim();

      if (exprContent === '') {
        // Empty expression
        const line = this.getLineNumber(cssZone, openPos);
        const col = this.getColumnNumber(cssZone, openPos);
        throw LassTranspileError.at(
          'Empty {{ }} expression',
          ErrorCategory.SCAN,
          line,
          col,
          openPos
        );
      }

      parts.push(exprContent);

      // Move past }}
      currentPos = closePos + 2;
      cssStart = currentPos;
    }

    // Ensure we always end with a CSS part (even if empty)
    if (parts.length > 0 && parts.length % 2 === 0) {
      parts.push('');
    }

    // Handle case where no expressions were found and we didn't add anything
    if (parts.length === 0) {
      parts.push(cssZone);
    }

    return { parts, expressionPositions };
  }

  /**
   * Gets the 1-based line number for a character offset.
   */
  private getLineNumber(text: string, offset: number): number {
    let line = 1;
    for (let i = 0; i < offset && i < text.length; i++) {
      if (text[i] === '\n') line++;
    }
    return line;
  }

  /**
   * Gets the 1-based column number for a character offset.
   */
  private getColumnNumber(text: string, offset: number): number {
    let col = 1;
    for (let i = offset - 1; i >= 0 && text[i] !== '\n'; i--) {
      col++;
    }
    return col;
  }

  /**
   * Known CSS at-rules - kept for reference but not needed for @(prop) detection.
   * The @(prop) syntax with parentheses is unambiguous - no collision with CSS at-rules.
   */
  private static readonly CSS_AT_RULES = new Set([
    'media',
    'layer',
    'supports',
    'container',
    'keyframes',
    'font-face',
    'import',
    'charset',
    'namespace',
    'page',
    'counter-style',
    'font-feature-values',
    'property',
    'scope',
    'starting-style',
  ]);

  /**
   * Finds @(prop) accessors in CSS zone.
   *
   * Story 3.2: Basic Property Lookup
   * Refactored: Changed from @prop to @(prop) for unambiguous syntax
   *
   * Detection rules:
   * - @(propname) in CSS value position (after :) is a Lass accessor
   * - The explicit parentheses make this unambiguous - no collision with CSS at-rules
   * - Supports both standard properties and custom properties: @(border), @(--custom)
   *
   * Valid CSS property names inside @():
   * - Standard: letter or hyphen start, then letters/digits/hyphens
   * - Custom: -- followed by letters/digits/hyphens
   *
   * @param cssZone - The CSS zone content to scan
   * @returns Array of PropertyAccessor objects with propName and indices
   */
  findPropertyAccessors(cssZone: string): PropertyAccessor[] {
    return Scanner.findPropertyAccessorsStatic(cssZone);
  }

  /**
   * Static version of findPropertyAccessors for use without Scanner instantiation.
   * Used internally by transpiler to avoid creating unnecessary Scanner instances.
   *
   * Story 3.3: Handles @(prop) inside {{ }} expressions.
   * - {{ doesn't reset inValuePosition (JS expression can contain @(prop))
   * - }} doesn't reset inValuePosition (exiting expression, still in value)
   * - Single { resets inValuePosition (entering CSS block)
   * - @(prop) inside {{ }} is detected and will be quoted during resolution
   *
   * Refactored: Changed from @prop to @(prop) for unambiguous syntax.
   * This eliminates ambiguity in JS context: @(border-width) is clear,
   * unlike @border-width which could be @border minus width.
   *
   * @param cssZone - The CSS zone content to scan
   * @returns Array of PropertyAccessor objects with propName and indices
   */
  static findPropertyAccessorsStatic(cssZone: string): PropertyAccessor[] {
    const accessors: PropertyAccessor[] = [];

    if (!cssZone) {
      return accessors;
    }

    // Pattern for property name inside @():
    // - Standard property: letter or hyphen start, then letters/digits/hyphens
    // - Custom property: -- followed by letters/digits/hyphens
    const propNamePattern = /^([a-zA-Z-][a-zA-Z0-9-]*|--[a-zA-Z0-9-]+)/;

    // Track if we're in value position (after :)
    let inValuePosition = false;
    // Track expression depth for {{ }} (Story 3.3)
    let expressionDepth = 0;
    let i = 0;

    while (i < cssZone.length) {
      const char = cssZone[i];
      const nextChar = cssZone[i + 1];

      // Track colon for value position
      if (char === ':') {
        inValuePosition = true;
        i++;
        continue;
      }

      // Handle {{ - entering JS expression (Story 3.3)
      // DON'T reset inValuePosition - we can have @(prop) inside expressions
      if (char === '{' && nextChar === '{') {
        expressionDepth++;
        i += 2;
        continue;
      }

      // Handle }} - exiting JS expression (Story 3.3)
      // DON'T reset inValuePosition - we're still in the CSS value after expression
      if (char === '}' && nextChar === '}') {
        expressionDepth--;
        i += 2;
        continue;
      }

      // Reset on semicolon (end of declaration) - but only if not inside expression
      if (char === ';' && expressionDepth === 0) {
        inValuePosition = false;
        i++;
        continue;
      }

      // Reset on single closing brace (end of block) - but only if not inside expression
      if (char === '}' && expressionDepth === 0) {
        inValuePosition = false;
        i++;
        continue;
      }

      // Reset on single opening brace (entering a new CSS block) - but only if not inside expression
      if (char === '{' && expressionDepth === 0) {
        inValuePosition = false;
        i++;
        continue;
      }

      // Check for @( pattern - the explicit accessor syntax
      if (char === '@' && nextChar === '(') {
        // Find the closing parenthesis
        const afterParen = cssZone.slice(i + 2);
        const closeParenIdx = afterParen.indexOf(')');

        if (closeParenIdx !== -1) {
          const insideParens = afterParen.slice(0, closeParenIdx);
          const match = insideParens.match(propNamePattern);

          // Check if the entire content inside parens is a valid property name
          if (match && match[0] === insideParens) {
            const propName = match[0];

            // Detect if we're in value position (after :)
            // Story 3.3: This works inside {{ }} because we don't reset inValuePosition there
            if (inValuePosition) {
              accessors.push({
                propName,
                startIndex: i,
                // @(propname) = @ + ( + propname + ) = 3 + propname.length
                endIndex: i + 3 + propName.length,
              });
            }

            // Move past the @(propname)
            i += 3 + propName.length;
            continue;
          }
        }
      }

      i++;
    }

    return accessors;
  }

  /**
   * Finds $param variables in CSS zone.
   *
   * Story 4.1: Variable Substitution
   *
   * Detection rules:
   * - $param is detected when $ is followed by a valid JS identifier character
   * - Valid identifier start: [a-zA-Z_$]
   * - Valid identifier char: [a-zA-Z0-9_$]
   * - Identifier stops at first non-identifier character (hyphen, space, ;, {, etc.)
   * - Bare $ (not followed by valid identifier start) is treated as literal text
   *
   * Protected contexts (detection skipped):
   * - Inside CSS string literals ("..." or '...')
   * - Inside /* ... *‍/ block comments
   *
   * Note: url() is NOT a protected context - $param inside url() IS substituted.
   * Use {{ $param }} bridge syntax if you need dynamic content inside strings.
   *
   * @param cssZone - The CSS zone content to scan
   * @returns Array of DollarVariable objects with varName and indices
   */
  findDollarVariables(cssZone: string): DollarVariable[] {
    return Scanner.findDollarVariablesStatic(cssZone);
  }

  /**
   * Static version of findDollarVariables for use without Scanner instantiation.
   * Used internally by transpiler to avoid creating unnecessary Scanner instances.
   *
   * Story 4.1: Variable Substitution
   *
   * @param cssZone - The CSS zone content to scan
   * @returns Array of DollarVariable objects with varName and indices
   */
  static findDollarVariablesStatic(cssZone: string): DollarVariable[] {
    const variables: DollarVariable[] = [];

    if (!cssZone) {
      return variables;
    }

    // Context tracking for protected zones (strings, comments)
    // Note: url() is NOT protected - $param inside url() IS substituted
    const state = createContextState();

    // Track {{ }} script block depth ($param not substituted inside)
    let scriptBlockDepth = 0;

    let i = 0;

    while (i < cssZone.length) {
      const char = cssZone[i]!;
      const nextChar = cssZone[i + 1];

      // Update context state (handles strings and comments)
      const consumed = updateContextState(cssZone, i, state);
      if (consumed === 2) {
        i += 2;
        continue;
      }

      // Skip string quote characters (already handled by updateContextState)
      if (char === '"' || char === "'") {
        i++;
        continue;
      }

      // Track {{ }} script block depth (only when not in protected context)
      if (!isInProtectedContext(state) && char === '{' && nextChar === '{') {
        scriptBlockDepth++;
        i += 2;
        continue;
      }

      if (!isInProtectedContext(state) && char === '}' && nextChar === '}' && scriptBlockDepth > 0) {
        scriptBlockDepth--;
        i += 2;
        continue;
      }

      // Skip if in any protected context OR inside {{ }}
      if (isInProtectedContext(state) || scriptBlockDepth > 0) {
        i++;
        continue;
      }

      // Check for $ followed by valid identifier start
      if (char === '$' && nextChar !== undefined && Scanner.isIdentifierStart(nextChar)) {
        const startIndex = i;
        i++; // Move past $

        // Consume identifier characters
        let varName = '$';
        while (i < cssZone.length && Scanner.isIdentifierChar(cssZone[i]!)) {
          varName += cssZone[i];
          i++;
        }

        variables.push({
          varName,
          startIndex,
          endIndex: i,
        });
        continue;
      }

      i++;
    }

    return variables;
  }

  /**
   * Checks if a character is a valid JS identifier start.
   * Valid: a-z, A-Z, _, $
   */
  private static isIdentifierStart(char: string): boolean {
    return /^[a-zA-Z_$]$/.test(char);
  }

  /**
   * Checks if a character is a valid JS identifier character.
   * Valid: a-z, A-Z, 0-9, _, $
   */
  private static isIdentifierChar(char: string): boolean {
    return /^[a-zA-Z0-9_$]$/.test(char);
  }

  /**
   * Strips // single-line comments from CSS zone.
   *
   * Story 4.4: Single-Line Comment Stripping
   *
   * Detection rules:
   * - // to end of line (including newline) is removed
   * - Skip detection inside protected contexts: strings, url(), /* *\/
   * - Full-line comments remove the entire line
   * - Inline comments preserve content before //
   *
   * Note: url() is protected here (unlike $param) because
   * url(https://...) contains // as part of the URL protocol.
   *
   * @param cssZone - The CSS zone content to process
   * @returns CSS zone with // comments stripped
   * @throws LassTranspileError if unclosed /* comment detected
   */
  stripLineComments(cssZone: string): string {
    return Scanner.stripLineCommentsStatic(cssZone);
  }

  /**
   * Static version of stripLineComments for use without Scanner instantiation.
   * Used internally by transpiler to avoid creating unnecessary Scanner instances.
   *
   * Story 4.4: Single-Line Comment Stripping
   *
   * @param cssZone - The CSS zone content to process
   * @returns CSS zone with // comments stripped
   * @throws LassTranspileError if unclosed /* comment detected
   */
  static stripLineCommentsStatic(cssZone: string): string {
    if (!cssZone) {
      return cssZone;
    }

    // Context tracking for protected zones (strings, block comments)
    const state = createContextState();

    // Local url() tracking - unique to this function because url(https://...)
    // contains // that should NOT be treated as a comment
    let inUrl = false;
    let urlParenDepth = 0;

    // Track position where /* started (for error reporting)
    let blockCommentStartLine = -1;
    let blockCommentStartOffset = -1;

    let result = '';
    let i = 0;

    while (i < cssZone.length) {
      const char = cssZone[i]!;
      const nextChar = cssZone[i + 1];

      // Track block comment start position for error reporting
      if (!state.inString && !state.inBlockComment && char === '/' && nextChar === '*') {
        blockCommentStartLine = Scanner.getLineNumberStatic(cssZone, i);
        blockCommentStartOffset = i;
      }

      // Update context state (strings, block comments)
      const consumed = updateContextState(cssZone, i, state);
      if (consumed === 2) {
        result += cssZone.slice(i, i + 2);
        i += 2;
        continue;
      }

      // Handle string quote characters
      if (char === '"' || char === "'") {
        result += char;
        i++;
        continue;
      }

      // Track url() context (only when not in string or block comment)
      if (!isInProtectedContext(state) && !inUrl) {
        if (cssZone.slice(i, i + 4).toLowerCase() === 'url(') {
          inUrl = true;
          urlParenDepth = 1;
          result += cssZone.slice(i, i + 4);
          i += 4;
          continue;
        }
      }

      // Handle characters inside url()
      if (inUrl) {
        if (char === '(') {
          urlParenDepth++;
        } else if (char === ')') {
          urlParenDepth--;
          if (urlParenDepth === 0) {
            inUrl = false;
          }
        }
        result += char;
        i++;
        continue;
      }

      // Skip if in any protected context (string or block comment)
      if (isInProtectedContext(state)) {
        result += char;
        i++;
        continue;
      }

      // Check for // line comment
      if (char === '/' && nextChar === '/') {
        // Find end of line (the comment is from // to just before the newline)
        let endOfLine = i;
        while (endOfLine < cssZone.length && cssZone[endOfLine] !== '\n' && cssZone[endOfLine] !== '\r') {
          endOfLine++;
        }
        // Skip past the comment content, stop at the newline (don't consume it)
        i = endOfLine;
        // Content before // is already in result, newline will be added on next iteration
        continue;
      }

      result += char;
      i++;
    }

    // Check for unclosed block comment at end of file
    if (state.inBlockComment) {
      throw LassTranspileError.at(
        'Unclosed /* comment',
        ErrorCategory.SCAN,
        blockCommentStartLine,
        1,
        blockCommentStartOffset
      );
    }

    return result;
  }

  /**
   * Gets the 1-based line number for a character offset (static version).
   */
  private static getLineNumberStatic(text: string, offset: number): number {
    let line = 1;
    for (let i = 0; i < offset && i < text.length; i++) {
      if (text[i] === '\n') line++;
    }
    return line;
  }
}
