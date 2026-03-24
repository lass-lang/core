/**
 * Scanner tests for zone detection (Story 2.1).
 *
 * Tests the findSeparator() method that detects the --- separator
 * and splits source into preamble (JS) and CSS zones.
 */

import { describe, it, expect } from 'vitest';
import { Scanner } from '../src/scanner.js';

describe('Scanner', () => {
  describe('scan()', () => {
    it('should return input unchanged (passthrough mode)', () => {
      const scanner = new Scanner('p { color: red; }');
      const result = scanner.scan();
      expect(result.css).toBe('p { color: red; }');
    });
  });

  describe('findSeparator()', () => {
    describe('basic zone detection', () => {
      it('should find --- delimiters and split zones', () => {
        const scanner = new Scanner('---\nconst x = 1\n---\np { color: red; }');
        const zones = scanner.findSeparator();

        expect(zones.hasSeparator).toBe(true);
        expect(zones.preamble).toBe('const x = 1');
        expect(zones.cssZone).toBe('p { color: red; }');
      });

      it('should treat entire file as CSS zone without ---', () => {
        const scanner = new Scanner('p { color: red; }');
        const zones = scanner.findSeparator();

        expect(zones.hasSeparator).toBe(false);
        expect(zones.preamble).toBe('');
        expect(zones.cssZone).toBe('p { color: red; }');
      });

      it('should handle empty preamble (opening and closing delimiters with nothing between)', () => {
        const scanner = new Scanner('---\n---\np { color: red; }');
        const zones = scanner.findSeparator();

        expect(zones.hasSeparator).toBe(true);
        expect(zones.preamble).toBe('');
        expect(zones.cssZone).toBe('p { color: red; }');
      });

      it('should handle empty CSS zone (opening delimiter, no closing)', () => {
        const scanner = new Scanner('---\nconst x = 1');
        const zones = scanner.findSeparator();

        expect(zones.hasSeparator).toBe(true);
        expect(zones.preamble).toBe('const x = 1');
        expect(zones.cssZone).toBe('');
      });

      it('should handle --- with trailing whitespace', () => {
        const scanner = new Scanner('---\nconst x = 1\n---   \np { color: red; }');
        const zones = scanner.findSeparator();

        expect(zones.hasSeparator).toBe(true);
        expect(zones.preamble).toBe('const x = 1');
        expect(zones.cssZone).toBe('p { color: red; }');
      });

      it('should handle Windows line endings (CRLF)', () => {
        const scanner = new Scanner('---\r\nconst x = 1\r\n---\r\np { color: red; }');
        const zones = scanner.findSeparator();

        expect(zones.hasSeparator).toBe(true);
        expect(zones.preamble).toBe('const x = 1');
        expect(zones.cssZone).toBe('p { color: red; }');
      });
    });

    describe('separator with comment (Story 8.1)', () => {
      it('should recognize --- with comment after space', () => {
        const scanner = new Scanner('---\nconst x = 1\n--- here starts CSS\np { color: red; }');
        const zones = scanner.findSeparator();

        expect(zones.hasSeparator).toBe(true);
        expect(zones.preamble).toBe('const x = 1');
        expect(zones.cssZone).toBe('p { color: red; }');
      });

      it('should recognize --- with comment and no preamble', () => {
        const scanner = new Scanner('--- just the reset\n---\np { color: red; }');
        const zones = scanner.findSeparator();

        expect(zones.hasSeparator).toBe(true);
        expect(zones.preamble).toBe('');
        expect(zones.cssZone).toBe('p { color: red; }');
      });

      it('should recognize --- with tab before comment', () => {
        const scanner = new Scanner('---\nconst x = 1\n---\tcomment\np { color: red; }');
        const zones = scanner.findSeparator();

        expect(zones.hasSeparator).toBe(true);
        expect(zones.preamble).toBe('const x = 1');
        expect(zones.cssZone).toBe('p { color: red; }');
      });

      it('should NOT recognize ---nospace as separator', () => {
        const scanner = new Scanner('---nospace\np { color: red; }');
        const zones = scanner.findSeparator();

        expect(zones.hasSeparator).toBe(false);
        expect(zones.cssZone).toBe('---nospace\np { color: red; }');
      });

      it('should NOT recognize ---word as separator (no space)', () => {
        const scanner = new Scanner('const x = 1\n---word\np { color: red; }');
        const zones = scanner.findSeparator();

        expect(zones.hasSeparator).toBe(false);
        expect(zones.cssZone).toBe('const x = 1\n---word\np { color: red; }');
      });

      it('should still recognize bare ---', () => {
        const scanner = new Scanner('---\nconst x = 1\n---\np { color: red; }');
        const zones = scanner.findSeparator();

        expect(zones.hasSeparator).toBe(true);
        expect(zones.preamble).toBe('const x = 1');
        expect(zones.cssZone).toBe('p { color: red; }');
      });

      it('should not include comment text in either zone', () => {
        const scanner = new Scanner('---\nconst x = 1\n--- this comment is discarded\np { color: red; }');
        const zones = scanner.findSeparator();

        expect(zones.preamble).not.toContain('this comment is discarded');
        expect(zones.cssZone).not.toContain('this comment is discarded');
      });

      it('should handle --- comment at EOF with no CSS below', () => {
        const scanner = new Scanner('---\nconst x = 1\n--- end of preamble');
        const zones = scanner.findSeparator();

        expect(zones.hasSeparator).toBe(true);
        expect(zones.preamble).toBe('const x = 1');
        expect(zones.cssZone).toBe('');
      });
    });

    describe('edge cases - non-separators', () => {
      it('should ignore --- with leading whitespace (not a separator)', () => {
        const scanner = new Scanner('  ---\np { color: red; }');
        const zones = scanner.findSeparator();

        expect(zones.hasSeparator).toBe(false);
        expect(zones.cssZone).toBe('  ---\np { color: red; }');
      });

      it('should ignore --- inside /* */ comment', () => {
        const scanner = new Scanner('/*\n---\n*/\np { color: red; }');
        const zones = scanner.findSeparator();

        expect(zones.hasSeparator).toBe(false);
        expect(zones.cssZone).toBe('/*\n---\n*/\np { color: red; }');
      });

      it('should ignore --- when not on its own line', () => {
        const scanner = new Scanner('const x = "---"\np { color: red; }');
        const zones = scanner.findSeparator();

        expect(zones.hasSeparator).toBe(false);
        expect(zones.cssZone).toBe('const x = "---"\np { color: red; }');
      });

      it('should find real --- after comment with ---', () => {
        const scanner = new Scanner('---\n/* comment with --- */\n---\np { color: red; }');
        const zones = scanner.findSeparator();

        expect(zones.hasSeparator).toBe(true);
        expect(zones.preamble).toBe('/* comment with --- */');
        expect(zones.cssZone).toBe('p { color: red; }');
      });
    });

    describe('multiple delimiters', () => {
      it('should use second --- as closing delimiter, extra --- in CSS zone', () => {
        const scanner = new Scanner('---\nconst a = 1\n---\np { color: red; }\n---\np { color: blue; }');
        const zones = scanner.findSeparator();

        expect(zones.hasSeparator).toBe(true);
        expect(zones.preamble).toBe('const a = 1');
        expect(zones.cssZone).toBe('p { color: red; }\n---\np { color: blue; }');
      });

      it('should use second --- as closing even with minimal content', () => {
        const scanner = new Scanner('---\na\n---\nb\n---\nc');
        const zones = scanner.findSeparator();

        expect(zones.hasSeparator).toBe(true);
        expect(zones.preamble).toBe('a');
        expect(zones.cssZone).toBe('b\n---\nc');
      });
    });

    describe('complex scenarios', () => {
      it('should handle multiline preamble with imports', () => {
        const scanner = new Scanner(
          "---\nimport tokens from './tokens.json'\n\nconst $primary = tokens.colors.primary\n---\n.button { background: $primary; }"
        );
        const zones = scanner.findSeparator();

        expect(zones.hasSeparator).toBe(true);
        expect(zones.preamble).toBe(
          "import tokens from './tokens.json'\n\nconst $primary = tokens.colors.primary"
        );
        expect(zones.cssZone).toBe('.button { background: $primary; }');
      });

      it('should handle multiline CSS with nested rules', () => {
        const scanner = new Scanner(
          '---\nconst $color = "blue"\n---\n.parent {\n  color: $color;\n  .child {\n    color: red;\n  }\n}'
        );
        const zones = scanner.findSeparator();

        expect(zones.hasSeparator).toBe(true);
        expect(zones.cssZone).toBe('.parent {\n  color: $color;\n  .child {\n    color: red;\n  }\n}');
      });

      it('should handle --- appearing in CSS string literal (after separator)', () => {
        const scanner = new Scanner(
          '---\nconst $label = "test"\n---\n.divider::after {\n  content: "---";\n  color: $label;\n}'
        );
        const zones = scanner.findSeparator();

        expect(zones.hasSeparator).toBe(true);
        expect(zones.cssZone).toBe('.divider::after {\n  content: "---";\n  color: $label;\n}');
      });
    });
  });

  describe('findExpressions()', () => {
    describe('basic expression detection', () => {
      it('should return single CSS chunk when no expressions', () => {
        const scanner = new Scanner('');
        const result = scanner.findExpressions('.box { color: red; }');

        expect(result.parts).toEqual(['.box { color: red; }']);
        expect(result.expressionPositions).toEqual([]);
      });

      it('should find single expression in value position', () => {
        const scanner = new Scanner('');
        const result = scanner.findExpressions('.box { color: {{ color }}; }');

        expect(result.parts).toEqual(['.box { color: ', 'color', '; }']);
        expect(result.expressionPositions).toEqual([14]);
      });

      it('should find expression in selector position', () => {
        const scanner = new Scanner('');
        const result = scanner.findExpressions('{{ tag }} { color: red; }');

        expect(result.parts).toEqual(['', 'tag', ' { color: red; }']);
        expect(result.expressionPositions).toEqual([0]);
      });

      it('should find multiple expressions', () => {
        const scanner = new Scanner('');
        const result = scanner.findExpressions('.box { margin: {{ top }}px {{ bottom }}px; }');

        expect(result.parts).toEqual(['.box { margin: ', 'top', 'px ', 'bottom', 'px; }']);
        expect(result.expressionPositions).toEqual([15, 27]);
      });

      it('should trim whitespace from expression content', () => {
        const scanner = new Scanner('');
        const result = scanner.findExpressions('.box { width: {{   x   }}px; }');

        expect(result.parts).toEqual(['.box { width: ', 'x', 'px; }']);
      });
    });

    describe('nested brace handling', () => {
      it('should handle object literal in expression', () => {
        const scanner = new Scanner('');
        const result = scanner.findExpressions('.box { width: {{ fn({ x: 1 }) }}; }');

        expect(result.parts).toEqual(['.box { width: ', 'fn({ x: 1 })', '; }']);
      });

      it('should handle nested object literal with multiple properties', () => {
        const scanner = new Scanner('');
        const result = scanner.findExpressions('{{ getStyle({ width: 100, height: 200 }) }}');

        expect(result.parts).toEqual(['', 'getStyle({ width: 100, height: 200 })', '']);
      });

      it('should handle arrow function in expression', () => {
        const scanner = new Scanner('');
        const result = scanner.findExpressions('{{ arr.map(x => x * 2).join(",") }}');

        expect(result.parts).toEqual(['', 'arr.map(x => x * 2).join(",")', '']);
      });
    });

    describe('multiline expressions', () => {
      it('should handle expression spanning multiple lines', () => {
        const scanner = new Scanner('');
        const result = scanner.findExpressions(`:root {
  {{
    items
      .map(i => '--item: ' + i + ';')
      .join('\\n  ')
  }}
}`);

        expect(result.parts.length).toBe(3);
        expect(result.parts[0]).toBe(':root {\n  ');
        expect(result.parts[1]).toContain('items');
        expect(result.parts[2]).toBe('\n}');
      });
    });

    describe('error handling', () => {
      it('should throw for empty expression', () => {
        const scanner = new Scanner('');

        expect(() => scanner.findExpressions('.box { color: {{ }}; }')).toThrow(
          'Empty {{ }} expression'
        );
      });

      it('should throw for whitespace-only expression', () => {
        const scanner = new Scanner('');

        expect(() => scanner.findExpressions('.box { color: {{   }}; }')).toThrow(
          'Empty {{ }} expression'
        );
      });

      it('should throw for unclosed expression', () => {
        const scanner = new Scanner('');

        expect(() => scanner.findExpressions('.box { color: {{ color; }')).toThrow(
          'Unclosed {{ expression'
        );
      });

      it('should throw for unclosed expression with nested brace', () => {
        const scanner = new Scanner('');

        expect(() => scanner.findExpressions('.box { color: {{ fn({ x: 1 }); }')).toThrow(
          'Unclosed {{ expression'
        );
      });
    });

    describe('universal {{ }} detection (Story 2.5)', () => {
      // Story 2.5: {{ }} is processed EVERYWHERE in CSS zone - strings, url(), comments
      // This enables dynamic content in all contexts

      it('should detect {{ }} inside double-quoted strings', () => {
        const scanner = new Scanner('');
        const result = scanner.findExpressions('.box { content: "Hello {{ name }}!"; }');

        // Expression IS detected inside strings for dynamic content
        expect(result.parts).toEqual(['.box { content: "Hello ', 'name', '!"; }']);
        expect(result.expressionPositions).toEqual([23]);
      });

      it('should detect {{ }} inside single-quoted strings', () => {
        const scanner = new Scanner('');
        const result = scanner.findExpressions(".box { content: '{{ label }}'; }");

        // Expression IS detected inside single-quoted strings
        expect(result.parts).toEqual([".box { content: '", 'label', "'; }"]);
        expect(result.expressionPositions).toEqual([17]);
      });

      it('should detect {{ }} inside url()', () => {
        const scanner = new Scanner('');
        const result = scanner.findExpressions('.bg { background: url(path/{{ imgPath }}/img.png); }');

        // Expression IS detected inside url() for dynamic paths
        expect(result.parts).toEqual(['.bg { background: url(path/', 'imgPath', '/img.png); }']);
        expect(result.expressionPositions).toEqual([27]);
      });

      it('should detect {{ }} inside block comments', () => {
        const scanner = new Scanner('');
        const result = scanner.findExpressions('.box { /* Version: {{ version }} */ color: red; }');

        // Expression IS detected inside comments for dynamic metadata
        expect(result.parts).toEqual(['.box { /* Version: ', 'version', ' */ color: red; }']);
        expect(result.expressionPositions).toEqual([19]);
      });

      it('should detect {{ }} inside quoted url()', () => {
        const scanner = new Scanner('');
        const result = scanner.findExpressions('.bg { background: url("{{ path }}.jpg"); }');

        // Expression IS detected inside quoted url content
        expect(result.parts).toEqual(['.bg { background: url("', 'path', '.jpg"); }']);
        expect(result.expressionPositions).toEqual([23]);
      });

      it('should detect multiple {{ }} in url and value', () => {
        const scanner = new Scanner('');
        const result = scanner.findExpressions('.box { background: url({{ path }}); color: {{ x }}; }');

        // Both expressions detected
        expect(result.parts.length).toBe(5);
        expect(result.parts[0]).toBe('.box { background: url(');
        expect(result.parts[1]).toBe('path');
        expect(result.parts[2]).toBe('); color: ');
        expect(result.parts[3]).toBe('x');
        expect(result.parts[4]).toBe('; }');
      });

      it('should detect {{ }} with escape sequences in strings', () => {
        const scanner = new Scanner('');
        const result = scanner.findExpressions('.box { content: "quote: \\"{{ name }}\\""  ; }');

        // Expression IS detected - escape sequences are just characters in CSS zone
        expect(result.parts).toEqual(['.box { content: "quote: \\"', 'name', '\\""  ; }']);
      });

      it('should detect {{ }} in unclosed comment', () => {
        const scanner = new Scanner('');
        const result = scanner.findExpressions('.box { color: red; } /* unclosed {{ version }}');

        // Expression IS detected - no context-skip means we process it
        expect(result.parts).toEqual(['.box { color: red; } /* unclosed ', 'version', '']);
      });

      it('should detect {{ }} after string ends', () => {
        const scanner = new Scanner('');
        const result = scanner.findExpressions('.box { content: "text"; color: {{ x }}; }');

        // Detect {{ x }} after the string
        expect(result.parts.length).toBe(3);
        expect(result.parts[0]).toBe('.box { content: "text"; color: ');
        expect(result.parts[1]).toBe('x');
        expect(result.parts[2]).toBe('; }');
      });

      it('should detect {{ }} in unclosed string', () => {
        const scanner = new Scanner('');
        const result = scanner.findExpressions('.box { content: "unclosed string {{ value }}');

        // Expression IS detected - universal processing
        expect(result.parts).toEqual(['.box { content: "unclosed string ', 'value', '']);
      });
    });
  });
});
