/**
 * Style lookup shorthand tests for Story 4.2.
 *
 * Tests the findStyleLookupShorthands() method that detects @prop patterns
 * in CSS value position and the transpiler integration for @prop → @(prop) normalization.
 */

import { describe, it, expect } from 'vitest';
import { Scanner } from '../src/scanner.js';
import { transpile } from '../src/index.js';

/**
 * Executes transpiled Lass code and returns the CSS output.
 */
async function executeTranspiledCode(code: string): Promise<string> {
  const dataUrl = `data:text/javascript;charset=utf-8,${encodeURIComponent(code)}`;
  const module = await import(dataUrl);
  return module.default;
}

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

describe('Transpiler @prop integration', () => {
  describe('AC7: Transpiled output (same as @(prop))', () => {
    it('should resolve @prop to property value', async () => {
      const source = `.box {
  border: 1px solid blue;
  border-left: @border;
}`;
      const { code } = transpile(source);
      const css = await executeTranspiledCode(code);

      expect(css).toContain('border-left: 1px solid blue;');
    });

    it('should resolve @border-color (hyphenated property)', async () => {
      const source = `.box {
  border-color: red;
  outline-color: @border-color;
}`;
      const { code } = transpile(source);
      const css = await executeTranspiledCode(code);

      expect(css).toContain('outline-color: red;');
    });

    it('should preserve @prop when property not found', async () => {
      const source = `.box {
  color: @missing;
}`;
      const { code } = transpile(source);
      const css = await executeTranspiledCode(code);

      expect(css).toContain('color: @(missing);');
    });

    it('should NOT resolve @--custom (use explicit @(--custom))', async () => {
      const source = `.box {
  --accent: blue;
  color: @--custom;
}`;
      const { code } = transpile(source);
      const css = await executeTranspiledCode(code);

      // @--custom is NOT detected, remains unchanged
      expect(css).toContain('color: @--custom;');
    });

    it('should resolve explicit @(--custom) form', async () => {
      const source = `.box {
  --accent: blue;
  color: @(--accent);
}`;
      const { code } = transpile(source);
      const css = await executeTranspiledCode(code);

      expect(css).toContain('color: blue;');
    });
  });

  describe('AC6: Scope resolution (same as @(prop))', () => {
    it('should resolve from parent scope', async () => {
      const source = `.parent {
  color: red;
  .child {
    background: @color;
  }
}`;
      const { code } = transpile(source);
      const css = await executeTranspiledCode(code);

      expect(css).toContain('background: red;');
    });

    it('should NOT resolve from sibling scope', async () => {
      const source = `.sibling1 {
  color: red;
}
.sibling2 {
  background: @color;
}`;
      const { code } = transpile(source);
      const css = await executeTranspiledCode(code);

      // Sibling's color is not accessible, @color preserved as @(color)
      expect(css).toContain('background: @(color);');
    });
  });

  describe('Mixed usage', () => {
    it('should work with $param in same declaration', async () => {
      const source = `const $gap = '8px';
---
.box {
  border: 1px solid;
  border-left: @border;
  padding: $gap;
}`;
      const { code } = transpile(source);
      const css = await executeTranspiledCode(code);

      expect(css).toContain('border-left: 1px solid;');
      expect(css).toContain('padding: 8px;');
    });

    it('should preserve @prop inside {{ }} (not detected as shorthand)', async () => {
      const source = `.box {
  color: {{ '@border' }};
}`;
      const { code } = transpile(source);
      const css = await executeTranspiledCode(code);

      // @border in string inside {{ }} is preserved as-is
      expect(css).toContain("color: @border;");
    });
  });
});
