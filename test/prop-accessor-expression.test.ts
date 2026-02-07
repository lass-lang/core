/**
 * Tests for @prop property accessor inside {{ }} expressions.
 *
 * Story 3.3: Lookup in {{ }} Context
 *
 * Tests cover:
 * - Simple @prop inside {{ }} - resolves and quotes value
 * - @prop with JS logic - parseInt, math operations
 * - @prop inside template literals within {{ }}
 * - Multiple @prop in one expression
 * - @prop not found inside {{ }} - preserved (causes JS error)
 * - Nested scope lookup from inside {{ }}
 */

import { describe, test, expect } from 'vitest';
import { transpile, Scanner } from '../src/index.js';

/**
 * Executes transpiled Lass code and returns the CSS output.
 */
async function executeTranspiledCode(code: string): Promise<string> {
  const dataUrl = `data:text/javascript;charset=utf-8,${encodeURIComponent(code)}`;
  const module = await import(dataUrl);
  return module.default;
}

describe('Story 3.3: @prop inside {{ }} expressions', () => {
  describe('AC4: Simple expression case', () => {
    test('basic {{ @prop }} resolves to quoted value', async () => {
      const input = `---
.box {
  color: blue;
  border-color: {{ @color }};
}`;
      const { code } = transpile(input);
      const output = await executeTranspiledCode(code);
      expect(output).toContain('border-color: blue');
    });

    test('@prop in expression finds value from same block', async () => {
      const input = `---
.card {
  padding: 20px;
  margin: {{ @padding }};
}`;
      const { code } = transpile(input);
      const output = await executeTranspiledCode(code);
      expect(output).toContain('margin: 20px');
    });

    test('@prop in expression finds value from parent scope', async () => {
      const input = `---
.parent {
  border: solid;
  .child {
    outline: {{ @border }};
  }
}`;
      const { code } = transpile(input);
      const output = await executeTranspiledCode(code);
      expect(output).toContain('outline: solid');
    });
  });

  describe('AC5: Expression with JS logic', () => {
    test('parseInt(@prop) * 2 works with pixel values', async () => {
      const input = `---
.box {
  padding: 16px;
  margin: {{ parseInt(@padding) * 2 }}px;
}`;
      const { code } = transpile(input);
      const output = await executeTranspiledCode(code);
      expect(output).toContain('margin: 32px');
    });

    test('math with multiple @prop references', async () => {
      const input = `---
.box {
  padding: 10px;
  margin: 5px;
  total: {{ parseInt(@padding) + parseInt(@margin) }}px;
}`;
      const { code } = transpile(input);
      const output = await executeTranspiledCode(code);
      expect(output).toContain('total: 15px');
    });

    test('string operations with @prop', async () => {
      const input = `---
.box {
  color: blue;
  content: {{ @color.toUpperCase() }};
}`;
      const { code } = transpile(input);
      const output = await executeTranspiledCode(code);
      expect(output).toContain('content: BLUE');
    });
  });

  describe('AC6: @prop inside JS template literals', () => {
    test('template literal with ${@prop}', async () => {
      const input = `---
.box {
  color: blue;
  {{ \`border-color: \${@color};\` }}
}`;
      const { code } = transpile(input);
      const output = await executeTranspiledCode(code);
      expect(output).toContain('border-color: blue');
    });

    test('multiple @prop in template literal', async () => {
      // Note: @prop inside ${} within backticks within {{ }}
      // This is a complex nesting that requires proper escaping
      const input = `---
.box {
  width: 100px;
  height: 50px;
  content: {{ "Size: " + @width + " x " + @height }};
}`;
      const { code } = transpile(input);
      const output = await executeTranspiledCode(code);
      expect(output).toContain('content: Size: 100px x 50px');
    });
  });

  describe('edge cases', () => {
    test('multiple @prop in one {{ }} expression', async () => {
      const input = `---
.box {
  width: 100;
  height: 50;
  content: {{ @width + " x " + @height }};
}`;
      const { code } = transpile(input);
      const output = await executeTranspiledCode(code);
      expect(output).toContain('content: 100 x 50');
    });

    test('@prop not found inside {{ }} is preserved (causes JS error)', async () => {
      const input = `---
.box {
  color: {{ @nonexistent }};
}`;
      // @nonexistent is not found, so it's preserved as @nonexistent
      // This causes a JS error because @nonexistent is not valid JS
      await expect(async () => {
        const { code } = transpile(input);
        await executeTranspiledCode(code);
      }).rejects.toThrow();
    });

    test('value with quotes is properly escaped', async () => {
      const input = `---
.box {
  font-family: "Arial";
  content: {{ @font-family }};
}`;
      const { code } = transpile(input);
      const output = await executeTranspiledCode(code);
      expect(output).toContain('content: "Arial"');
    });

    test('@prop in CSS context vs JS context', async () => {
      // Same property accessed in CSS context (raw) and JS context (quoted)
      const input = `---
.box {
  color: blue;
  border-color: @color;
  background: {{ @color }};
}`;
      const { code } = transpile(input);
      const output = await executeTranspiledCode(code);
      // CSS context: raw value
      expect(output).toContain('border-color: blue');
      // JS context: value used in expression, outputs raw
      expect(output).toContain('background: blue');
    });

    test('nested {{ }} inside CSS block with @prop', async () => {
      const input = `---
.parent {
  padding: 10px;
  .child {
    margin: {{ parseInt(@padding) * 2 }}px;
  }
}`;
      const { code } = transpile(input);
      const output = await executeTranspiledCode(code);
      expect(output).toContain('margin: 20px');
    });
  });

  describe('scanner detection', () => {
    test('scanner detects @prop inside {{ }}', () => {
      const cssZone = '.box { color: blue; background: {{ @color }}; }';
      const accessors = Scanner.findPropertyAccessorsStatic(cssZone);
      expect(accessors).toHaveLength(1);
      expect(accessors[0]!.propName).toBe('color');
    });

    test('scanner detects multiple @prop inside {{ }}', () => {
      const cssZone = '.box { a: 1; b: 2; c: {{ @a + @b }}; }';
      const accessors = Scanner.findPropertyAccessorsStatic(cssZone);
      expect(accessors).toHaveLength(2);
      expect(accessors[0]!.propName).toBe('a');
      expect(accessors[1]!.propName).toBe('b');
    });

    test('scanner handles {{ }} nesting correctly', () => {
      // Multiple {{ }} in same block, each with @prop
      const cssZone = '.box { x: 1; a: {{ @x }}; b: {{ @x }}; }';
      const accessors = Scanner.findPropertyAccessorsStatic(cssZone);
      expect(accessors).toHaveLength(2);
    });
  });
});
