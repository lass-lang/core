/**
 * Tests for // single-line comment stripping.
 *
 * Story 4.4: Single-Line Comment Stripping
 *
 * Test coverage:
 * - Basic comment stripping (full line and inline)
 * - Block comments preserved
 * - Protected contexts (strings, url(), block comments)
 * - Unclosed block comment error detection
 * - Integration with transpiler pipeline
 */

import { describe, it, expect } from 'vitest';
import { Scanner, transpile, LassTranspileError } from '../src/index.js';

describe('Story 4.4: Single-Line Comment Stripping', () => {
  describe('Scanner.stripLineCommentsStatic', () => {
    describe('Basic comment stripping (AC1)', () => {
      it('strips comment text, preserves newline', () => {
        const input = '// this is a comment\np { color: red; }';
        const result = Scanner.stripLineCommentsStatic(input);
        // Comment stripped, newline preserved
        expect(result).toBe('\np { color: red; }');
      });

      it('strips comment at start of file', () => {
        const input = '// first line\np { }';
        const result = Scanner.stripLineCommentsStatic(input);
        expect(result).toBe('\np { }');
      });

      it('strips comment at end of file (no trailing newline)', () => {
        const input = 'p { }\n// end comment';
        const result = Scanner.stripLineCommentsStatic(input);
        // The newline is preserved, comment stripped
        expect(result).toBe('p { }\n');
      });

      it('strips multiple consecutive comment lines', () => {
        const input = '// comment 1\n// comment 2\n// comment 3\np { }';
        const result = Scanner.stripLineCommentsStatic(input);
        // Each newline preserved
        expect(result).toBe('\n\n\np { }');
      });

      it('preserves empty lines', () => {
        const input = '// comment\n\np { }';
        const result = Scanner.stripLineCommentsStatic(input);
        expect(result).toBe('\n\np { }');
      });

      it('handles empty input', () => {
        expect(Scanner.stripLineCommentsStatic('')).toBe('');
      });

      it('returns input unchanged when no comments', () => {
        const input = 'p { color: red; }';
        const result = Scanner.stripLineCommentsStatic(input);
        expect(result).toBe(input);
      });
    });

    describe('Inline comment stripping (AC2)', () => {
      it('strips inline comment, preserves content and newline', () => {
        const input = 'p { color: red; // inline comment\n}';
        const result = Scanner.stripLineCommentsStatic(input);
        // Trailing space before // preserved, newline preserved
        expect(result).toBe('p { color: red; \n}');
      });

      it('strips inline comment with no space before //', () => {
        const input = 'p { color: red;// no space\n}';
        const result = Scanner.stripLineCommentsStatic(input);
        expect(result).toBe('p { color: red;\n}');
      });

      it('preserves content and whitespace before inline comment', () => {
        const input = '.box { border: 1px solid; // border style\n  padding: 8px; }';
        const result = Scanner.stripLineCommentsStatic(input);
        // Trailing space before // preserved, newline preserved
        expect(result).toBe('.box { border: 1px solid; \n  padding: 8px; }');
      });

      it('handles inline comment at end of file', () => {
        const input = 'p { color: red; } // final comment';
        const result = Scanner.stripLineCommentsStatic(input);
        // No newline at EOF, trailing space preserved
        expect(result).toBe('p { color: red; } ');
      });
    });

    describe('/* */ comments preserved (AC3)', () => {
      it('preserves block comment', () => {
        const input = '/* preserved */\np { color: red; }';
        const result = Scanner.stripLineCommentsStatic(input);
        expect(result).toBe(input);
      });

      it('preserves inline block comment', () => {
        const input = 'p { color: red; /* also preserved */ }';
        const result = Scanner.stripLineCommentsStatic(input);
        expect(result).toBe(input);
      });

      it('preserves multi-line block comment', () => {
        const input = '/*\n * Multi-line\n * comment\n */\np { }';
        const result = Scanner.stripLineCommentsStatic(input);
        expect(result).toBe(input);
      });
    });

    describe('Both comment styles together (AC4)', () => {
      it('strips // but preserves /* */', () => {
        const input = '// this disappears\n/* this stays */\np { color: red; }';
        const result = Scanner.stripLineCommentsStatic(input);
        // Comment stripped, newline preserved
        expect(result).toBe('\n/* this stays */\np { color: red; }');
      });

      it('handles mixed comments in same rule', () => {
        const input = 'p {\n  // gone\n  color: red; /* stays */\n  background: blue; // also gone\n}';
        const result = Scanner.stripLineCommentsStatic(input);
        // "  // gone" -> "  " + newline preserved
        // "background: blue; // also gone" -> "background: blue; " + newline preserved
        expect(result).toBe('p {\n  \n  color: red; /* stays */\n  background: blue; \n}');
      });

      it('handles /* */ before //', () => {
        const input = '/* kept */ // stripped\np { }';
        const result = Scanner.stripLineCommentsStatic(input);
        // Inline comment stripped, space before // preserved, newline preserved
        expect(result).toBe('/* kept */ \np { }');
      });
    });

    describe('Protected contexts (AC5)', () => {
      describe('// inside strings is not a comment', () => {
        it('preserves // in double-quoted string', () => {
          const input = 'a { content: "https://example.com"; }';
          const result = Scanner.stripLineCommentsStatic(input);
          expect(result).toBe(input);
        });

        it('preserves // in single-quoted string', () => {
          const input = "a { content: 'https://example.com'; }";
          const result = Scanner.stripLineCommentsStatic(input);
          expect(result).toBe(input);
        });

        it('handles escaped quotes in string', () => {
          const input = 'a { content: "say \\"hello\\" // not a comment"; }';
          const result = Scanner.stripLineCommentsStatic(input);
          expect(result).toBe(input);
        });
      });

      describe('// inside url() is not a comment', () => {
        it('preserves // in unquoted url()', () => {
          const input = '.bg { background: url(https://example.com/image.png); }';
          const result = Scanner.stripLineCommentsStatic(input);
          expect(result).toBe(input);
        });

        it('preserves // in quoted url()', () => {
          const input = '.bg { background: url("https://example.com/image.png"); }';
          const result = Scanner.stripLineCommentsStatic(input);
          expect(result).toBe(input);
        });

        it('handles URL with path containing //', () => {
          const input = '.bg { background: url(//cdn.example.com/img.png); }';
          const result = Scanner.stripLineCommentsStatic(input);
          expect(result).toBe(input);
        });

        it('handles nested parentheses in url()', () => {
          const input = '.bg { background: url(data:image/svg+xml,(foo)); }';
          const result = Scanner.stripLineCommentsStatic(input);
          expect(result).toBe(input);
        });
      });

      describe('// inside /* */ is not a comment', () => {
        it('preserves // inside block comment', () => {
          const input = '/* This contains // but is all one comment */\np { }';
          const result = Scanner.stripLineCommentsStatic(input);
          expect(result).toBe(input);
        });

        it('preserves // in multi-line block comment', () => {
          const input = '/*\n * See https://example.com\n */\np { }';
          const result = Scanner.stripLineCommentsStatic(input);
          expect(result).toBe(input);
        });
      });

      describe('URL inside comment is stripped', () => {
        it('strips entire comment including URL', () => {
          const input = 'p { color: blue; // according to http://example.com\n}';
          const result = Scanner.stripLineCommentsStatic(input);
          // Inline comment stripped, space before // preserved, newline preserved
          expect(result).toBe('p { color: blue; \n}');
        });

        it('does not detect url() inside // comment', () => {
          const input = '// see url(https://example.com)\np { }';
          const result = Scanner.stripLineCommentsStatic(input);
          // Comment stripped, newline preserved
          expect(result).toBe('\np { }');
        });
      });
    });

    describe('Edge cases', () => {
      it('handles /// triple slash', () => {
        const input = '/// triple slash comment\np { }';
        const result = Scanner.stripLineCommentsStatic(input);
        // Comment stripped, newline preserved
        expect(result).toBe('\np { }');
      });

      it('does not treat / / (with space) as comment', () => {
        const input = 'p { margin: 10px / 2; }';
        const result = Scanner.stripLineCommentsStatic(input);
        expect(result).toBe(input);
      });

      it('handles comment-only file', () => {
        const input = '// nothing but a comment';
        const result = Scanner.stripLineCommentsStatic(input);
        expect(result).toBe('');
      });

      it('handles multiple comment-only lines', () => {
        const input = '// line 1\n// line 2\n// line 3';
        const result = Scanner.stripLineCommentsStatic(input);
        // Comments stripped, newlines preserved (last line has no newline)
        expect(result).toBe('\n\n');
      });

      it('handles // inside {{ }} (should be stripped)', () => {
        const input = 'p { color: {{ x // comment\n }}; }';
        const result = Scanner.stripLineCommentsStatic(input);
        // Inline comment inside {{ }} stripped, space before // preserved, newline preserved
        expect(result).toBe('p { color: {{ x \n }}; }');
      });
    });

    describe('Unclosed block comment error (AC8)', () => {
      it('throws error for unclosed /* comment', () => {
        const input = 'p { color: red; }\n/* this never closes';
        expect(() => Scanner.stripLineCommentsStatic(input)).toThrow(LassTranspileError);
      });

      it('error includes line number of /* start', () => {
        const input = 'p { }\n/* unclosed';
        try {
          Scanner.stripLineCommentsStatic(input);
          expect.fail('Should have thrown');
        } catch (e) {
          expect(e).toBeInstanceOf(LassTranspileError);
          const error = e as LassTranspileError;
          expect(error.location.line).toBe(2);
          expect(error.message).toContain('Unclosed /* comment');
        }
      });

      it('error includes correct line for multi-line unclosed comment', () => {
        const input = 'p { }\n\n\n/* starts here\nand continues';
        try {
          Scanner.stripLineCommentsStatic(input);
          expect.fail('Should have thrown');
        } catch (e) {
          expect(e).toBeInstanceOf(LassTranspileError);
          const error = e as LassTranspileError;
          expect(error.location.line).toBe(4);
        }
      });
    });
  });

  describe('Transpiler integration (AC9)', () => {
    it('strips // comments from CSS zone', () => {
      const input = `---
// this comment is stripped
p {
  color: red; // inline stripped
}`;
      const result = transpile(input);
      expect(result.code).not.toContain('// this comment');
      expect(result.code).not.toContain('// inline stripped');
      expect(result.code).toContain('color: red;');
    });

    it('preserves // in preamble (JS zone)', () => {
      const input = `// This is a JS comment
const $x = 1; // inline JS comment
---
p { color: red; }`;
      const result = transpile(input);
      // Preamble is included as-is (it's JS, not CSS)
      expect(result.code).toContain('// This is a JS comment');
      expect(result.code).toContain('// inline JS comment');
    });

    it('works with pure CSS file (no separator)', () => {
      const input = `// comment in pure CSS
p { color: red; }`;
      const result = transpile(input);
      expect(result.code).not.toContain('// comment');
      expect(result.code).toContain('color: red;');
    });

    it('strips // before processing @(prop)', () => {
      const input = `---
.box {
  border: 1px solid;
  // border-left: @(border); -- commented out
  padding: 8px;
}`;
      const result = transpile(input);
      expect(result.code).not.toContain('// border-left');
      expect(result.code).not.toContain('@(border)');
    });

    it('strips // before processing $param', () => {
      const input = `const $color = 'red';
---
p {
  // color: $color; -- commented out
  background: blue;
}`;
      const result = transpile(input);
      expect(result.code).not.toContain('// color');
      expect(result.code).toContain('background: blue');
    });

    it('preserves /* */ in transpiled output', () => {
      const input = `---
/* preserved comment */
p { color: red; }`;
      const result = transpile(input);
      expect(result.code).toContain('/* preserved comment */');
    });

    it('handles empty CSS zone after stripping', () => {
      const input = `---
// only comments
// nothing else`;
      const result = transpile(input);
      expect(result.code).toContain('export default `');
      // Should produce empty template body
    });

    it('throws error for unclosed /* */ in transpile', () => {
      const input = `---
p { color: red; }
/* unclosed comment`;
      expect(() => transpile(input)).toThrow(LassTranspileError);
    });
  });

  describe('Scanner instance method', () => {
    it('stripLineComments() calls static method', () => {
      const scanner = new Scanner('// comment\np { }');
      const result = scanner.stripLineComments('// test\na { }');
      // Comment stripped, newline preserved
      expect(result).toBe('\na { }');
    });
  });
});
