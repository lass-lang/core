/**
 * Transpiler tests for two-zone output (Story 2.1, 2.2).
 *
 * Story 2.1: Zone detection - split on ---, identify preamble and CSS zones
 * Story 2.2: Preamble execution - include preamble in output, it executes when imported
 *
 * Tests the transpile() function's handling of two-zone .lass files.
 */

import { describe, it, expect, vi } from 'vitest';
import { transpile } from '../src/index.js';

/**
 * Executes transpiled Lass code and returns the CSS output.
 * Uses dynamic import with data URL to execute the JS module.
 */
async function executeTranspiledCode(code: string): Promise<string> {
  const dataUrl = `data:text/javascript;charset=utf-8,${encodeURIComponent(code)}`;
  const module = await import(dataUrl);
  return module.default;
}

describe('transpile()', () => {
  describe('CSS passthrough (no separator)', () => {
    it('should wrap CSS in template literal export', () => {
      const { code } = transpile('p { color: red; }');
      expect(code).toBe('export default `p { color: red; }`;');
    });

    it('should escape backticks in CSS', () => {
      const { code } = transpile('p { content: "`"; }');
      expect(code).toContain('\\`');
    });

    it('should escape backslashes in CSS', () => {
      const { code } = transpile('p { content: "\\n"; }');
      expect(code).toContain('\\\\n');
    });

    it('should execute and return CSS', async () => {
      const { code } = transpile('p { color: red; }');
      const css = await executeTranspiledCode(code);
      expect(css).toBe('p { color: red; }');
    });
  });

  describe('two-zone output with preamble execution (Story 2.2)', () => {
    it('should include preamble in output (Story 2.2)', () => {
      const { code } = transpile("const x = 'blue'\n---\np { color: blue; }");

      // Story 2.2: Preamble IS included in output and will execute
      expect(code).toContain("const x = 'blue'");
      expect(code).toContain('export default `p { color: blue; }`;');
    });

    it('should handle empty preamble', () => {
      const { code } = transpile('---\np { color: red; }');
      // Empty preamble - just export
      expect(code).toBe('export default `p { color: red; }`;');
    });

    it('should handle whitespace-only preamble as empty', () => {
      const { code } = transpile('   \n---\np { color: red; }');
      // Whitespace-only preamble treated as empty - just export
      expect(code).toBe('export default `p { color: red; }`;');
    });

    it('should handle empty CSS zone with preamble', () => {
      const { code } = transpile("const x = 'test'\n---");
      // Preamble included, empty CSS zone
      expect(code).toContain("const x = 'test'");
      expect(code).toContain('export default ``;');
    });

    it('should NOT escape dollar signs in CSS zone', () => {
      // For Story 2.2, $name should appear literally ($name substitution is Epic 4, Story 4.x)
      const { code } = transpile("const $color = 'blue'\n---\np { color: $color; }");
      // Dollar should NOT be escaped - it will be used for $name substitution in Epic 4
      expect(code).not.toContain('\\$');
      expect(code).toContain('$color');
      // Preamble should be included
      expect(code).toContain("const $color = 'blue'");
    });

    it('should return CSS zone when executed (preamble runs but CSS is export)', async () => {
      const { code } = transpile("const x = 'test'\n---\np { color: red; }");
      const css = await executeTranspiledCode(code);
      // CSS output is the CSS zone content (preamble executed but doesn't affect export)
      expect(css).toBe('p { color: red; }');
    });

    it('should include multiline preamble in output', () => {
      const input = `const $a = 1
const $b = 2
const $c = $a + $b
---
p { margin: 10px; }`;
      const { code } = transpile(input);

      // All preamble content should be included
      expect(code).toContain('const $a = 1');
      expect(code).toContain('const $b = 2');
      expect(code).toContain('const $c = $a + $b');
      // CSS zone in export
      expect(code).toContain('export default `p { margin: 10px; }`;');
    });

    it('should preserve preamble structure with blank line before export', () => {
      const { code } = transpile("const x = 1\n---\np { }");
      // Should have preamble, then blank line, then export
      expect(code).toBe("const x = 1\n\nexport default `p { }`;");
    });

    it('should handle multiline CSS', () => {
      const input = `const x = 1
---
.parent {
  color: red;
  .child {
    color: blue;
  }
}`;
      const { code } = transpile(input);
      const css = code.match(/export default `([\s\S]*?)`;/)?.[1];

      expect(css).toContain('.parent {');
      expect(css).toContain('color: red;');
      expect(css).toContain('.child {');
      // Preamble included
      expect(code).toContain('const x = 1');
    });

    it('should execute preamble side effects when module is imported', async () => {
      // Spy on console.log to verify preamble execution
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const { code } = transpile('console.log("preamble ran")\n---\np { }');
      await executeTranspiledCode(code);

      expect(consoleSpy).toHaveBeenCalledWith('preamble ran');
      consoleSpy.mockRestore();
    });

    it('should make preamble variables available for future substitution', async () => {
      // This test verifies structure - actual substitution is Story 2.3
      const { code } = transpile("const color = 'blue'\n---\np { color: $color; }");

      // Preamble defines variable
      expect(code).toContain("const color = 'blue'");
      // CSS zone has $color (literal, not substituted yet)
      const css = await executeTranspiledCode(code);
      expect(css).toBe('p { color: $color; }');
    });
  });

  describe('error handling', () => {
    it('should throw on multiple separators', () => {
      expect(() => transpile('a\n---\nb\n---\nc')).toThrow('Multiple --- separators');
    });
  });

  describe('backward compatibility', () => {
    it('should still handle CSS without separator (regression)', () => {
      const { code } = transpile('body { margin: 0; }');
      expect(code).toBe('export default `body { margin: 0; }`;');
    });

    it('should handle escaped characters without separator (regression)', async () => {
      const { code } = transpile('p::before { content: "\\2022"; }');
      const css = await executeTranspiledCode(code);
      expect(css).toBe('p::before { content: "\\2022"; }');
    });
  });

  describe('expression interpolation (Story 2.3)', () => {
    it('should wrap expressions in __lassScriptExpression helper (Story 2.4)', () => {
      const { code } = transpile('const color = "blue"\n---\n.box { color: {{ color }}; }');

      // Should contain ${__lassScriptExpression(color)} interpolation (Story 2.4: wraps expressions)
      expect(code).toContain('${__lassScriptExpression(color)}');
    });

    it('should include __lassScriptExpression helper function when expressions present', () => {
      const { code } = transpile('const color = "blue"\n---\n.box { color: {{ color }}; }');

      // Should contain the helper function
      expect(code).toContain('const __lassScriptExpression');
    });

    it('should remove {{ }} markers from output', () => {
      const { code } = transpile('const color = "blue"\n---\n.box { color: {{ color }}; }');

      // Should not contain {{ }}
      expect(code).not.toContain('{{');
      expect(code).not.toContain('}}');
    });

    it('should evaluate expression and output result', async () => {
      const { code } = transpile('const color = "blue"\n---\n.box { color: {{ color }}; }');
      const css = await executeTranspiledCode(code);

      expect(css).toBe('.box { color: blue; }');
    });

    it('should handle arithmetic expression', async () => {
      const { code } = transpile('const gap = 23\n---\n.box { padding: {{ gap * 2 }}px; }');
      const css = await executeTranspiledCode(code);

      expect(css).toBe('.box { padding: 46px; }');
    });

    it('should handle ternary expression', async () => {
      const { code } = transpile(
        'const darkMode = true\n---\nbody { background: {{ darkMode ? "#1a1a1a" : "#ffffff" }}; }'
      );
      const css = await executeTranspiledCode(code);

      expect(css).toBe('body { background: #1a1a1a; }');
    });

    it('should handle function call expression', async () => {
      const { code } = transpile(
        "function px(n) { return n + 'px' }\n---\n.box { margin: {{ px(16) }}; }"
      );
      const css = await executeTranspiledCode(code);

      expect(css).toBe('.box { margin: 16px; }');
    });

    it('should handle string literal expression', async () => {
      const { code } = transpile('---\n.error { color: {{ "red" }}; }');
      const css = await executeTranspiledCode(code);

      expect(css).toBe('.error { color: red; }');
    });

    it('should handle multiple expressions in one declaration', async () => {
      const { code } = transpile(
        'const top = 10\nconst right = 20\n---\n.box { margin: {{ top }}px {{ right }}px; }'
      );
      const css = await executeTranspiledCode(code);

      expect(css).toBe('.box { margin: 10px 20px; }');
    });

    it('should handle expression in selector position', async () => {
      const { code } = transpile("const tag = 'article'\n---\n{{ tag }} { display: block; }");
      const css = await executeTranspiledCode(code);

      expect(css).toBe('article { display: block; }');
    });

    it('should handle expression in property name position', async () => {
      const { code } = transpile(
        "const prop = 'background-color'\n---\n.box { {{ prop }}: blue; }"
      );
      const css = await executeTranspiledCode(code);

      expect(css).toBe('.box { background-color: blue; }');
    });

    it('should handle nested object access', async () => {
      const { code } = transpile(
        "const theme = { colors: { primary: '#3b82f6' } }\n---\n.button { background: {{ theme.colors.primary }}; }"
      );
      const css = await executeTranspiledCode(code);

      expect(css).toBe('.button { background: #3b82f6; }');
    });

    it('should handle object literal in expression', async () => {
      const { code } = transpile(
        "const getStyle = (opts) => opts.value\n---\n.box { width: {{ getStyle({ value: '100px' }) }}; }"
      );
      const css = await executeTranspiledCode(code);

      expect(css).toBe('.box { width: 100px; }');
    });

    it('should handle CSS without expressions unchanged', async () => {
      const { code } = transpile('const x = 1\n---\n.box { color: red; }');
      const css = await executeTranspiledCode(code);

      expect(css).toBe('.box { color: red; }');
    });

    it('should throw for empty expression', () => {
      expect(() => transpile('---\np { color: {{ }}; }')).toThrow('Empty {{ }} expression');
    });

    it('should throw for unclosed expression', () => {
      expect(() => transpile('---\np { color: {{ color; }')).toThrow('Unclosed {{ expression');
    });
  });
});
