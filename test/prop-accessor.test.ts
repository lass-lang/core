/**
 * Tests for @(prop) property accessor functionality.
 *
 * Story 3.2: Basic Property Lookup
 * Refactored: Changed from @prop to @(prop) for unambiguous syntax
 *
 * Tests cover:
 * - Detection of @(prop) in CSS value position
 * - Exclusion of CSS at-rules (@media, @layer, etc.) - not needed with @() syntax
 * - Property resolution via scope-tracker utilities
 * - Support for custom properties: @(--custom)
 *
 * NOTE: Lass→CSS behavior tests are in style-lookup.common.md and
 * style-lookup.extra-cases.md axioms.
 */

import { describe, test, expect } from 'vitest';
import { Scanner } from '../src/scanner.js';

describe('Scanner.findPropertyAccessors', () => {
  describe('detection in CSS value position', () => {
    test('detects @(prop) after colon', () => {
      const scanner = new Scanner('');
      const result = scanner.findPropertyAccessors('.box { border-left: @(border); }');
      expect(result).toHaveLength(1);
      expect(result[0].propName).toBe('border');
    });

    test('detects multiple @(prop) in same block', () => {
      const scanner = new Scanner('');
      const result = scanner.findPropertyAccessors('.box { color: @(primary); background: @(secondary); }');
      expect(result).toHaveLength(2);
      expect(result[0].propName).toBe('primary');
      expect(result[1].propName).toBe('secondary');
    });

    test('detects @(prop) with hyphenated name', () => {
      const scanner = new Scanner('');
      const result = scanner.findPropertyAccessors('.box { margin: @(margin-top); }');
      expect(result).toHaveLength(1);
      expect(result[0].propName).toBe('margin-top');
    });

    test('detects @(prop) with vendor prefix', () => {
      const scanner = new Scanner('');
      const result = scanner.findPropertyAccessors('.box { transform: @(-webkit-transform); }');
      expect(result).toHaveLength(1);
      expect(result[0].propName).toBe('-webkit-transform');
    });

    test('detects @(--custom) custom property', () => {
      const scanner = new Scanner('');
      const result = scanner.findPropertyAccessors('.box { color: @(--accent-color); }');
      expect(result).toHaveLength(1);
      expect(result[0].propName).toBe('--accent-color');
    });
  });

  describe('@(prop) NOT detected outside value position', () => {
    test('@(prop) in selector position is not detected', () => {
      const scanner = new Scanner('');
      // @(prop) before colon - not in value position
      const result = scanner.findPropertyAccessors('@(selector) { color: red; }');
      expect(result).toHaveLength(0);
    });

    test('@(prop) at start of CSS (before any :) is not detected', () => {
      const scanner = new Scanner('');
      const result = scanner.findPropertyAccessors('@(test) .box { color: red; }');
      expect(result).toHaveLength(0);
    });
  });

  describe('CSS at-rules are not confused with @(prop)', () => {
    // With @(prop) syntax, there's no ambiguity with CSS at-rules
    // These tests verify CSS at-rules pass through unchanged and don't trigger detection
    test('@media is not detected as @(prop)', () => {
      const scanner = new Scanner('');
      const result = scanner.findPropertyAccessors('@media screen { .box { color: red; } }');
      expect(result).toHaveLength(0);
    });

    test('@layer is not detected as @(prop)', () => {
      const scanner = new Scanner('');
      const result = scanner.findPropertyAccessors('@layer utilities { .box { color: red; } }');
      expect(result).toHaveLength(0);
    });

    test('@keyframes is not detected as @(prop)', () => {
      const scanner = new Scanner('');
      const result = scanner.findPropertyAccessors('@keyframes fade { from { opacity: 0; } }');
      expect(result).toHaveLength(0);
    });

    test('@font-face is not detected as @(prop)', () => {
      const scanner = new Scanner('');
      const result = scanner.findPropertyAccessors('@font-face { font-family: "Custom"; }');
      expect(result).toHaveLength(0);
    });

    test('@import is not detected as @(prop)', () => {
      const scanner = new Scanner('');
      const result = scanner.findPropertyAccessors('@import url("styles.css");');
      expect(result).toHaveLength(0);
    });

    test('@supports is not detected as @(prop)', () => {
      const scanner = new Scanner('');
      const result = scanner.findPropertyAccessors('@supports (display: grid) { .box { display: grid; } }');
      expect(result).toHaveLength(0);
    });

    test('@container is not detected as @(prop)', () => {
      const scanner = new Scanner('');
      const result = scanner.findPropertyAccessors('@container (min-width: 300px) { .box { color: red; } }');
      expect(result).toHaveLength(0);
    });

    test('@charset is not detected as @(prop)', () => {
      const scanner = new Scanner('');
      const result = scanner.findPropertyAccessors('@charset "UTF-8";');
      expect(result).toHaveLength(0);
    });

    test('@namespace is not detected as @(prop)', () => {
      const scanner = new Scanner('');
      const result = scanner.findPropertyAccessors('@namespace svg url(http://www.w3.org/2000/svg);');
      expect(result).toHaveLength(0);
    });

    test('@page is not detected as @(prop)', () => {
      const scanner = new Scanner('');
      const result = scanner.findPropertyAccessors('@page { margin: 1cm; }');
      expect(result).toHaveLength(0);
    });

    test('@property is not detected as @(prop)', () => {
      const scanner = new Scanner('');
      const result = scanner.findPropertyAccessors('@property --my-color { syntax: "<color>"; inherits: false; }');
      expect(result).toHaveLength(0);
    });

    test('@scope is not detected as @(prop)', () => {
      const scanner = new Scanner('');
      const result = scanner.findPropertyAccessors('@scope (.card) { .title { color: red; } }');
      expect(result).toHaveLength(0);
    });

    test('@starting-style is not detected as @(prop)', () => {
      const scanner = new Scanner('');
      const result = scanner.findPropertyAccessors('@starting-style { .box { opacity: 0; } }');
      expect(result).toHaveLength(0);
    });
  });

  describe('@(prop) requires explicit parentheses', () => {
    test('@prop without parens is NOT detected', () => {
      const scanner = new Scanner('');
      // @border without parens is not detected - only @(border) is recognized
      const result = scanner.findPropertyAccessors('.box { test: @border; }');
      expect(result).toHaveLength(0);
    });

    test('@(prop) in value is detected even with @rule nearby', () => {
      const scanner = new Scanner('');
      // @border at start is CSS at-rule, @(border) after : is Lass accessor
      const result = scanner.findPropertyAccessors('@border { test: @(border); }');
      expect(result).toHaveLength(1);
      expect(result[0].propName).toBe('border');
    });

    test('bare @custom-rule at line start is not detected', () => {
      const scanner = new Scanner('');
      const result = scanner.findPropertyAccessors('@custom-rule { color: red; }');
      expect(result).toHaveLength(0);
    });
  });

  describe('edge cases', () => {
    test('handles empty input', () => {
      const scanner = new Scanner('');
      const result = scanner.findPropertyAccessors('');
      expect(result).toHaveLength(0);
    });

    test('handles CSS without @(prop)', () => {
      const scanner = new Scanner('');
      const result = scanner.findPropertyAccessors('.box { color: red; }');
      expect(result).toHaveLength(0);
    });

    test('handles @(prop) with whitespace after colon', () => {
      const scanner = new Scanner('');
      const result = scanner.findPropertyAccessors('.box { color:   @(color); }');
      expect(result).toHaveLength(1);
      expect(result[0].propName).toBe('color');
    });

    test('returns correct indices for @(prop)', () => {
      const scanner = new Scanner('');
      const css = '.box { color: @(color); }';
      const result = scanner.findPropertyAccessors(css);
      expect(result).toHaveLength(1);
      // @(color) includes the parentheses
      expect(css.slice(result[0].startIndex, result[0].endIndex)).toBe('@(color)');
    });

    test('does not match incomplete @( without closing paren', () => {
      const scanner = new Scanner('');
      const result = scanner.findPropertyAccessors('.box { color: @(color; }');
      expect(result).toHaveLength(0);
    });

    test('does not match @() empty accessor', () => {
      const scanner = new Scanner('');
      const result = scanner.findPropertyAccessors('.box { color: @(); }');
      expect(result).toHaveLength(0);
    });
  });
});

// NOTE: All lass→css behavior tests are in style-lookup.common.md and
// style-lookup.extra-cases.md axioms. Scanner detection tests above cover
// implementation details only.
