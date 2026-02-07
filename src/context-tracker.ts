/**
 * Shared context tracking utilities for protected zones in CSS.
 *
 * Story 4.2: Extracted to reduce code duplication between
 * findDollarVariablesStatic() and findStyleLookupShorthandsStatic().
 *
 * Protected contexts are zones where Lass symbols ($param, @prop) should
 * NOT be detected:
 * - String literals ("..." or '...')
 * - Block comments (slash-star ... star-slash)
 *
 * Note: url() is NOT a protected context - only strings and comments are.
 */

/**
 * Tracks context state for protected zones during scanning.
 */
export interface ContextState {
  /** Currently inside a string literal ("..." or '...') */
  inString: boolean;
  /** The quote character that opened the current string */
  stringChar: string;
  /** Currently inside a block comment */
  inBlockComment: boolean;
}

/**
 * Creates a fresh context state for scanning.
 */
export function createContextState(): ContextState {
  return {
    inString: false,
    stringChar: '',
    inBlockComment: false,
  };
}

/**
 * Checks if currently in a protected context (string or block comment).
 * Protected contexts prevent symbol detection for $param and @prop.
 *
 * Note: url() is NOT a protected context - only strings and comments are.
 */
export function isInProtectedContext(state: ContextState): boolean {
  return state.inString || state.inBlockComment;
}

/**
 * Updates context state based on current character.
 * Handles block comments and string literals with proper escape handling.
 *
 * @param text - The full text being scanned
 * @param index - Current character index
 * @param state - Context state to update (mutated)
 * @returns Number of characters consumed (1 normally, 2 for comment markers)
 */
export function updateContextState(
  text: string,
  index: number,
  state: ContextState
): number {
  const char = text[index]!;
  const nextChar = text[index + 1];

  // Track block comment start: /*
  if (!state.inString && !state.inBlockComment && char === '/' && nextChar === '*') {
    state.inBlockComment = true;
    return 2;
  }

  // Track block comment end: */
  if (state.inBlockComment && char === '*' && nextChar === '/') {
    state.inBlockComment = false;
    return 2;
  }

  // Track string literals (only when not in comment)
  if (!state.inBlockComment && (char === '"' || char === "'")) {
    if (!state.inString) {
      state.inString = true;
      state.stringChar = char;
    } else if (char === state.stringChar) {
      // Check for escaped quote - count consecutive backslashes
      let backslashCount = 0;
      for (let j = index - 1; j >= 0 && text[j] === '\\'; j--) {
        backslashCount++;
      }
      // If odd number of backslashes, quote is escaped
      if (backslashCount % 2 === 0) {
        state.inString = false;
      }
    }
    return 1;
  }

  return 1;
}
