/**
 * Tests for @prop property accessor functionality.
 *
 * Story 3.2: Basic Property Lookup
 *
 * Tests cover:
 * - Detection of @prop in CSS value position
 * - Exclusion of CSS at-rules (@media, @layer, etc.)
 * - Property resolution via scope-tracker utilities
 * - Preservation of unknown @prop (no empty string replacement)
 */

import { describe, test, expect } from 'vitest';
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

describe('Scanner.findPropertyAccessors', () => {
  describe('detection in CSS value position', () => {
    test('detects @prop after colon', () => {
      const scanner = new Scanner('');
      const result = scanner.findPropertyAccessors('.box { border-left: @border; }');
      expect(result).toHaveLength(1);
      expect(result[0].propName).toBe('border');
    });

    test('detects multiple @prop in same block', () => {
      const scanner = new Scanner('');
      const result = scanner.findPropertyAccessors('.box { color: @primary; background: @secondary; }');
      expect(result).toHaveLength(2);
      expect(result[0].propName).toBe('primary');
      expect(result[1].propName).toBe('secondary');
    });

    test('detects @prop with hyphenated name', () => {
      const scanner = new Scanner('');
      const result = scanner.findPropertyAccessors('.box { margin: @margin-top; }');
      expect(result).toHaveLength(1);
      expect(result[0].propName).toBe('margin-top');
    });

    test('detects @prop with vendor prefix', () => {
      const scanner = new Scanner('');
      const result = scanner.findPropertyAccessors('.box { transform: @-webkit-transform; }');
      expect(result).toHaveLength(1);
      expect(result[0].propName).toBe('-webkit-transform');
    });
  });

  describe('excludes CSS at-rules', () => {
    test('ignores @media', () => {
      const scanner = new Scanner('');
      const result = scanner.findPropertyAccessors('@media screen { .box { color: red; } }');
      expect(result).toHaveLength(0);
    });

    test('ignores @layer', () => {
      const scanner = new Scanner('');
      const result = scanner.findPropertyAccessors('@layer utilities { .box { color: red; } }');
      expect(result).toHaveLength(0);
    });

    test('ignores @keyframes', () => {
      const scanner = new Scanner('');
      const result = scanner.findPropertyAccessors('@keyframes fade { from { opacity: 0; } }');
      expect(result).toHaveLength(0);
    });

    test('ignores @font-face', () => {
      const scanner = new Scanner('');
      const result = scanner.findPropertyAccessors('@font-face { font-family: "Custom"; }');
      expect(result).toHaveLength(0);
    });

    test('ignores @import', () => {
      const scanner = new Scanner('');
      const result = scanner.findPropertyAccessors('@import url("styles.css");');
      expect(result).toHaveLength(0);
    });

    test('ignores @supports', () => {
      const scanner = new Scanner('');
      const result = scanner.findPropertyAccessors('@supports (display: grid) { .box { display: grid; } }');
      expect(result).toHaveLength(0);
    });

    test('ignores @container', () => {
      const scanner = new Scanner('');
      const result = scanner.findPropertyAccessors('@container (min-width: 300px) { .box { color: red; } }');
      expect(result).toHaveLength(0);
    });

    test('ignores @charset', () => {
      const scanner = new Scanner('');
      const result = scanner.findPropertyAccessors('@charset "UTF-8";');
      expect(result).toHaveLength(0);
    });

    test('ignores @namespace', () => {
      const scanner = new Scanner('');
      const result = scanner.findPropertyAccessors('@namespace svg url(http://www.w3.org/2000/svg);');
      expect(result).toHaveLength(0);
    });

    test('ignores @page', () => {
      const scanner = new Scanner('');
      const result = scanner.findPropertyAccessors('@page { margin: 1cm; }');
      expect(result).toHaveLength(0);
    });

    test('ignores @property', () => {
      const scanner = new Scanner('');
      const result = scanner.findPropertyAccessors('@property --my-color { syntax: "<color>"; inherits: false; }');
      expect(result).toHaveLength(0);
    });

    test('ignores @scope', () => {
      const scanner = new Scanner('');
      const result = scanner.findPropertyAccessors('@scope (.card) { .title { color: red; } }');
      expect(result).toHaveLength(0);
    });

    test('ignores @starting-style', () => {
      const scanner = new Scanner('');
      const result = scanner.findPropertyAccessors('@starting-style { .box { opacity: 0; } }');
      expect(result).toHaveLength(0);
    });
  });

  describe('@prop in value position vs at-rule in statement position', () => {
    test('detects @prop in value but ignores @rule at statement start', () => {
      const scanner = new Scanner('');
      // @border at start is CSS at-rule, @border after : is Lass accessor
      const result = scanner.findPropertyAccessors('@border { test: @border; }');
      expect(result).toHaveLength(1);
      expect(result[0].propName).toBe('border');
    });

    test('does not detect @prop at line start (statement position)', () => {
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

    test('handles CSS without @prop', () => {
      const scanner = new Scanner('');
      const result = scanner.findPropertyAccessors('.box { color: red; }');
      expect(result).toHaveLength(0);
    });

    test('handles @prop with whitespace after colon', () => {
      const scanner = new Scanner('');
      const result = scanner.findPropertyAccessors('.box { color:   @color; }');
      expect(result).toHaveLength(1);
      expect(result[0].propName).toBe('color');
    });

    test('returns correct indices for @prop', () => {
      const scanner = new Scanner('');
      const css = '.box { color: @color; }';
      const result = scanner.findPropertyAccessors(css);
      expect(result).toHaveLength(1);
      // @color starts at index 14
      expect(css.slice(result[0].startIndex, result[0].endIndex)).toBe('@color');
    });
  });
});

describe('resolvePropertyAccessors', () => {
  describe('same-block reference (AC3)', () => {
    test('resolves @prop from earlier declaration in same block', async () => {
      const input = `---
.box {
  border: 1px solid;
  outline: @border;
}`;
      const { code } = transpile(input);
      const output = await executeTranspiledCode(code);
      expect(output).toBe(`.box {
  border: 1px solid;
  outline: 1px solid;
}`);
    });

    test('resolves multiple @prop in same block', async () => {
      const input = `---
.box {
  color: red;
  background: blue;
  border-color: @color;
  outline-color: @background;
}`;
      const { code } = transpile(input);
      const output = await executeTranspiledCode(code);
      expect(output).toContain('border-color: red');
      expect(output).toContain('outline-color: blue');
    });

    test('uses last value when property declared multiple times', async () => {
      const input = `---
.box {
  color: red;
  color: blue;
  background: @color;
}`;
      const { code } = transpile(input);
      const output = await executeTranspiledCode(code);
      expect(output).toContain('background: blue');
    });
  });

  describe('parent scope walk-up (AC4)', () => {
    test('resolves @prop from parent scope', async () => {
      const input = `---
.parent {
  border: solid;
  .child {
    outline: @border;
  }
}`;
      const { code } = transpile(input);
      const output = await executeTranspiledCode(code);
      expect(output).toContain('outline: solid');
    });

    test('nearest ancestor wins (shadowing)', async () => {
      const input = `---
.parent {
  border: dashed;
  .child {
    border: solid;
    .grandchild {
      outline: @border;
    }
  }
}`;
      const { code } = transpile(input);
      const output = await executeTranspiledCode(code);
      expect(output).toContain('outline: solid');
    });
  });

  describe('scope isolation - preserve unknown (AC5)', () => {
    test('preserves @prop when sibling trees are isolated', async () => {
      const input = `---
.sidebar {
  border: dotted;
}

.main {
  outline: @border;
}`;
      const { code } = transpile(input);
      const output = await executeTranspiledCode(code);
      expect(output).toContain('outline: @border');
    });

    test('preserves @prop for undeclared property', async () => {
      const input = `---
.box {
  color: @nonexistent;
}`;
      const { code } = transpile(input);
      const output = await executeTranspiledCode(code);
      expect(output).toContain('color: @nonexistent');
    });

    test('preserves @prop for forward reference', async () => {
      const input = `---
.box {
  outline: @border;
  border: solid;
}`;
      const { code } = transpile(input);
      const output = await executeTranspiledCode(code);
      expect(output).toContain('outline: @border');
    });

    test('preserves @prop for self-reference', async () => {
      const input = `---
.box {
  background: @background;
}`;
      const { code } = transpile(input);
      const output = await executeTranspiledCode(code);
      expect(output).toContain('background: @background');
    });
  });

  describe('at-rule boundaries - preserve unknown (AC6)', () => {
    test('preserves @prop across @media boundary', async () => {
      const input = `---
.box {
  padding: 16px;
}

@media (min-width: 768px) {
  .box {
    margin: @padding;
  }
}`;
      const { code } = transpile(input);
      const output = await executeTranspiledCode(code);
      expect(output).toContain('margin: @padding');
    });

    test('preserves @prop across @layer boundary', async () => {
      const input = `---
@layer base {
  .box {
    color: blue;
  }
}

@layer utilities {
  .box {
    background: @color;
  }
}`;
      const { code } = transpile(input);
      const output = await executeTranspiledCode(code);
      expect(output).toContain('background: @color');
    });
  });

  describe('pipeline integration (AC2)', () => {
    test('@prop in CSS zone resolves before {{ }} processes', async () => {
      // This test verifies pipeline order: @prop (Phase 1) then {{ }} (Phase 2)
      // The @prop in the CSS zone (not inside {{ }}) should resolve first
      const input = `const color = "green";
---
.box {
  border: solid;
  outline: @border;
  background: {{ color }};
}`;
      const { code } = transpile(input);
      const output = await executeTranspiledCode(code);
      // @border should be resolved to "solid" (Phase 1)
      // {{ color }} should be resolved to "green" (Phase 2)
      expect(output).toContain('outline: solid');
      expect(output).toContain('background: green');
    });

    test('@prop inside {{ }} now works (Story 3.3)', async () => {
      // Story 3.3: @prop inside {{ }} is detected, resolved, and quoted
      const input = `---
.box {
  color: blue;
  background: {{ @color }};
}`;
      const { code } = transpile(input);
      const output = await executeTranspiledCode(code);
      // @color inside {{ }} resolves to "blue" (quoted), then {{ }} evaluates to blue
      expect(output).toContain('background: blue');
    });
  });
});
