/**
 * Style lookup shorthand tests for Story 4.2.
 *
 * Tests the findStyleLookupShorthands() method that detects @prop patterns
 * in CSS value position and the transpiler integration for @prop → @(prop) normalization.
 *
 * NOTE: Lass→CSS behavior tests are in style-lookup-shorthand.common.md and
 * style-lookup-shorthand.extra-cases.md axioms. These tests cover scanner detection only.
 */

import { describe, it, expect } from 'vitest';
import { Scanner } from '../src/scanner.js';

describe('Scanner.findStyleLookupShorthands()', () => {
  describe('AC1: Basic @prop detection', () => {
    it('should detect @prop in value position', () => {
      const result = Scanner.findStyleLookupShorthandsStatic('.box { border: 1px solid; border-left: @border; }');

      expect(result).toEqual([
        { propName: 'border', startIndex: 39, endIndex: 46 },
      ]);
    });

    it('should detect @prop followed by semicolon', () => {
      const result = Scanner.findStyleLookupShorthandsStatic('color: @color;');

      expect(result).toEqual([
        { propName: 'color', startIndex: 7, endIndex: 13 },
      ]);
    });

    it('should detect @prop followed by space', () => {
      const result = Scanner.findStyleLookupShorthandsStatic('border: @width solid @color;');

      expect(result).toEqual([
        { propName: 'width', startIndex: 8, endIndex: 14 },
        { propName: 'color', startIndex: 21, endIndex: 27 },
      ]);
    });

    it('should detect multiple @prop in one rule', () => {
      const result = Scanner.findStyleLookupShorthandsStatic('.box { color: red; background: @color; }');

      expect(result).toEqual([
        { propName: 'color', startIndex: 31, endIndex: 37 },
      ]);
    });
  });

  describe('AC8: Identifier boundary handling', () => {
    it('should detect @border-color as single property (hyphen is part of identifier)', () => {
      const result = Scanner.findStyleLookupShorthandsStatic('outline: @border-color;');

      expect(result).toEqual([
        { propName: 'border-color', startIndex: 9, endIndex: 22 },
      ]);
    });

    it('should stop at colon boundary', () => {
      const result = Scanner.findStyleLookupShorthandsStatic('.x { color:@color; }');

      expect(result).toEqual([
        { propName: 'color', startIndex: 11, endIndex: 17 },
      ]);
    });

    it('should stop at closing brace boundary', () => {
      const result = Scanner.findStyleLookupShorthandsStatic('.x { color: @color}');

      expect(result).toEqual([
        { propName: 'color', startIndex: 12, endIndex: 18 },
      ]);
    });
  });

  describe('Identifier start restrictions (letter only)', () => {
    it('should NOT detect @--custom (starts with hyphen)', () => {
      const result = Scanner.findStyleLookupShorthandsStatic('color: @--custom;');

      expect(result).toEqual([]);
    });

    it('should NOT detect @-webkit-foo (starts with hyphen)', () => {
      const result = Scanner.findStyleLookupShorthandsStatic('color: @-webkit-foo;');

      expect(result).toEqual([]);
    });

    it('should NOT detect @123 (starts with number)', () => {
      const result = Scanner.findStyleLookupShorthandsStatic('color: @123;');

      expect(result).toEqual([]);
    });

    it('should NOT detect @_underscore (starts with underscore)', () => {
      const result = Scanner.findStyleLookupShorthandsStatic('color: @_underscore;');

      expect(result).toEqual([]);
    });
  });

  describe('Value position restriction', () => {
    it('should NOT detect @prop in selector position', () => {
      const result = Scanner.findStyleLookupShorthandsStatic('@test { color: red; }');

      expect(result).toEqual([]);
    });

    it('should NOT detect @prop in property name position', () => {
      const result = Scanner.findStyleLookupShorthandsStatic('.box { @border: 1px; }');

      expect(result).toEqual([]);
    });

    it('should detect @prop after colon', () => {
      const result = Scanner.findStyleLookupShorthandsStatic('.box { test: @color; }');

      expect(result).toEqual([
        { propName: 'color', startIndex: 13, endIndex: 19 },
      ]);
    });
  });

  describe('AC3: Style-only context restriction (not inside {{ }})', () => {
    it('should NOT detect @prop inside {{ }} script block', () => {
      const result = Scanner.findStyleLookupShorthandsStatic('color: {{ @border }};');

      expect(result).toEqual([]);
    });

    it('should detect @prop outside {{ }} in same declaration', () => {
      const result = Scanner.findStyleLookupShorthandsStatic('color: @color; margin: {{ x }};');

      expect(result).toEqual([
        { propName: 'color', startIndex: 7, endIndex: 13 },
      ]);
    });

    it('should NOT detect @prop inside nested {{ }}', () => {
      const result = Scanner.findStyleLookupShorthandsStatic('color: {{ fn({ a: @x }) }};');

      expect(result).toEqual([]);
    });
  });

  describe('AC4: Skip detection in protected contexts', () => {
    it('should NOT detect @prop inside double-quoted string', () => {
      const result = Scanner.findStyleLookupShorthandsStatic('content: "the @prop here";');

      expect(result).toEqual([]);
    });

    it('should NOT detect @prop inside single-quoted string', () => {
      const result = Scanner.findStyleLookupShorthandsStatic("content: 'the @prop here';");

      expect(result).toEqual([]);
    });

    it('should NOT detect @prop inside block comment', () => {
      const result = Scanner.findStyleLookupShorthandsStatic('color: red; /* use @color */');

      expect(result).toEqual([]);
    });

    it('should detect @prop inside url() without quotes', () => {
      // url() is NOT a protected context - @prop inside url(@path) IS detected
      // Only strings protect @prop (same behavior as $param)
      const result = Scanner.findStyleLookupShorthandsStatic('background: url(@path/image.png);');

      expect(result).toEqual([
        { propName: 'path', startIndex: 16, endIndex: 21 },
      ]);
    });

    it('should NOT detect @prop inside url() with quotes', () => {
      // Quotes create a string context, which IS protected
      const result = Scanner.findStyleLookupShorthandsStatic('background: url("@path/image.png");');

      expect(result).toEqual([]);
    });

    it('should detect @prop after url()', () => {
      const result = Scanner.findStyleLookupShorthandsStatic('background: url(foo.png), @color;');

      expect(result).toEqual([
        { propName: 'color', startIndex: 26, endIndex: 32 },
      ]);
    });
  });

  describe('Edge cases', () => {
    it('should handle @@prop (first @ literal, second resolves)', () => {
      // @@border: first @ is not followed by letter (next char is @), so literal
      // second @border IS detected
      const result = Scanner.findStyleLookupShorthandsStatic('outline: @@border;');

      expect(result).toEqual([
        { propName: 'border', startIndex: 10, endIndex: 17 },
      ]);
    });

    it('should return empty array for empty input', () => {
      expect(Scanner.findStyleLookupShorthandsStatic('')).toEqual([]);
    });

    it('should handle @prop at end of input without semicolon', () => {
      const result = Scanner.findStyleLookupShorthandsStatic('color: @color');

      expect(result).toEqual([
        { propName: 'color', startIndex: 7, endIndex: 13 },
      ]);
    });
  });
});

describe('Transpiler @prop integration - Scanner', () => {
  // NOTE: Lass→CSS behavior tests are in style-lookup-shorthand.common.md and
  // style-lookup-shorthand.extra-cases.md axioms.
  // These tests cover scanner detection for @{ } context edge cases.

  describe('@{ } context edge cases - scanner detection', () => {
    it('should detect @prop inside @{ } within {{ }}', () => {
      // Tests the context stack: {{ pushes js, @{ pushes css inside js
      // @prop shorthand IS detected in @{ } css context
      const css = '.box { border: 1px; margin: {{ @{ @border } }}; }';
      const shorthands = Scanner.findStyleLookupShorthandsStatic(css);
      expect(shorthands).toHaveLength(1);
      expect(shorthands[0]!.propName).toBe('border');
    });

    it('should handle }} closing @{ context correctly', () => {
      // Edge case: }} appears while inside @{ context (malformed but handled)
      // The scanner should pop @{ contexts to find the js context
      const css = '.box { color: {{ @{ content: @val }} extra }}; }';
      const shorthands = Scanner.findStyleLookupShorthandsStatic(css);
      // @val is inside @{ } which is inside {{ }}, so it IS detected
      expect(shorthands.some(s => s.propName === 'val')).toBe(true);
    });
  });
});
