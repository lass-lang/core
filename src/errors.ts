/**
 * Error handling infrastructure for Lass transpiler.
 *
 * Provides structured error types with source location information
 * for actionable error messages following NFR-ERROR requirements.
 */

/**
 * Error categories for Lass transpilation errors.
 * Used to classify errors and provide appropriate guidance.
 */
export enum ErrorCategory {
  /** Scanner-level errors (context tracking, unexpected characters) */
  SCAN = 'SCAN',
  /** Symbol detection errors ($name, {{ }}, @{ }, etc.) */
  SYMBOL = 'SYMBOL',
  /** Syntax errors (malformed Lass constructs) */
  SYNTAX = 'SYNTAX',
}

/**
 * Source location information for error reporting.
 * Provides precise positioning within the source file.
 */
export interface SourceLocation {
  /** Line number (1-based) */
  line: number;
  /** Column number (1-based) */
  column: number;
  /** Character offset from start of file (0-based) */
  offset: number;
}

/**
 * Extended location with optional file path.
 */
export interface FileLocation extends SourceLocation {
  /** Source file path (if available) */
  filename?: string;
}

/**
 * Custom error class for Lass transpilation errors.
 *
 * Provides structured error information including:
 * - Source file path (when provided)
 * - Line and column numbers
 * - Error category for classification
 * - Actionable error description
 *
 * Error message format follows NFR-ERROR requirements:
 * "[filename:]line:column - [CATEGORY] description"
 */
export class LassTranspileError extends Error {
  /** Error category for classification */
  readonly category: ErrorCategory;

  /** Source location where the error occurred */
  readonly location: FileLocation;

  /**
   * Creates a new transpilation error.
   *
   * @param message - Actionable error description
   * @param category - Error category (SCAN, SYMBOL, SYNTAX)
   * @param location - Source location information
   */
  constructor(message: string, category: ErrorCategory, location: FileLocation) {
    // Format: "[filename:]line:column - [CATEGORY] message"
    const prefix = location.filename ? `${location.filename}:` : '';
    const formattedMessage = `${prefix}${location.line}:${location.column} - [${category}] ${message}`;

    super(formattedMessage);

    this.name = 'LassTranspileError';
    this.category = category;
    this.location = location;

    // Maintain proper stack trace in V8 environments
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, LassTranspileError);
    }
  }

  /**
   * Creates an error with just a source position.
   * Useful when filename is not available.
   */
  static at(
    message: string,
    category: ErrorCategory,
    line: number,
    column: number,
    offset: number = 0
  ): LassTranspileError {
    return new LassTranspileError(message, category, { line, column, offset });
  }

  /**
   * Creates an error with file path and source position.
   */
  static atFile(
    message: string,
    category: ErrorCategory,
    filename: string,
    line: number,
    column: number,
    offset: number = 0
  ): LassTranspileError {
    return new LassTranspileError(message, category, { filename, line, column, offset });
  }
}

/**
 * Helper to format source location for display.
 *
 * @param location - Source location to format
 * @returns Formatted string like "filename:line:column" or "line:column"
 */
export function formatLocation(location: FileLocation): string {
  const prefix = location.filename ? `${location.filename}:` : '';
  return `${prefix}${location.line}:${location.column}`;
}
