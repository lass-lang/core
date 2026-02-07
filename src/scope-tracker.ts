/**
 * Scope tracking utilities for CSS property accumulation.
 *
 * Story 3.1: CSS Accumulator in Transpiler
 *
 * This module provides utilities for:
 * 1. Cutting CSS into slices at brace boundaries
 * 2. Looking up property values with backward search through scopes
 *
 * The approach uses string slices and lazy regex lookup (not Maps).
 * This is compile-time resolution - values are resolved during transpilation.
 */

/**
 * Result of cutting CSS by braces.
 */
export interface ScopeSlices {
  /** Array of string slices between brace boundaries ({ } or {{ }}) */
  slices: string[];
  /** Depth at which each slice exists (0 = top level, negative = unbalanced closing braces) */
  depths: number[];
  /** Minimum depth reached (negative indicates unbalanced closing braces) */
  minDepth: number;
  /** Maximum depth reached */
  maxDepth: number;
}

/**
 * Cuts CSS text into slices at brace boundaries.
 *
 * Handles both single braces ({ }) for CSS blocks and double braces
 * ({{ }}) for JS expressions. Each brace pair increases/decreases depth by 1.
 *
 * Example with CSS nesting:
 * ```
 * Input: ".parent { color: blue; .child { border: 1px; } }"
 * Slices: [".parent ", " color: blue; .child ", " border: 1px; ", " "]
 * Depths: [0, 1, 2, 1]
 * ```
 *
 * Example with JS expression:
 * ```
 * Input: ".box { color: {{ expr }}; }"
 * Slices: [".box ", " color: ", " expr ", "; ", ""]
 * Depths: [0, 1, 2, 1, 0]
 * ```
 *
 * @param cssZone - The CSS text to split
 * @returns Object with slices array and depths array
 */
export function cutByBraces(cssZone: string): ScopeSlices {
  if (!cssZone) {
    return { slices: [''], depths: [0], minDepth: 0, maxDepth: 0 };
  }

  const slices: string[] = [];
  const depths: number[] = [];
  let currentSlice = '';
  let depth = 0;
  let minDepth = 0;
  let maxDepth = 0;

  for (let i = 0; i < cssZone.length; i++) {
    const char = cssZone[i];
    const nextChar = cssZone[i + 1];

    // Check for {{ (double opening brace - JS expression)
    if (char === '{' && nextChar === '{') {
      // End current slice before the braces
      slices.push(currentSlice);
      depths.push(depth);
      currentSlice = '';
      depth++;
      maxDepth = Math.max(maxDepth, depth);
      i++; // Skip the second {
    }
    // Check for }} (double closing brace - JS expression)
    else if (char === '}' && nextChar === '}') {
      // End current slice before the braces
      slices.push(currentSlice);
      depths.push(depth);
      currentSlice = '';
      depth--;
      minDepth = Math.min(minDepth, depth);
      i++; // Skip the second }
    }
    // Single { (CSS block)
    else if (char === '{') {
      // End current slice before the brace
      slices.push(currentSlice);
      depths.push(depth);
      currentSlice = '';
      depth++;
      maxDepth = Math.max(maxDepth, depth);
    }
    // Single } (CSS block)
    else if (char === '}') {
      // End current slice before the brace
      slices.push(currentSlice);
      depths.push(depth);
      currentSlice = '';
      depth--;
      minDepth = Math.min(minDepth, depth);
    } else {
      currentSlice += char;
    }
  }

  // Always add trailing content (even if empty) to maintain consistent structure
  slices.push(currentSlice);
  depths.push(depth);

  return { slices, depths, minDepth, maxDepth };
}

/**
 * Finds the value of a CSS property by searching backward through slices.
 *
 * Search algorithm:
 * 1. Start at the current slice (up to the position before @prop)
 * 2. Search for `propName:` pattern (NOT `@propName:`)
 * 3. If not found, walk backward to parent slices
 * 4. Stop at scope boundaries (when depth decreases past starting point)
 *
 * @param propName - The property name to look up (e.g., "border")
 * @param slices - The slices from cutByBraces()
 * @param depths - The depth array from cutByBraces()
 * @param currentIndex - Index of the slice containing the @prop reference
 * @param positionInSlice - Character position in current slice (for self-reference protection)
 * @returns The property value, or empty string if not found
 */
export function findPropertyValue(
  propName: string,
  slices: string[],
  depths: number[],
  currentIndex: number,
  positionInSlice: number = -1
): string {
  if (currentIndex < 0 || currentIndex >= slices.length) {
    return '';
  }

  // Escape special regex characters in property name
  const escapedPropName = propName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // Pattern: propName followed by : but NOT preceded by @
  // Must match whole property name (word boundary or start of string)
  // Captures the value between : and ; (or end of block)
  // Uses negative lookbehind to exclude @propName: (CSS at-rules)
  const pattern = new RegExp(
    `(?:^|[\\s;])(?<!@)${escapedPropName}\\s*:\\s*([^;{}]+?)(?:;|$)`,
    'gi'
  );

  const startDepth = depths[currentIndex]!;

  // Search current slice first (only content before positionInSlice)
  const currentSlice = slices[currentIndex]!;
  const searchContent =
    positionInSlice >= 0 ? currentSlice.slice(0, positionInSlice) : currentSlice;

  const currentMatch = findLastMatch(searchContent, pattern);
  if (currentMatch) {
    return currentMatch.trim();
  }

  // Walk backward through ancestor slices
  //
  // Simple rules:
  // 1. SKIP slices with depth > startDepth (nested blocks like {{ }} - not ancestors)
  // 2. SEARCH slices with depth <= startDepth (same level or parent scopes)
  // 3. STOP after searching depth 0 (reached root of our selector tree)
  //
  // Example: .test { color: blue; {{ expr }} outline: @color; }
  //   depths: [0, 1, 2, 1, 0], at slice 3 (depth 1)
  //   i=2: depth 2 > 1 → skip
  //   i=1: depth 1 <= 1 → search → find "color: blue" ✓
  //
  // Example: .a { } .b { @color }
  //   depths: [0, 1, 0, 1, 0], at slice 3 (depth 1)
  //   i=2: depth 0 <= 1 → search (no match), depth 0 → stop
  //   Correctly doesn't see .a's properties (sibling tree)
  
  for (let i = currentIndex - 1; i >= 0; i--) {
    const sliceDepth = depths[i]!;
    
    // Skip nested blocks (depth higher than where we started)
    if (sliceDepth > startDepth) {
      continue;
    }

    // Search this ancestor slice
    const match = findLastMatch(slices[i]!, pattern);
    if (match) {
      return match.trim();
    }
    
    // Stop after searching at depth 0 (root of our tree)
    if (sliceDepth === 0) {
      break;
    }
  }

  // Not found - return empty string (MVP behavior)
  return '';
}

/**
 * Finds the last match of a pattern in text.
 * Returns the captured group 1 (the property value).
 */
function findLastMatch(text: string, pattern: RegExp): string | null {
  // Reset lastIndex for global regex
  pattern.lastIndex = 0;

  let lastMatch: string | null = null;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    lastMatch = match[1] ?? null;
  }

  return lastMatch;
}

/**
 * Determines if two slices are in different sibling selector trees.
 *
 * Sibling trees are isolated - properties from one top-level rule
 * cannot be accessed from another. Two slices are siblings when
 * there's a depth-0 slice between them (indicating separate top-level rules).
 *
 * Note: findPropertyValue() uses a simpler O(1) approach internally
 * (tracking minDepthSeen), but this function is useful for external
 * consumers who need to check sibling relationships between arbitrary slices.
 *
 * @param sliceIndexA - Index of first slice
 * @param sliceIndexB - Index of second slice
 * @param depths - The depth array from cutByBraces()
 * @returns true if slices are in DIFFERENT sibling trees (isolated from each other)
 */
export function areSiblingTrees(
  sliceIndexA: number,
  sliceIndexB: number,
  depths: number[]
): boolean {
  const minIndex = Math.min(sliceIndexA, sliceIndexB);
  const maxIndex = Math.max(sliceIndexA, sliceIndexB);

  // Check if there's a depth-0 boundary between them
  for (let i = minIndex + 1; i < maxIndex; i++) {
    if (depths[i] === 0) {
      return true;
    }
  }

  return false;
}

/**
 * Checks if a slice is inside an at-rule boundary (@media, @layer, etc).
 *
 * At-rule boundaries create separate scopes - properties from outside
 * cannot be accessed from inside (in v0).
 *
 * @param slices - The slices array
 * @param depths - The depth array from cutByBraces()
 * @param sliceIndex - Index of the slice to check
 * @returns true if the slice is inside an at-rule
 */
export function isInsideAtRule(
  slices: string[],
  depths: number[],
  sliceIndex: number
): boolean {
  const startDepth = depths[sliceIndex] ?? 0;
  
  // We need to find the "opening" slice for our current depth level
  // Walk backward to find what opened the block we're in
  let currentCheckDepth = startDepth;
  
  for (let i = sliceIndex - 1; i >= 0; i--) {
    const sliceDepth = depths[i] ?? 0;
    
    // Found a slice at shallower depth - this is what opened our block
    if (sliceDepth < currentCheckDepth) {
      const slice = slices[i]!;
      // Check if this opener is an at-rule
      if (/@(?:media|layer|supports|container|keyframes|font-face)\b/i.test(slice)) {
        return true;
      }
      // Move up to check parent blocks
      currentCheckDepth = sliceDepth;
      
      // If we've reached depth 0 and it's not an at-rule, we're outside any at-rule
      if (sliceDepth === 0) {
        return false;
      }
    }
  }
  
  // If loop completes without finding an at-rule opener, we're not inside one
  return false;
}
