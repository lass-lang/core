/**
 * Scope tracker tests for CSS property accumulation (Story 3.1).
 *
 * Tests the scope tracking utilities:
 * - cutByBraces() - splits CSS at brace boundaries
 * - findPropertyValue() - backward search for property values
 * - areSiblingTrees() - detects sibling selector tree isolation
 */

import { describe, it, expect } from 'vitest';
import {
  cutByBraces,
  findPropertyValue,
  areSiblingTrees,
  isInsideAtRule,
} from '../src/scope-tracker.js';

describe('scope-tracker', () => {
  describe('cutByBraces()', () => {
    describe('basic slicing', () => {
      it('should handle empty input', () => {
        const result = cutByBraces('');
        expect(result.slices).toEqual(['']);
        expect(result.depths).toEqual([0]);
        expect(result.minDepth).toBe(0);
        expect(result.maxDepth).toBe(0);
      });

      it('should handle CSS without braces', () => {
        const result = cutByBraces('color: blue;');
        expect(result.slices).toEqual(['color: blue;']);
        expect(result.depths).toEqual([0]);
        expect(result.minDepth).toBe(0);
        expect(result.maxDepth).toBe(0);
      });

      it('should split single rule into slices', () => {
        const result = cutByBraces('.box { color: blue; }');
        expect(result.slices).toEqual(['.box ', ' color: blue; ', '']);
        expect(result.depths).toEqual([0, 1, 0]);
        expect(result.minDepth).toBe(0);
        expect(result.maxDepth).toBe(1);
      });

      it('should handle nested rules', () => {
        const result = cutByBraces('.parent { color: blue; .child { border: 1px; } }');
        expect(result.slices).toEqual([
          '.parent ',
          ' color: blue; .child ',
          ' border: 1px; ',
          ' ',
          '',
        ]);
        expect(result.depths).toEqual([0, 1, 2, 1, 0]);
        expect(result.maxDepth).toBe(2);
      });

      it('should handle deeply nested rules', () => {
        const result = cutByBraces('.a { .b { .c { color: red; } } }');
        expect(result.slices).toEqual(['.a ', ' .b ', ' .c ', ' color: red; ', ' ', ' ', '']);
        expect(result.depths).toEqual([0, 1, 2, 3, 2, 1, 0]);
        expect(result.maxDepth).toBe(3);
      });

      it('should handle multiple sibling rules', () => {
        const result = cutByBraces('.a { color: red; } .b { color: blue; }');
        expect(result.slices).toEqual(['.a ', ' color: red; ', ' .b ', ' color: blue; ', '']);
        expect(result.depths).toEqual([0, 1, 0, 1, 0]);
      });
    });

    describe('edge cases', () => {
      it('should handle unbalanced opening braces gracefully', () => {
        const result = cutByBraces('.box { .child {');
        expect(result.slices).toEqual(['.box ', ' .child ', '']);
        expect(result.depths).toEqual([0, 1, 2]);
        expect(result.maxDepth).toBe(2);
        expect(result.minDepth).toBe(0);
      });

      it('should track negative depth for unbalanced closing braces', () => {
        const result = cutByBraces('.box } }');
        expect(result.slices).toEqual(['.box ', ' ', '']);
        // Negative depth indicates unbalanced closing braces (CSS error)
        expect(result.depths).toEqual([0, -1, -2]);
        expect(result.minDepth).toBe(-2);
      });

      it('should handle adjacent braces', () => {
        const result = cutByBraces('a{}b{}');
        expect(result.slices).toEqual(['a', '', 'b', '', '']);
        expect(result.depths).toEqual([0, 1, 0, 1, 0]);
      });

      it('should preserve whitespace in slices', () => {
        const result = cutByBraces('  .box  {  color: blue;  }  ');
        expect(result.slices).toEqual(['  .box  ', '  color: blue;  ', '  ']);
        expect(result.depths).toEqual([0, 1, 0]);
      });
    });

    describe('double brace handling ({{ }})', () => {
      it('should treat {{ as single depth increase', () => {
        const result = cutByBraces('.box { color: {{ expr }}; }');
        expect(result.slices).toEqual(['.box ', ' color: ', ' expr ', '; ', '']);
        expect(result.depths).toEqual([0, 1, 2, 1, 0]);
      });

      it('should handle {{ }} at top level', () => {
        const result = cutByBraces('{{ expr }}');
        expect(result.slices).toEqual(['', ' expr ', '']);
        expect(result.depths).toEqual([0, 1, 0]);
      });

      it('should handle nested {{ }} inside CSS blocks', () => {
        const result = cutByBraces('.box { margin: {{ a }}px {{ b }}px; }');
        expect(result.slices).toEqual(['.box ', ' margin: ', ' a ', 'px ', ' b ', 'px; ', '']);
        expect(result.depths).toEqual([0, 1, 2, 1, 2, 1, 0]);
      });

      it('should differentiate single brace from double brace', () => {
        // { is CSS block, {{ is JS expression
        const result = cutByBraces('.a { color: {{ x }}; } .b { }');
        expect(result.slices).toEqual(['.a ', ' color: ', ' x ', '; ', ' .b ', ' ', '']);
        expect(result.depths).toEqual([0, 1, 2, 1, 0, 1, 0]);
      });
    });
  });

  describe('findPropertyValue()', () => {
    describe('same-block reference', () => {
      it('should find property in current slice', () => {
        // .box { border: 1px solid; outline: @border; }
        const { slices, depths } = cutByBraces('.box { border: 1px solid; outline: @border; }');
        // Looking for "border" in slice 1 which contains "border: 1px solid; outline: @border;"
        const value = findPropertyValue('border', slices, depths, 1);
        expect(value).toBe('1px solid');
      });

      it('should find property with extra whitespace', () => {
        const { slices, depths } = cutByBraces('.box {  border  :  1px solid  ; }');
        const value = findPropertyValue('border', slices, depths, 1);
        expect(value).toBe('1px solid');
      });

      it('should return last value when property is declared multiple times', () => {
        // .box { color: red; color: blue; outline-color: @color; }
        const { slices, depths } = cutByBraces('.box { color: red; color: blue; outline-color: @color; }');
        const value = findPropertyValue('color', slices, depths, 1);
        expect(value).toBe('blue');
      });
    });

    describe('parent walk-up', () => {
      it('should find property in parent scope', () => {
        // .parent { border: solid; .child { outline: @border; } }
        const { slices, depths } = cutByBraces('.parent { border: solid; .child { outline: @border; } }');
        // slice 2 is inside .child, looking for "border" which is in slice 1 (parent)
        const value = findPropertyValue('border', slices, depths, 2);
        expect(value).toBe('solid');
      });

      it('should find property in grandparent scope', () => {
        // .grandparent { border: dashed; .parent { .child { outline: @border; } } }
        const { slices, depths } = cutByBraces('.grandparent { border: dashed; .parent { .child { outline: @border; } } }');
        // slice 3 is .child, looking for "border" in grandparent (slice 1)
        const value = findPropertyValue('border', slices, depths, 3);
        expect(value).toBe('dashed');
      });

      it('should find nearest ancestor when multiple ancestors have property', () => {
        // .parent { border: solid; .child { border: dashed; .grandchild { outline: @border; } } }
        const { slices, depths } = cutByBraces('.parent { border: solid; .child { border: dashed; .grandchild { outline: @border; } } }');
        // slice 3 is .grandchild, should find "dashed" from .child (slice 2), not "solid" from .parent
        const value = findPropertyValue('border', slices, depths, 3);
        expect(value).toBe('dashed');
      });
    });

    describe('not found cases (empty string)', () => {
      it('should return empty string for undeclared property', () => {
        const { slices, depths } = cutByBraces('.box { color: blue; }');
        const value = findPropertyValue('border', slices, depths, 1);
        expect(value).toBe('');
      });

      it('should return empty string for forward reference', () => {
        // .box { outline: @border; border: solid; }
        // When looking for "border" at position before "border: solid;"
        const { slices, depths } = cutByBraces('.box { outline: @border; border: solid; }');
        // Search only up to position 15 (before "border: solid")
        const value = findPropertyValue('border', slices, depths, 1, 15);
        expect(value).toBe('');
      });

      it('should return empty string for self-reference', () => {
        // .box { background: @background; }
        const { slices, depths } = cutByBraces('.box { background: @background; }');
        // Position 0 means search empty string (nothing before @background)
        const value = findPropertyValue('background', slices, depths, 1, 1);
        expect(value).toBe('');
      });
    });

    describe('CSS at-rule vs property disambiguation', () => {
      it('should NOT match @propName: (CSS at-rule)', () => {
        // border: 1px; @border { test: @border; }
        // The @border: at the start should not be matched
        const { slices, depths } = cutByBraces('border: 1px;\n@border { test: @border; }');
        // slice 0 contains "border: 1px;\n@border "
        // slice 1 contains " test: @border; "
        const value = findPropertyValue('border', slices, depths, 1);
        // Should find "1px" from the property, not from @border
        expect(value).toBe('1px');
      });

      it('should match property after at-rule on same property name', () => {
        // Tricky case: @color defined as at-rule, color defined as property
        const css = '.test { color: blue; @color: green; background-color: @color; }';
        const { slices, depths } = cutByBraces(css);
        const value = findPropertyValue('color', slices, depths, 1);
        expect(value).toBe('blue');
      });
    });

    describe('edge cases', () => {
      it('should handle property names with hyphens', () => {
        const { slices, depths } = cutByBraces('.box { background-color: red; }');
        const value = findPropertyValue('background-color', slices, depths, 1);
        expect(value).toBe('red');
      });

      it('should handle values with special characters', () => {
        const { slices, depths } = cutByBraces('.box { content: "hello: world"; }');
        const value = findPropertyValue('content', slices, depths, 1);
        expect(value).toBe('"hello: world"');
      });

      it('should handle values with url()', () => {
        const { slices, depths } = cutByBraces('.box { background: url("image.png"); }');
        const value = findPropertyValue('background', slices, depths, 1);
        expect(value).toBe('url("image.png")');
      });

      it('should handle values without semicolon at end of block', () => {
        const { slices, depths } = cutByBraces('.box { color: blue }');
        const value = findPropertyValue('color', slices, depths, 1);
        expect(value).toBe('blue');
      });

      it('should handle invalid slice index gracefully', () => {
        const { slices, depths } = cutByBraces('.box { color: blue; }');
        expect(findPropertyValue('color', slices, depths, -1)).toBe('');
        expect(findPropertyValue('color', slices, depths, 100)).toBe('');
      });
    });
  });

  describe('areSiblingTrees()', () => {
    it('should detect sibling trees at depth 0', () => {
      // .a { color: red; } .b { color: blue; }
      const { depths } = cutByBraces('.a { color: red; } .b { color: blue; }');
      // slices: [".a ", " color: red; ", " .b ", " color: blue; ", ""]
      // depths: [0, 1, 0, 1, 0]
      // Slice 1 (.a's content) and slice 3 (.b's content) are siblings
      expect(areSiblingTrees(1, 3, depths)).toBe(true);
    });

    it('should NOT detect siblings within same tree', () => {
      // .parent { .child1 { } .child2 { } }
      const { depths } = cutByBraces('.parent { .child1 { color: red; } .child2 { color: blue; } }');
      // Both children are inside .parent, not siblings at top level
      expect(areSiblingTrees(2, 4, depths)).toBe(false);
    });

    it('should handle adjacent indices', () => {
      const { depths } = cutByBraces('.a { } .b { }');
      // Adjacent slices with depth 0 between them
      expect(areSiblingTrees(1, 3, depths)).toBe(true);
    });

    it('should handle same index', () => {
      const { depths } = cutByBraces('.a { color: red; }');
      expect(areSiblingTrees(1, 1, depths)).toBe(false);
    });
  });

  describe('isInsideAtRule()', () => {
    it('should detect content inside @media', () => {
      const { slices, depths } = cutByBraces('@media (min-width: 768px) { .box { color: red; } }');
      // slice 2 is inside .box which is inside @media
      expect(isInsideAtRule(slices, depths, 2)).toBe(true);
    });

    it('should detect content inside @layer', () => {
      const { slices, depths } = cutByBraces('@layer base { .box { color: red; } }');
      expect(isInsideAtRule(slices, depths, 2)).toBe(true);
    });

    it('should detect content inside @supports', () => {
      const { slices, depths } = cutByBraces('@supports (display: grid) { .box { color: red; } }');
      expect(isInsideAtRule(slices, depths, 2)).toBe(true);
    });

    it('should detect content inside @container', () => {
      const { slices, depths } = cutByBraces('@container (min-width: 300px) { .box { color: red; } }');
      expect(isInsideAtRule(slices, depths, 2)).toBe(true);
    });

    it('should NOT detect regular rules as at-rules', () => {
      const { slices, depths } = cutByBraces('.box { color: red; }');
      expect(isInsideAtRule(slices, depths, 1)).toBe(false);
    });

    it('should NOT detect rules after at-rule block closes', () => {
      // After the @media block closes, .outside is not inside it
      const { slices, depths } = cutByBraces('@media (min-width: 768px) { .inside { } } .outside { }');
      // slice 4 is inside .outside which is after the @media
      expect(isInsideAtRule(slices, depths, 4)).toBe(false);
    });

    it('should detect content inside @keyframes', () => {
      const { slices, depths } = cutByBraces('@keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }');
      // slice 2 is inside "from" block which is inside @keyframes
      expect(isInsideAtRule(slices, depths, 2)).toBe(true);
    });

    it('should detect content inside @font-face', () => {
      // @font-face doesn't have nested selectors, but content inside is still at-rule content
      const { slices, depths } = cutByBraces('@font-face { font-family: "MyFont"; src: url("font.woff"); }');
      // slice 1 is inside @font-face
      expect(isInsideAtRule(slices, depths, 1)).toBe(true);
    });

    it('should handle nested at-rules', () => {
      // @layer containing @media
      const { slices, depths } = cutByBraces('@layer base { @media (min-width: 768px) { .box { color: red; } } }');
      // slice 3 is inside .box which is inside @media which is inside @layer
      expect(isInsideAtRule(slices, depths, 3)).toBe(true);
    });

    it('should handle regular rule between at-rules', () => {
      // Regular rule sandwiched between at-rules
      const { slices, depths } = cutByBraces('@media print { .a { } } .regular { color: blue; } @layer base { .b { } }');
      // slices: ["@media print ", " .a ", " ", " .regular ", " color: blue; ", " @layer base ", " .b ", " ", ""]
      // depths: [0, 1, 2, 1, 0, 1, 0, 1, 2, 1, 0]
      // The .regular rule (slice containing "color: blue;") should NOT be inside an at-rule
      const { slices: s, depths: d } = cutByBraces('@media print { .a { } } .regular { color: blue; } @layer base { .b { } }');
      // Find the slice with "color: blue"
      const regularSliceIndex = s.findIndex(slice => slice.includes('color: blue'));
      expect(isInsideAtRule(s, d, regularSliceIndex)).toBe(false);
    });

    it('should handle at-rule at start when checking deep slice', () => {
      // Edge case: at-rule is the very first slice, checking a deep nested slice
      const { slices, depths } = cutByBraces('@media screen { .a { .b { .c { color: red; } } } }');
      // slice 4 is deeply nested inside @media
      expect(isInsideAtRule(slices, depths, 4)).toBe(true);
    });

    it('should return false when depth-0 slice between is not an at-rule', () => {
      // Edge case: depth returns to 0 but opener is a regular selector, not at-rule
      // Structure: .regular { .nested { } } - at slice 2 (.nested content)
      // Walking back: slice 1 at depth 1, slice 0 at depth 0 (regular selector opener)
      const { slices, depths } = cutByBraces('.regular { .nested { color: blue; } }');
      // slice 2 contains "color: blue;", we check if it's inside an at-rule
      expect(isInsideAtRule(slices, depths, 2)).toBe(false);
    });

    it('should detect at-rule when first slice is at-rule and we reach it during walk-up', () => {
      // Edge case: the at-rule starts at the very first slice
      // When walking back from a nested slice, we eventually check slice 0
      const { slices, depths } = cutByBraces('@supports (display: flex) { .deep { .deeper { content: "test"; } } }');
      // slice 3 contains 'content: "test"', walking back should find @supports at slice 0
      expect(isInsideAtRule(slices, depths, 3)).toBe(true);
    });
  });

  describe('integration: scope isolation scenarios', () => {
    it('should NOT find property in sibling selector tree', () => {
      // .sidebar { border: dotted; } .main { outline: @border; }
      const { slices, depths } = cutByBraces('.sidebar { border: dotted; } .main { outline: @border; }');
      // slice 3 is .main's content, looking for "border" which is only in .sidebar (slice 1)
      // But .sidebar and .main are sibling trees - depth 0 slice between them
      const value = findPropertyValue('border', slices, depths, 3);
      // Should NOT find it due to sibling tree isolation
      // The findPropertyValue function now respects sibling tree boundaries
      expect(value).toBe('');
    });

    it('depth-based search stops at scope boundary', () => {
      // .outer { border: solid; } .other { .inner { outline: @border; } }
      const { slices, depths } = cutByBraces('.outer { border: solid; } .other { .inner { outline: @border; } }');
      // slices: [".outer ", " border: solid; ", " .other ", " .inner ", " outline: @border; ", " ", ""]
      // depths: [0, 1, 0, 1, 2, 1, 0]
      // slice 4 (.inner content) at depth 2, parent chain goes to slice 3 at depth 1
      // slice 1 is at depth 1 but belongs to .outer, a different tree
      // There's a depth-0 boundary at slice 2 between .outer and .other
      const value = findPropertyValue('border', slices, depths, 4);
      // Should NOT find "solid" because .outer is not in the parent chain of .inner
      expect(value).toBe('');
    });

    it('should find property when {{ }} expression is between declaration and @prop reference', () => {
      // Critical test: Phase 1 (@prop) runs BEFORE Phase 2 ({{ }})
      // The {{ }} creates its own depth level but shouldn't block property lookup
      const css = `.test {
    color: blue;
    .css-child {
        background: green;
    }
    {{ "border: black;" }}
    outline: @color;
}`;
      const { slices, depths } = cutByBraces(css);
      
      // Find the slice containing @color reference
      const sliceWithRef = slices.findIndex(s => s.includes('@color'));
      expect(sliceWithRef).toBeGreaterThan(0);
      
      // Should find "blue" from earlier in the same selector tree
      const value = findPropertyValue('color', slices, depths, sliceWithRef);
      expect(value).toBe('blue');
    });

    it('should handle multiple {{ }} expressions in same block', () => {
      const css = `.test {
    border: 1px solid;
    {{ expr1 }}
    {{ expr2 }}
    outline: @border;
}`;
      const { slices, depths } = cutByBraces(css);
      const sliceWithRef = slices.findIndex(s => s.includes('@border'));
      const value = findPropertyValue('border', slices, depths, sliceWithRef);
      expect(value).toBe('1px solid');
    });

    it('should find property after nested child block closes', () => {
      // Property declared, then nested child, then @prop reference
      // The @prop should find the property from before the nested child
      const css = `.test {
    color: blue;
    .css-child {
        background: green;
    }
    outline: @color;
}`;
      const { slices, depths } = cutByBraces(css);
      const sliceWithRef = slices.findIndex(s => s.includes('@color'));
      const value = findPropertyValue('color', slices, depths, sliceWithRef);
      expect(value).toBe('blue');
    });

    it('should find property with nested child AND {{ }} in same block', () => {
      // Combined case: nested CSS child + JS expression + @prop reference
      const css = `.test {
    color: blue;
    .css-child {
        background: green;
    }
    {{ "border: black;" }}
    outline: @color;
}`;
      const { slices, depths } = cutByBraces(css);
      const sliceWithRef = slices.findIndex(s => s.includes('@color'));
      const value = findPropertyValue('color', slices, depths, sliceWithRef);
      expect(value).toBe('blue');
    });
  });
});
