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
 * Information about a detected @prop shorthand.
 * Story 4.2: Style Lookup Shorthand
 */
export interface StyleLookupShorthand {
  /** The property name (without @ prefix) */
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

    // Context tracking for protected zones
    // Note: url() is NOT protected - $param inside url() IS substituted
    let inString = false;
    let stringChar = '';
    let inBlockComment = false;

    let i = 0;

    while (i < cssZone.length) {
      const char = cssZone[i]!;
      const nextChar = cssZone[i + 1];

      // Track block comment start: /*
      if (!inString && !inBlockComment && char === '/' && nextChar === '*') {
        inBlockComment = true;
        i += 2;
        continue;
      }

      // Track block comment end: */
      if (inBlockComment && char === '*' && nextChar === '/') {
        inBlockComment = false;
        i += 2;
        continue;
      }

      // Track string literals (only when not in comment)
      if (!inBlockComment && (char === '"' || char === "'")) {
        if (!inString) {
          inString = true;
          stringChar = char;
        } else if (char === stringChar) {
          // Check for escaped quote
          // Look back to count consecutive backslashes
          let backslashCount = 0;
          for (let j = i - 1; j >= 0 && cssZone[j] === '\\'; j--) {
            backslashCount++;
          }
          // If odd number of backslashes, quote is escaped
          if (backslashCount % 2 === 0) {
            inString = false;
          }
        }
        i++;
        continue;
      }

      // Skip if in any protected context
      if (inString || inBlockComment) {
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
   * Finds @prop shorthand accessors in CSS zone.
   *
   * Story 4.2: Style Lookup Shorthand
   *
   * Detection rules:
   * - @prop in CSS value position (after :) is a Lass shorthand accessor
   * - @prop shorthand only works when identifier starts with a letter [a-zA-Z]
   * - Identifier continues with letters, digits, hyphens, underscores
   * - NOT detected inside {{ }} script blocks (use explicit @(prop) there)
   * - NOT detected inside protected contexts: strings, comments, url()
   *
   * Examples:
   * - @border → shorthand for @(border)
   * - @border-color → shorthand for @(border-color)
   * - @--custom → NOT detected (starts with hyphen, use @(--custom))
   * - @-webkit-foo → NOT detected (starts with hyphen, use @(-webkit-foo))
   *
   * @param cssZone - The CSS zone content to scan
   * @returns Array of StyleLookupShorthand objects with propName and indices
   */
  findStyleLookupShorthands(cssZone: string): StyleLookupShorthand[] {
    return Scanner.findStyleLookupShorthandsStatic(cssZone);
  }

  /**
   * Static version of findStyleLookupShorthands for use without Scanner instantiation.
   * Used internally by transpiler to avoid creating unnecessary Scanner instances.
   *
   * Story 4.2: Style Lookup Shorthand
   *
   * @param cssZone - The CSS zone content to scan
   * @returns Array of StyleLookupShorthand objects with propName and indices
   */
  static findStyleLookupShorthandsStatic(cssZone: string): StyleLookupShorthand[] {
    const shorthands: StyleLookupShorthand[] = [];

    if (!cssZone) {
      return shorthands;
    }

    // Context tracking for protected zones
    // Note: url() is NOT a protected context - @prop inside url(@path) IS detected
    // Only strings and comments are protected (same as $param behavior)
    let inString = false;
    let stringChar = '';
    let inBlockComment = false;

    // Track {{ }} script block depth (shorthand not allowed inside)
    let scriptBlockDepth = 0;

    // Track if we're in value position (after :)
    let inValuePosition = false;

    let i = 0;

    while (i < cssZone.length) {
      const char = cssZone[i]!;
      const nextChar = cssZone[i + 1];

      // Track block comment start: /*
      if (!inString && !inBlockComment && char === '/' && nextChar === '*') {
        inBlockComment = true;
        i += 2;
        continue;
      }

      // Track block comment end: */
      if (inBlockComment && char === '*' && nextChar === '/') {
        inBlockComment = false;
        i += 2;
        continue;
      }

      // Track string literals (only when not in comment)
      if (!inBlockComment && (char === '"' || char === "'")) {
        if (!inString) {
          inString = true;
          stringChar = char;
        } else if (char === stringChar) {
          // Check for escaped quote
          let backslashCount = 0;
          for (let j = i - 1; j >= 0 && cssZone[j] === '\\'; j--) {
            backslashCount++;
          }
          if (backslashCount % 2 === 0) {
            inString = false;
          }
        }
        i++;
        continue;
      }

      // Track {{ }} script block depth
      if (!inString && !inBlockComment && char === '{' && nextChar === '{') {
        scriptBlockDepth++;
        i += 2;
        continue;
      }

      if (!inString && !inBlockComment && char === '}' && nextChar === '}' && scriptBlockDepth > 0) {
        scriptBlockDepth--;
        i += 2;
        continue;
      }

      // Skip if in any protected context OR inside {{ }}
      if (inString || inBlockComment || scriptBlockDepth > 0) {
        i++;
        continue;
      }

      // Track colon for value position
      if (char === ':') {
        inValuePosition = true;
        i++;
        continue;
      }

      // Reset on semicolon (end of declaration)
      if (char === ';') {
        inValuePosition = false;
        i++;
        continue;
      }

      // Reset on single opening brace (entering a new CSS block)
      if (char === '{') {
        inValuePosition = false;
        i++;
        continue;
      }

      // Reset on single closing brace (end of block)
      if (char === '}') {
        inValuePosition = false;
        i++;
        continue;
      }

      // Check for @ followed by letter (shorthand only works when starting with letter)
      if (char === '@' && nextChar !== undefined && /^[a-zA-Z]$/.test(nextChar)) {
        // Only detect in value position
        if (inValuePosition) {
          const startIndex = i;
          i++; // Move past @

          // Consume CSS identifier characters (letters, digits, hyphens, underscores)
          let propName = '';
          while (i < cssZone.length && Scanner.isCssIdentifierChar(cssZone[i]!)) {
            propName += cssZone[i];
            i++;
          }

          shorthands.push({
            propName,
            startIndex,
            endIndex: i,
          });
          continue;
        }
      }

      i++;
    }

    return shorthands;
  }

  /**
   * Checks if a character is a valid CSS identifier character.
   * Valid: a-z, A-Z, 0-9, -, _
   */
  private static isCssIdentifierChar(char: string): boolean {
    return /^[a-zA-Z0-9_-]$/.test(char);
  }
}
