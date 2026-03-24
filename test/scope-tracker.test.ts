/**
 * Scope tracker tests for CSS property accumulation (Story 3.1, 3.3).
 *
 * Tests the scope tracking utilities:
 * - cutByBraces() - splits CSS at brace boundaries, tracks parent references and types
 * - findPropertyValue() - walks parent chain to find property values
 * - areSiblingTrees() - detects sibling selector tree isolation
 * - isInsideAtRule() - detects content inside @media, @layer, etc.
 *
 * Story 3.3 changes:
 * - ScopeSlice now includes type ('css' | 'js') and parent reference
 * - findPropertyValue() skips JS-type slices during lookup
 */

import { describe, it, expect } from 'vitest';
import {
  cutByBraces,
  findPropertyValue,
  areSiblingTrees,
  isInsideAtRule,
  type ScopeSlice,
} from '../src/scope-tracker.js';

/**
 * Helper to extract just the content strings from slices for easier assertions.
 */
function getContents(slices: ScopeSlice[]): string[] {
  return slices.map(s => s.content);
}

/**
 * Helper to extract just the types from slices for easier assertions.
 */
function getTypes(slices: ScopeSlice[]): ('css' | 'js')[] {
  return slices.map(s => s.type);
}

/**
 * Helper to extract just the parent indices from slices for easier assertions.
 */
function getParents(slices: ScopeSlice[]): (number | null)[] {
  return slices.map(s => s.parent);
}

describe('scope-tracker', () => {
  describe('cutByBraces()', () => {
    describe('basic slicing', () => {
      it('should handle empty input', () => {
        const result = cutByBraces('');
        expect(getContents(result.slices)).toEqual(['']);
        expect(getTypes(result.slices)).toEqual(['css']);
        expect(getParents(result.slices)).toEqual([null]);
        expect(result.minDepth).toBe(0);
        expect(result.maxDepth).toBe(0);
      });

      it('should handle CSS without braces', () => {
        const result = cutByBraces('color: blue;');
        expect(getContents(result.slices)).toEqual(['color: blue;']);
        expect(getTypes(result.slices)).toEqual(['css']);
        expect(getParents(result.slices)).toEqual([null]);
        expect(result.minDepth).toBe(0);
        expect(result.maxDepth).toBe(0);
      });

      it('should split single rule into slices', () => {
        const result = cutByBraces('.box { color: blue; }');
        expect(getContents(result.slices)).toEqual(['.box ', ' color: blue; ', '']);
        expect(getTypes(result.slices)).toEqual(['css', 'css', 'css']);
        expect(getParents(result.slices)).toEqual([null, 0, null]);
        expect(result.minDepth).toBe(0);
        expect(result.maxDepth).toBe(1);
      });

      it('should handle nested rules', () => {
        const result = cutByBraces('.parent { color: blue; .child { border: 1px; } }');
        expect(getContents(result.slices)).toEqual([
          '.parent ',
          ' color: blue; .child ',
          ' border: 1px; ',
          ' ',
          '',
        ]);
        expect(getTypes(result.slices)).toEqual(['css', 'css', 'css', 'css', 'css']);
        expect(getParents(result.slices)).toEqual([null, 0, 1, 0, null]);
        expect(result.maxDepth).toBe(2);
      });

      it('should handle deeply nested rules', () => {
        const result = cutByBraces('.a { .b { .c { color: red; } } }');
        expect(getContents(result.slices)).toEqual(['.a ', ' .b ', ' .c ', ' color: red; ', ' ', ' ', '']);
        expect(getParents(result.slices)).toEqual([null, 0, 1, 2, 1, 0, null]);
        expect(result.maxDepth).toBe(3);
      });

      it('should handle multiple sibling rules', () => {
        const result = cutByBraces('.a { color: red; } .b { color: blue; }');
        expect(getContents(result.slices)).toEqual(['.a ', ' color: red; ', ' .b ', ' color: blue; ', '']);
        // .a content (1) -> parent 0, .b content (3) -> parent 2
        expect(getParents(result.slices)).toEqual([null, 0, null, 2, null]);
      });
    });

    describe('edge cases', () => {
      it('should handle unbalanced opening braces gracefully', () => {
        const result = cutByBraces('.box { .child {');
        expect(getContents(result.slices)).toEqual(['.box ', ' .child ', '']);
        expect(getParents(result.slices)).toEqual([null, 0, 1]);
        expect(result.maxDepth).toBe(2);
        expect(result.minDepth).toBe(0);
      });

      it('should track negative depth for unbalanced closing braces', () => {
        const result = cutByBraces('.box } }');
        expect(getContents(result.slices)).toEqual(['.box ', ' ', '']);
        expect(result.minDepth).toBe(-2);
      });

      it('should handle adjacent braces', () => {
        const result = cutByBraces('a{}b{}');
        expect(getContents(result.slices)).toEqual(['a', '', 'b', '', '']);
      });

      it('should preserve whitespace in slices', () => {
        const result = cutByBraces('  .box  {  color: blue;  }  ');
        expect(getContents(result.slices)).toEqual(['  .box  ', '  color: blue;  ', '  ']);
      });
    });

    describe('double brace handling ({{ }}) - Story 3.3', () => {
      it('should treat {{ as single depth increase with JS type', () => {
        const result = cutByBraces('.box { color: {{ expr }}; }');
        expect(getContents(result.slices)).toEqual(['.box ', ' color: ', ' expr ', '; ', '']);
        expect(getTypes(result.slices)).toEqual(['css', 'css', 'js', 'css', 'css']);
        expect(getParents(result.slices)).toEqual([null, 0, 1, 0, null]);
      });

      it('should handle {{ }} at top level', () => {
        const result = cutByBraces('{{ expr }}');
        expect(getContents(result.slices)).toEqual(['', ' expr ', '']);
        expect(getTypes(result.slices)).toEqual(['css', 'js', 'css']);
        expect(getParents(result.slices)).toEqual([null, 0, null]);
      });

      it('should handle }} at root level (unbalanced)', () => {
        // }} without matching {{ - parentStack is empty
        const result = cutByBraces('text }}');
        expect(getContents(result.slices)).toEqual(['text ', '']);
        expect(getParents(result.slices)).toEqual([null, null]);
        expect(result.minDepth).toBe(-1);
      });

      it('should handle nested {{ }} inside CSS blocks', () => {
        const result = cutByBraces('.box { margin: {{ a }}px {{ b }}px; }');
        expect(getContents(result.slices)).toEqual(['.box ', ' margin: ', ' a ', 'px ', ' b ', 'px; ', '']);
        expect(getTypes(result.slices)).toEqual(['css', 'css', 'js', 'css', 'js', 'css', 'css']);
      });

      it('should differentiate single brace from double brace', () => {
        // { is CSS block, {{ is JS expression
        const result = cutByBraces('.a { color: {{ x }}; } .b { }');
        expect(getContents(result.slices)).toEqual(['.a ', ' color: ', ' x ', '; ', ' .b ', ' ', '']);
        expect(getTypes(result.slices)).toEqual(['css', 'css', 'js', 'css', 'css', 'css', 'css']);
      });
    });

    describe('@{ } style blocks - Story 5.1', () => {
      it('should handle @{ } at top level', () => {
        // @{ at root creates CSS context
        const result = cutByBraces('@{ color: red; }');
        expect(getContents(result.slices)).toEqual(['', ' color: red; ', '']);
        expect(getTypes(result.slices)).toEqual(['css', 'css', 'css']);
        expect(getParents(result.slices)).toEqual([null, 0, null]);
        expect(result.slices[1]!.openedBy).toBe('@{');
      });

      it('should handle @{ } inside {{ }}', () => {
        const result = cutByBraces('{{ @{ inner } }}');
        expect(getContents(result.slices)).toEqual(['', ' ', ' inner ', ' ', '']);
        expect(getTypes(result.slices)).toEqual(['css', 'js', 'css', 'js', 'css']);
        expect(result.slices[2]!.openedBy).toBe('@{');
      });

      it('should track openedBy for all brace types', () => {
        const result = cutByBraces('.box { {{ @{ x } }} }');
        expect(result.slices[1]!.openedBy).toBe('{');
        expect(result.slices[2]!.openedBy).toBe('{{');
        expect(result.slices[3]!.openedBy).toBe('@{');
      });
    });
  });

  describe('findPropertyValue()', () => {
    describe('same-block reference', () => {
      it('should find property in current slice', () => {
        // .box { border: 1px solid; outline: @(border); }
        const { slices } = cutByBraces('.box { border: 1px solid; outline: @(border); }');
        // Looking for "border" in slice 1 which contains "border: 1px solid; outline: @(border);"
        const value = findPropertyValue('border', slices, 1);
        expect(value).toBe('1px solid');
      });

      it('should find property with extra whitespace', () => {
        const { slices } = cutByBraces('.box {  border  :  1px solid  ; }');
        const value = findPropertyValue('border', slices, 1);
        expect(value).toBe('1px solid');
      });

      it('should return last value when property is declared multiple times', () => {
        // .box { color: red; color: blue; outline-color: @(color); }
        const { slices } = cutByBraces('.box { color: red; color: blue; outline-color: @(color); }');
        const value = findPropertyValue('color', slices, 1);
        expect(value).toBe('blue');
      });
    });

    describe('parent walk-up', () => {
      it('should find property in parent scope', () => {
        // .parent { border: solid; .child { outline: @(border); } }
        const { slices } = cutByBraces('.parent { border: solid; .child { outline: @(border); } }');
        // slice 2 is inside .child, looking for "border" which is in slice 1 (parent)
        const value = findPropertyValue('border', slices, 2);
        expect(value).toBe('solid');
      });

      it('should find property in grandparent scope', () => {
        // .grandparent { border: dashed; .parent { .child { outline: @(border); } } }
        const { slices } = cutByBraces('.grandparent { border: dashed; .parent { .child { outline: @(border); } } }');
        // slice 3 is .child, looking for "border" in grandparent (slice 1)
        const value = findPropertyValue('border', slices, 3);
        expect(value).toBe('dashed');
      });

      it('should find nearest ancestor when multiple ancestors have property', () => {
        // .parent { border: solid; .child { border: dashed; .grandchild { outline: @(border); } } }
        const { slices } = cutByBraces('.parent { border: solid; .child { border: dashed; .grandchild { outline: @(border); } } }');
        // slice 3 is .grandchild, should find "dashed" from .child (slice 2), not "solid" from .parent
        const value = findPropertyValue('border', slices, 3);
        expect(value).toBe('dashed');
      });
    });

    describe('not found cases (empty string)', () => {
      it('should return empty string for undeclared property', () => {
        const { slices } = cutByBraces('.box { color: blue; }');
        const value = findPropertyValue('border', slices, 1);
        expect(value).toBe('');
      });

      it('should return empty string for forward reference', () => {
        // .box { outline: @(border); border: solid; }
        // When looking for "border" at position before "border: solid;"
        const { slices } = cutByBraces('.box { outline: @(border); border: solid; }');
        // Search only up to position 15 (before "border: solid")
        const value = findPropertyValue('border', slices, 1, 15);
        expect(value).toBe('');
      });

      it('should return empty string for self-reference', () => {
        // .box { background: @(background); }
        const { slices } = cutByBraces('.box { background: @(background); }');
        // Position 0 means search empty string (nothing before @(background))
        const value = findPropertyValue('background', slices, 1, 1);
        expect(value).toBe('');
      });

      it('should skip values containing unresolved @(...) references', () => {
        // When a property value itself contains @(prop), it's not fully resolved
        // and should be skipped - returns empty since no earlier resolved value exists
        const { slices } = cutByBraces('.box { border: @(color); outline: @(border); }');
        // Looking for 'border' - value is '@(color)' which is unresolved, returns empty
        const value = findPropertyValue('border', slices, 1);
        expect(value).toBe('');
      });

      it('should return empty when only value has unresolved reference', () => {
        // When the only matching property has an unresolved @(ref), return empty
        const { slices } = cutByBraces('.box { color: @(other); outline: @(color); }');
        const value = findPropertyValue('color', slices, 1);
        expect(value).toBe('');
      });
    });

    describe('CSS at-rule vs property disambiguation', () => {
      it('should NOT match @propName: (CSS at-rule)', () => {
        // border: 1px; @border { test: @(border); }
        // The @border: at the start should not be matched
        const { slices } = cutByBraces('border: 1px;\n@border { test: @(border); }');
        // slice 0 contains "border: 1px;\n@border "
        // slice 1 contains " test: @(border); "
        const value = findPropertyValue('border', slices, 1);
        // Should find "1px" from the property, not from @border (at-rule)
        expect(value).toBe('1px');
      });

      it('should match property after at-rule on same property name', () => {
        // Tricky case: @color defined as at-rule, color defined as property
        const css = '.test { color: blue; @color: green; background-color: @(color); }';
        const { slices } = cutByBraces(css);
        const value = findPropertyValue('color', slices, 1);
        expect(value).toBe('blue');
      });
    });

    describe('edge cases', () => {
      it('should handle property names with hyphens', () => {
        const { slices } = cutByBraces('.box { background-color: red; }');
        const value = findPropertyValue('background-color', slices, 1);
        expect(value).toBe('red');
      });

      it('should handle values with special characters', () => {
        const { slices } = cutByBraces('.box { content: "hello: world"; }');
        const value = findPropertyValue('content', slices, 1);
        expect(value).toBe('"hello: world"');
      });

      it('should handle values with url()', () => {
        const { slices } = cutByBraces('.box { background: url("image.png"); }');
        const value = findPropertyValue('background', slices, 1);
        expect(value).toBe('url("image.png")');
      });

      it('should handle values without semicolon at end of block', () => {
        const { slices } = cutByBraces('.box { color: blue }');
        const value = findPropertyValue('color', slices, 1);
        expect(value).toBe('blue');
      });

      it('should handle invalid slice index gracefully', () => {
        const { slices } = cutByBraces('.box { color: blue; }');
        expect(findPropertyValue('color', slices, -1)).toBe('');
        expect(findPropertyValue('color', slices, 100)).toBe('');
      });
    });

    describe('JS scope skipping (Story 3.3)', () => {
      it('should skip JS-type slices and find property in parent CSS scope', () => {
        // .box { color: blue; {{ @(color) }}; }
        // slice 0: ".box " (css, parent: null)
        // slice 1: " color: blue; " (css, parent: 0)
        // slice 2: " @(color) " (js, parent: 1)
        // slice 3: "; " (css, parent: 0)
        const { slices } = cutByBraces('.box { color: blue; {{ @(color) }}; }');
        // Looking for "color" from inside the JS expression (slice 2)
        // Should skip JS slice and find in parent CSS slice (slice 1)
        const value = findPropertyValue('color', slices, 2);
        expect(value).toBe('blue');
      });

      it('should find property through multiple JS scopes', () => {
        // Nested: CSS -> JS -> looking for property in CSS parent
        const { slices } = cutByBraces('.box { padding: 10px; margin: {{ calc(@(padding)) }}; }');
        // Find the JS slice index
        const jsSliceIndex = slices.findIndex(s => s.type === 'js');
        const value = findPropertyValue('padding', slices, jsSliceIndex);
        expect(value).toBe('10px');
      });
    });
  });

  describe('areSiblingTrees()', () => {
    it('should detect sibling trees at depth 0', () => {
      // .a { color: red; } .b { color: blue; }
      const { slices } = cutByBraces('.a { color: red; } .b { color: blue; }');
      // slices: [".a ", " color: red; ", " .b ", " color: blue; ", ""]
      // Slice 1 (.a's content) and slice 3 (.b's content) are siblings
      expect(areSiblingTrees(1, 3, slices)).toBe(true);
    });

    it('should NOT detect siblings within same tree', () => {
      // .parent { .child1 { } .child2 { } }
      const { slices } = cutByBraces('.parent { .child1 { color: red; } .child2 { color: blue; } }');
      // Both children are inside .parent, not siblings at top level
      // They share a common ancestor (slice 1, the .parent content)
      expect(areSiblingTrees(2, 4, slices)).toBe(false);
    });

    it('should handle adjacent indices', () => {
      const { slices } = cutByBraces('.a { } .b { }');
      // Adjacent slices - .a content (1) and .b content (3) are siblings
      expect(areSiblingTrees(1, 3, slices)).toBe(true);
    });

    it('should handle same index', () => {
      const { slices } = cutByBraces('.a { color: red; }');
      expect(areSiblingTrees(1, 1, slices)).toBe(false);
    });
  });

  describe('isInsideAtRule()', () => {
    it('should detect content inside @media', () => {
      const { slices } = cutByBraces('@media (min-width: 768px) { .box { color: red; } }');
      // slice 2 is inside .box which is inside @media
      expect(isInsideAtRule(slices, 2)).toBe(true);
    });

    it('should detect content inside @layer', () => {
      const { slices } = cutByBraces('@layer base { .box { color: red; } }');
      expect(isInsideAtRule(slices, 2)).toBe(true);
    });

    it('should detect content inside @supports', () => {
      const { slices } = cutByBraces('@supports (display: grid) { .box { color: red; } }');
      expect(isInsideAtRule(slices, 2)).toBe(true);
    });

    it('should detect content inside @container', () => {
      const { slices } = cutByBraces('@container (min-width: 300px) { .box { color: red; } }');
      expect(isInsideAtRule(slices, 2)).toBe(true);
    });

    it('should NOT detect regular rules as at-rules', () => {
      const { slices } = cutByBraces('.box { color: red; }');
      expect(isInsideAtRule(slices, 1)).toBe(false);
    });

    it('should NOT detect rules after at-rule block closes', () => {
      // After the @media block closes, .outside is not inside it
      const { slices } = cutByBraces('@media (min-width: 768px) { .inside { } } .outside { }');
      // Find the slice containing .outside's content
      const outsideIndex = slices.findIndex(s => s.content.includes('') && s.parent !== null && slices[s.parent]?.content.includes('.outside'));
      // Actually let's find it differently - .outside is at index 4 content-wise
      // slices: ["@media...", " .inside ", " ", " .outside ", " ", ""]
      expect(isInsideAtRule(slices, 4)).toBe(false);
    });

    it('should detect content inside @keyframes', () => {
      const { slices } = cutByBraces('@keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }');
      // slice 2 is inside "from" block which is inside @keyframes
      expect(isInsideAtRule(slices, 2)).toBe(true);
    });

    it('should detect content inside @font-face', () => {
      // @font-face doesn't have nested selectors, but content inside is still at-rule content
      const { slices } = cutByBraces('@font-face { font-family: "MyFont"; src: url("font.woff"); }');
      // slice 1 is inside @font-face
      expect(isInsideAtRule(slices, 1)).toBe(true);
    });

    it('should handle nested at-rules', () => {
      // @layer containing @media
      const { slices } = cutByBraces('@layer base { @media (min-width: 768px) { .box { color: red; } } }');
      // slice 3 is inside .box which is inside @media which is inside @layer
      expect(isInsideAtRule(slices, 3)).toBe(true);
    });

    it('should handle regular rule between at-rules', () => {
      // Regular rule sandwiched between at-rules
      const { slices } = cutByBraces('@media print { .a { } } .regular { color: blue; } @layer base { .b { } }');
      // Find the slice with "color: blue"
      const regularSliceIndex = slices.findIndex(s => s.content.includes('color: blue'));
      expect(isInsideAtRule(slices, regularSliceIndex)).toBe(false);
    });

    it('should handle at-rule at start when checking deep slice', () => {
      // Edge case: at-rule is the very first slice, checking a deep nested slice
      const { slices } = cutByBraces('@media screen { .a { .b { .c { color: red; } } } }');
      // slice 4 is deeply nested inside @media
      expect(isInsideAtRule(slices, 4)).toBe(true);
    });

    it('should return false when depth-0 slice between is not an at-rule', () => {
      // Edge case: regular selector, not at-rule
      const { slices } = cutByBraces('.regular { .nested { color: blue; } }');
      // slice 2 contains "color: blue;", we check if it's inside an at-rule
      expect(isInsideAtRule(slices, 2)).toBe(false);
    });

    it('should detect at-rule when first slice is at-rule and we reach it during walk-up', () => {
      // Edge case: the at-rule starts at the very first slice
      const { slices } = cutByBraces('@supports (display: flex) { .deep { .deeper { content: "test"; } } }');
      // slice 3 contains 'content: "test"', walking back should find @supports at slice 0
      expect(isInsideAtRule(slices, 3)).toBe(true);
    });
  });

  describe('integration: scope isolation scenarios', () => {
    it('should NOT find property in sibling selector tree', () => {
      // .sidebar { border: dotted; } .main { outline: @(border); }
      const { slices } = cutByBraces('.sidebar { border: dotted; } .main { outline: @(border); }');
      // slice 3 is .main's content, looking for "border" which is only in .sidebar (slice 1)
      // But .sidebar and .main are sibling trees - they don't share ancestry
      const value = findPropertyValue('border', slices, 3);
      expect(value).toBe('');
    });

    it('depth-based search stops at scope boundary', () => {
      // .outer { border: solid; } .other { .inner { outline: @(border); } }
      const { slices } = cutByBraces('.outer { border: solid; } .other { .inner { outline: @(border); } }');
      // .inner's parent chain: slice 4 -> slice 3 (.other content) -> no further (slice 2 is ".other" selector, parent null)
      // .outer is a sibling tree, not reachable via parent chain
      const value = findPropertyValue('border', slices, 4);
      expect(value).toBe('');
    });

    it('should find property when {{ }} expression is between declaration and @(prop) reference', () => {
      // Critical test: @(prop) resolution uses scope tracking
      // The {{ }} creates its own depth level but shouldn't block property lookup
      const css = `.test {
    color: blue;
    .css-child {
        background: green;
    }
    {{ "border: black;" }}
    outline: @(color);
}`;
      const { slices } = cutByBraces(css);
      
      // Find the slice containing @(color) reference
      const sliceWithRef = slices.findIndex(s => s.content.includes('@(color)'));
      expect(sliceWithRef).toBeGreaterThan(0);
      
      // Should find "blue" by walking up parent chain
      const value = findPropertyValue('color', slices, sliceWithRef);
      expect(value).toBe('blue');
    });

    it('should handle multiple {{ }} expressions in same block', () => {
      const css = `.test {
    border: 1px solid;
    {{ expr1 }}
    {{ expr2 }}
    outline: @(border);
}`;
      const { slices } = cutByBraces(css);
      const sliceWithRef = slices.findIndex(s => s.content.includes('@(border)'));
      const value = findPropertyValue('border', slices, sliceWithRef);
      expect(value).toBe('1px solid');
    });

    it('should find property after nested child block closes', () => {
      // Property declared, then nested child, then @(prop) reference
      const css = `.test {
    color: blue;
    .css-child {
        background: green;
    }
    outline: @(color);
}`;
      const { slices } = cutByBraces(css);
      const sliceWithRef = slices.findIndex(s => s.content.includes('@(color)'));
      const value = findPropertyValue('color', slices, sliceWithRef);
      expect(value).toBe('blue');
    });

    it('should find property with nested child AND {{ }} in same block', () => {
      // Combined case: nested CSS child + JS expression + @(prop) reference
      const css = `.test {
    color: blue;
    .css-child {
        background: green;
    }
    {{ "border: black;" }}
    outline: @(color);
}`;
      const { slices } = cutByBraces(css);
      const sliceWithRef = slices.findIndex(s => s.content.includes('@(color)'));
      const value = findPropertyValue('color', slices, sliceWithRef);
      expect(value).toBe('blue');
    });
  });
});
