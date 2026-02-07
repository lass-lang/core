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
 * Information about a detected @prop accessor.
 * Story 3.2: Basic Property Lookup
 */
export interface PropertyAccessor {
  /** The property name (without @) */
  propName: string;
  /** Start index of @propname in the CSS string */
  startIndex: number;
  /** End index (exclusive) of @propname in the CSS string */
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
 *
 * Future implementations will:
 * - Detect $name, $(name), {{ expr }}, @{ }, @(prop) symbols
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
   * Finds the --- separator and splits source into preamble and CSS zones.
   *
   * Story 2.1: Zone detection
   *
   * Rules:
   * - Separator must be exactly "---" at column 0 (start of line)
   * - May have trailing whitespace
   * - Must NOT be inside a multi-line comment (slash-star ... star-slash)
   * - Only one separator allowed per file
   *
   * Note: Line endings are normalized to \n during processing.
   * When no separator is found, cssZone returns the original source unchanged.
   *
   * @returns Zone split result with preamble, cssZone, and hasSeparator
   * @throws LassTranspileError if multiple separators found
   */
  findSeparator(): ZoneSplit {
    // Normalize line endings to \n for consistent processing
    const normalized = this.source.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const lines = normalized.split('\n');

    let separatorLineIndex = -1;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;

      // Check if this line is the separator (only if not inside a block comment)
      if (!this.isInBlockComment(lines, i) && this.isSeparatorLine(line)) {
        if (separatorLineIndex !== -1) {
          // Multiple separators found
          throw LassTranspileError.at(
            'Multiple --- separators found. Only one is allowed per file.',
            ErrorCategory.SCAN,
            i + 1,
            1,
            this.getOffset(lines, i)
          );
        }
        separatorLineIndex = i;
      }
    }

    if (separatorLineIndex === -1) {
      // No separator - entire file is CSS zone
      return {
        preamble: '',
        cssZone: this.source,
        hasSeparator: false,
      };
    }

    // Split at separator
    const preambleLines = lines.slice(0, separatorLineIndex);
    const cssLines = lines.slice(separatorLineIndex + 1);

    return {
      preamble: preambleLines.join('\n'),
      cssZone: cssLines.join('\n'),
      hasSeparator: true,
    };
  }

  /**
   * Checks if a line is the --- separator.
   * Must be exactly "---" with optional trailing whitespace.
   */
  private isSeparatorLine(line: string): boolean {
    // Must start with exactly "---" (no leading whitespace)
    // May have trailing whitespace
    return /^---\s*$/.test(line);
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
   * Known CSS at-rules that should NOT be detected as @prop accessors.
   * These appear at statement position (start of line/after semicolon).
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
   * Finds @prop accessors in CSS zone.
   *
   * Story 3.2: Basic Property Lookup
   *
   * Detection rules:
   * - @propname in CSS value position (after :) is a Lass accessor
   * - @propname at statement position (start of line, after ; or {) is a CSS at-rule
   * - Known CSS at-rules (@media, @layer, etc.) are never Lass accessors
   *
   * Valid CSS property names:
   * - Start with letter (a-z, A-Z) or hyphen (vendor prefixes like -webkit-)
   * - Followed by letters, digits, hyphens
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
   * Story 3.3: Handles @prop inside {{ }} expressions.
   * - {{ doesn't reset inValuePosition (JS expression can contain @prop)
   * - }} doesn't reset inValuePosition (exiting expression, still in value)
   * - Single { resets inValuePosition (entering CSS block)
   * - @prop inside {{ }} is detected and will be quoted during resolution
   *
   * @param cssZone - The CSS zone content to scan
   * @returns Array of PropertyAccessor objects with propName and indices
   */
  static findPropertyAccessorsStatic(cssZone: string): PropertyAccessor[] {
    const accessors: PropertyAccessor[] = [];

    if (!cssZone) {
      return accessors;
    }

    // Pattern: @ followed by valid CSS property name characters
    // Property names: start with letter or hyphen, then letters/digits/hyphens
    const propNamePattern = /[a-zA-Z-][a-zA-Z0-9-]*/;

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
      // DON'T reset inValuePosition - we can have @prop inside expressions
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

      // Check for @ symbol
      if (char === '@') {
        // Extract the potential property name after @
        const remaining = cssZone.slice(i + 1);
        const match = remaining.match(propNamePattern);

        if (match && match.index === 0) {
          const propName = match[0];

          // Skip if it's a known CSS at-rule
          if (Scanner.CSS_AT_RULES.has(propName.toLowerCase())) {
            i++;
            continue;
          }

          // Detect if we're in value position (after :)
          // Story 3.3: This now works inside {{ }} because we don't reset inValuePosition there
          if (inValuePosition) {
            accessors.push({
              propName,
              startIndex: i,
              endIndex: i + 1 + propName.length,
            });
          }

          // Move past the @propname
          i += 1 + propName.length;
          continue;
        }
      }

      i++;
    }

    return accessors;
  }
}
