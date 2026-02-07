/**
 * Scope tracking utilities for CSS property accumulation.
 *
 * Story 3.1: CSS Accumulator in Transpiler
 * Story 3.3: Lookup in {{ }} Context
 * Story 5.1: @{ } Style Block context tracking
 *
 * This module provides utilities for:
 * 1. Cutting CSS into slices at brace boundaries
 * 2. Looking up property values by walking parent chain
 *
 * The approach uses string slices and lazy regex lookup (not Maps).
 * This is compile-time resolution - values are resolved during transpilation.
 *
 * Story 3.3 additions:
 * - Each slice tracks its type ('css' or 'js') based on brace type
 * - Each slice has a parent reference for easy scope walking
 * - findPropertyValue() skips JS-type slices during lookup
 *
 * Story 5.1 additions:
 * - @{ } creates CSS context inside JS context
 * - Context nesting: CSS → {{ JS → @{ CSS → {{ JS }} → CSS } → JS }} → CSS
 */

/**
 * Brace types for context tracking.
 * Story 5.1: Added '@{' for style blocks.
 */
export type BraceType = '{{' | '{' | '@{' | null;

/**
 * A single scope slice with metadata.
 * Story 3.3: Added type and parent for scope tracking.
 * Story 5.1: Added openedBy to track brace type.
 */
export interface ScopeSlice {
  /** The text content of this slice */
  content: string;
  /** Type of scope: 'css' for { } and @{ }, 'js' for {{ }} */
  type: 'css' | 'js';
  /** Index of parent slice, or null for root-level slices */
  parent: number | null;
  /** What brace type opened this slice: '{{', '{', '@{', or null for root */
  openedBy: BraceType;
}

/**
 * Result of cutting CSS by braces.
 */
export interface ScopeSlices {
  /** Array of slice objects with content, type, and parent reference */
  slices: ScopeSlice[];
  /** Minimum depth reached (negative indicates unbalanced closing braces) */
  minDepth: number;
  /** Maximum depth reached */
  maxDepth: number;
}

/**
 * Context frame for tracking nested brace scopes.
 */
interface ContextFrame {
  braceType: BraceType;
  sliceIndex: number;
}

/**
 * Cuts CSS text into slices at brace boundaries.
 *
 * Handles three brace types:
 * - { } for CSS blocks (CSS context)
 * - {{ }} for JS expressions (JS context)
 * - @{ } for style blocks (CSS context inside JS)
 *
 * Story 3.3: Each slice now includes:
 * - type: 'css' for content inside { } and @{ }, 'js' for content inside {{ }}
 * - parent: index of the parent slice for scope walking
 *
 * Story 5.1: @{ } creates CSS context inside JS, enabling @(prop) resolution
 * inside style blocks.
 *
 * Example with CSS nesting:
 * ```
 * Input: ".parent { color: blue; .child { border: 1px; } }"
 * Slices: [
 *   { content: ".parent ", type: 'css', parent: null },
 *   { content: " color: blue; .child ", type: 'css', parent: 0 },
 *   { content: " border: 1px; ", type: 'css', parent: 1 },
 *   { content: " ", type: 'css', parent: 0 },
 *   { content: "", type: 'css', parent: null }
 * ]
 * ```
 *
 * Example with JS expression:
 * ```
 * Input: ".box { color: {{ expr }}; }"
 * Slices: [
 *   { content: ".box ", type: 'css', parent: null },
 *   { content: " color: ", type: 'css', parent: 0 },
 *   { content: " expr ", type: 'js', parent: 1 },
 *   { content: "; ", type: 'css', parent: 0 },
 *   { content: "", type: 'css', parent: null }
 * ]
 * ```
 *
 * Example with style block:
 * ```
 * Input: ".box { {{ @{ color: red; } }} }"
 * Slices: [
 *   { content: ".box ", type: 'css', parent: null },
 *   { content: " ", type: 'css', parent: 0 },
 *   { content: " ", type: 'js', parent: 1 },
 *   { content: " color: red; ", type: 'css', parent: 2 },  // CSS inside @{ }
 *   { content: " ", type: 'js', parent: 1 },
 *   { content: " ", type: 'css', parent: 0 },
 *   { content: "", type: 'css', parent: null }
 * ]
 * ```
 *
 * @param cssZone - The CSS text to split
 * @returns Object with slices array, minDepth, and maxDepth
 */
export function cutByBraces(cssZone: string): ScopeSlices {
  if (!cssZone) {
    return { 
      slices: [{ content: '', type: 'css', parent: null, openedBy: null }], 
      minDepth: 0, 
      maxDepth: 0 
    };
  }

  const slices: ScopeSlice[] = [];
  const parentStack: number[] = [];  // Stack of parent slice indices
  const contextStack: ContextFrame[] = [];  // Stack of brace types for matching
  let currentSlice = '';
  let currentType: 'css' | 'js' = 'css';
  let currentOpenedBy: BraceType = null;  // What opened the current slice
  let depth = 0;
  let minDepth = 0;
  let maxDepth = 0;

  for (let i = 0; i < cssZone.length; i++) {
    const char = cssZone[i];
    const nextChar = cssZone[i + 1];

    // Check for {{ (double opening brace - JS expression)
    if (char === '{' && nextChar === '{') {
      // Push current slice with current parent and openedBy
      const parent = parentStack.length > 0 ? parentStack[parentStack.length - 1]! : null;
      slices.push({ content: currentSlice, type: currentType, parent, openedBy: currentOpenedBy });
      // The slice we just pushed becomes the parent for nested content
      parentStack.push(slices.length - 1);
      contextStack.push({ braceType: '{{', sliceIndex: slices.length - 1 });
      currentSlice = '';
      currentType = 'js';  // Entering JS expression
      currentOpenedBy = '{{';
      depth++;
      maxDepth = Math.max(maxDepth, depth);
      i++;  // Skip the second {
    }
    // Check for }} (double closing brace - JS expression)
    else if (char === '}' && nextChar === '}') {
      // Push current slice with current parent and openedBy
      const parent = parentStack.length > 0 ? parentStack[parentStack.length - 1]! : null;
      slices.push({ content: currentSlice, type: currentType, parent, openedBy: currentOpenedBy });
      // Pop parent since we're exiting this scope
      parentStack.pop();
      contextStack.pop();
      currentSlice = '';
      // Determine what type and openedBy to return to based on context stack
      currentType = getContextType(contextStack);
      currentOpenedBy = getContextOpenedBy(contextStack);
      depth--;
      minDepth = Math.min(minDepth, depth);
      i++;  // Skip the second }
    }
    // Check for @{ (style block - CSS inside JS)
    else if (char === '@' && nextChar === '{') {
      // Push current slice with current parent and openedBy
      const parent = parentStack.length > 0 ? parentStack[parentStack.length - 1]! : null;
      slices.push({ content: currentSlice, type: currentType, parent, openedBy: currentOpenedBy });
      // The slice we just pushed becomes the parent for nested content
      parentStack.push(slices.length - 1);
      contextStack.push({ braceType: '@{', sliceIndex: slices.length - 1 });
      currentSlice = '';
      currentType = 'css';  // @{ } creates CSS context
      currentOpenedBy = '@{';
      depth++;
      maxDepth = Math.max(maxDepth, depth);
      i++;  // Skip the {
    }
    // Single { (CSS block)
    else if (char === '{') {
      // Push current slice with current parent and openedBy
      const parent = parentStack.length > 0 ? parentStack[parentStack.length - 1]! : null;
      slices.push({ content: currentSlice, type: currentType, parent, openedBy: currentOpenedBy });
      // The slice we just pushed becomes the parent for nested content
      parentStack.push(slices.length - 1);
      contextStack.push({ braceType: '{', sliceIndex: slices.length - 1 });
      currentSlice = '';
      currentOpenedBy = '{';
      // CSS block stays in current type (CSS if in CSS, JS if in JS)
      depth++;
      maxDepth = Math.max(maxDepth, depth);
    }
    // Single } (closes CSS block, @{ block, or is part of JS)
    else if (char === '}') {
      // Push current slice with current parent and openedBy
      const parent = parentStack.length > 0 ? parentStack[parentStack.length - 1]! : null;
      slices.push({ content: currentSlice, type: currentType, parent, openedBy: currentOpenedBy });
      // Pop parent since we're exiting this scope
      parentStack.pop();
      contextStack.pop();
      currentSlice = '';
      // Determine what type and openedBy to return to based on context stack
      currentType = getContextType(contextStack);
      currentOpenedBy = getContextOpenedBy(contextStack);
      depth--;
      minDepth = Math.min(minDepth, depth);
    } else {
      currentSlice += char;
    }
  }

  // Always add trailing content (even if empty) to maintain consistent structure
  const parent = parentStack.length > 0 ? parentStack[parentStack.length - 1]! : null;
  slices.push({ content: currentSlice, type: currentType, parent, openedBy: currentOpenedBy });

  return { slices, minDepth, maxDepth };
}

/**
 * Determines the current context type based on the context stack.
 * 
 * - Empty stack or top is '{' → 'css'
 * - Top is '{{' → 'js'
 * - Top is '@{' → 'css' (style block creates CSS inside JS)
 */
function getContextType(contextStack: ContextFrame[]): 'css' | 'js' {
  if (contextStack.length === 0) {
    return 'css';
  }
  const top = contextStack[contextStack.length - 1]!;
  switch (top.braceType) {
    case '{{':
      return 'js';
    case '@{':
    case '{':
    default:
      return 'css';
  }
}

/**
 * Determines what brace opened the current context based on the context stack.
 */
function getContextOpenedBy(contextStack: ContextFrame[]): BraceType {
  if (contextStack.length === 0) {
    return null;
  }
  return contextStack[contextStack.length - 1]!.braceType;
}

/**
 * Finds the value of a CSS property by searching the scope tree.
 *
 * Story 3.3: Algorithm using parent references:
 * 1. Search current slice (up to the position before @prop)
 * 2. Search earlier sibling slices (same parent, earlier index)
 * 3. Walk up to parent and repeat
 * 4. Stop when we reach a root slice (parent: null) and exhaust all earlier siblings
 *
 * JS-type slices ({{ }}) are skipped during search since they contain
 * JS code, not CSS property declarations.
 *
 * @param propName - The property name to look up (e.g., "border")
 * @param slices - The slices from cutByBraces()
 * @param currentIndex - Index of the slice containing the @prop reference
 * @param positionInSlice - Character position in current slice (for self-reference protection)
 * @returns The property value, or empty string if not found
 */
export function findPropertyValue(
  propName: string,
  slices: ScopeSlice[],
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

  // Helper to check if a value is resolved (doesn't contain @(...) references)
  const isResolvedValue = (value: string): boolean => {
    return !value.includes('@(');
  };

  // Search current slice first (with position limit for self-reference protection)
  const currentSlice = slices[currentIndex]!;
  if (currentSlice.type === 'css') {
    const searchContent = positionInSlice >= 0 
      ? currentSlice.content.slice(0, positionInSlice) 
      : currentSlice.content;
    const match = findLastMatch(searchContent, pattern);
    if (match) {
      const trimmed = match.trim();
      // Skip values that contain unresolved @(...) references
      if (isResolvedValue(trimmed)) {
        return trimmed;
      }
    }
  }

  // Now search backwards through all earlier slices
  // We search slices with the same parent first (siblings), then walk up
  // The key insight: walk backward through slices, but only search those
  // that are in our ancestry chain (share a common parent path)
  
  // Build the set of all ancestor indices (the parent chain from current slice)
  const ancestorIndices = new Set<number>();
  let parentIndex: number | null = currentSlice.parent;
  while (parentIndex !== null) {
    ancestorIndices.add(parentIndex);
    parentIndex = slices[parentIndex]!.parent;
  }

  // Walk backward through slices, searching those that share our ancestry
  for (let i = currentIndex - 1; i >= 0; i--) {
    const slice = slices[i]!;
    
    // Skip JS-type slices
    if (slice.type === 'js') {
      continue;
    }

    // Check if this slice is in our ancestor chain or shares a parent with one of them
    // A slice is reachable if:
    // 1. It's one of our ancestors (in ancestorIndices)
    // 2. Its parent is one of our ancestors (it's a sibling of an ancestor)
    const isAncestor = ancestorIndices.has(i);
    const isReachableSibling = slice.parent !== null && ancestorIndices.has(slice.parent);
    
    // Also include slices whose parent is the same as current slice's parent (direct siblings)
    const isDirectSibling = slice.parent === currentSlice.parent;
    
    if (!isAncestor && !isReachableSibling && !isDirectSibling) {
      continue;
    }

    // Search this slice
    const match = findLastMatch(slice.content, pattern);
    if (match) {
      const trimmed = match.trim();
      // Skip values that contain unresolved @(...) references
      if (isResolvedValue(trimmed)) {
        return trimmed;
      }
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
 * they don't share a common ancestor (neither is in the other's parent chain).
 *
 * Story 3.3: Uses parent references for simpler implementation.
 *
 * @param sliceIndexA - Index of first slice
 * @param sliceIndexB - Index of second slice
 * @param slices - The slices from cutByBraces()
 * @returns true if slices are in DIFFERENT sibling trees (isolated from each other)
 */
export function areSiblingTrees(
  sliceIndexA: number,
  sliceIndexB: number,
  slices: ScopeSlice[]
): boolean {
  // Build set of all ancestors of slice A (including A itself)
  const ancestorsA = new Set<number>();
  let index: number | null = sliceIndexA;
  while (index !== null) {
    ancestorsA.add(index);
    index = slices[index]!.parent;
  }

  // Check if slice B or any of its ancestors is in A's ancestor set
  index = sliceIndexB;
  while (index !== null) {
    if (ancestorsA.has(index)) {
      return false;  // Found common ancestor - not siblings
    }
    index = slices[index]!.parent;
  }

  return true;  // No common ancestor - they are siblings
}

/**
 * Checks if a slice is inside an at-rule boundary (@media, @layer, etc).
 *
 * At-rule boundaries create separate scopes - properties from outside
 * cannot be accessed from inside (in v0).
 *
 * Story 3.3: Uses parent references for simpler implementation.
 * Walks up the parent chain checking if any ancestor contains an at-rule.
 *
 * @param slices - The slices from cutByBraces()
 * @param sliceIndex - Index of the slice to check
 * @returns true if the slice is inside an at-rule
 */
export function isInsideAtRule(
  slices: ScopeSlice[],
  sliceIndex: number
): boolean {
  // Walk up parent chain looking for at-rule patterns
  let index: number | null = slices[sliceIndex]?.parent ?? null;
  
  while (index !== null) {
    const slice = slices[index]!;
    // Check if this ancestor contains an at-rule
    if (/@(?:media|layer|supports|container|keyframes|font-face)\b/i.test(slice.content)) {
      return true;
    }
    index = slice.parent;
  }
  
  return false;
}
