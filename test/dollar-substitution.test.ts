/**
 * Dollar substitution tests for Story 4.1.
 *
 * Tests the findDollarVariables() method that detects $param patterns
 * in CSS zone and the transpiler integration for $param substitution.
 */

import { describe, it, expect } from 'vitest';
import { Scanner } from '../src/scanner.js';
import { transpile } from '../src/index.js';

describe('Scanner.findDollarVariables()', () => {
  describe('basic $param detection (AC1)', () => {
    it('should detect $param followed by semicolon', () => {
      const result = Scanner.findDollarVariablesStatic('color: $primary;');

      expect(result).toEqual([
        { varName: '$primary', startIndex: 7, endIndex: 15 },
      ]);
    });

    it('should detect $param followed by space', () => {
      const result = Scanner.findDollarVariablesStatic('padding: $gap 0;');

      expect(result).toEqual([
        { varName: '$gap', startIndex: 9, endIndex: 13 },
      ]);
    });

    it('should detect $param in selector position', () => {
      const result = Scanner.findDollarVariablesStatic('.$component { display: block; }');

      expect(result).toEqual([
        { varName: '$component', startIndex: 1, endIndex: 11 },
      ]);
    });

    it('should detect $param with hyphen as boundary', () => {
      const result = Scanner.findDollarVariablesStatic('.$prefix-header { display: flex; }');

      // $prefix stops at hyphen - hyphen is NOT part of JS identifier
      expect(result).toEqual([
        { varName: '$prefix', startIndex: 1, endIndex: 8 },
      ]);
    });

    it('should detect multiple $param in one declaration', () => {
      const result = Scanner.findDollarVariablesStatic('margin: $top $right $bottom $left;');

      expect(result).toEqual([
        { varName: '$top', startIndex: 8, endIndex: 12 },
        { varName: '$right', startIndex: 13, endIndex: 19 },
        { varName: '$bottom', startIndex: 20, endIndex: 27 },
        { varName: '$left', startIndex: 28, endIndex: 33 },
      ]);
    });

    it('should detect $param with underscore in name', () => {
      const result = Scanner.findDollarVariablesStatic('color: $primary_color;');

      expect(result).toEqual([
        { varName: '$primary_color', startIndex: 7, endIndex: 21 },
      ]);
    });

    it('should detect $param with digits in name', () => {
      const result = Scanner.findDollarVariablesStatic('color: $color1;');

      expect(result).toEqual([
        { varName: '$color1', startIndex: 7, endIndex: 14 },
      ]);
    });

    it('should detect $$param (variable named $param)', () => {
      const result = Scanner.findDollarVariablesStatic('color: $$var;');

      expect(result).toEqual([
        { varName: '$$var', startIndex: 7, endIndex: 12 },
      ]);
    });

    it('should detect adjacent $param$param as single identifier', () => {
      // In JavaScript, $ is a valid identifier character, so $a$b is a single identifier
      // This is correct behavior - $a$b looks up a variable named $a$b
      const result = Scanner.findDollarVariablesStatic('prefix$a$bsuffix');

      // $a$bsuffix is a single valid JS identifier
      expect(result).toEqual([
        { varName: '$a$bsuffix', startIndex: 6, endIndex: 16 },
      ]);
    });

    it('should detect $param separated by non-identifier chars', () => {
      // When separated by hyphen, space, etc., they are distinct variables
      const result = Scanner.findDollarVariablesStatic('margin: $a-$b;');

      expect(result).toEqual([
        { varName: '$a', startIndex: 8, endIndex: 10 },
        { varName: '$b', startIndex: 11, endIndex: 13 },
      ]);
    });
  });

  describe('bare $ handling (AC7)', () => {
    it('should ignore bare $ at end of content', () => {
      const result = Scanner.findDollarVariablesStatic('content: $');

      expect(result).toEqual([]);
    });

    it('should ignore $ followed by space', () => {
      const result = Scanner.findDollarVariablesStatic('content: $ test');

      expect(result).toEqual([]);
    });

    it('should ignore $ followed by digit', () => {
      const result = Scanner.findDollarVariablesStatic('content: $50');

      expect(result).toEqual([]);
    });

    it('should ignore $ followed by special character', () => {
      const result = Scanner.findDollarVariablesStatic('content: $;');

      expect(result).toEqual([]);
    });
  });

  describe('protected context skipping (AC2)', () => {
    it('should skip $param inside double-quoted string', () => {
      const result = Scanner.findDollarVariablesStatic('content: "the value is $color";');

      expect(result).toEqual([]);
    });

    it('should skip $param inside single-quoted string', () => {
      const result = Scanner.findDollarVariablesStatic("content: 'the value is $color';");

      expect(result).toEqual([]);
    });

    it('should detect $param inside url() - url is NOT protected', () => {
      // url() is NOT a protected context - $param IS substituted
      const result = Scanner.findDollarVariablesStatic('background: url(/$path/hero.png);');

      expect(result).toEqual([
        { varName: '$path', startIndex: 17, endIndex: 22 },
      ]);
    });

    it('should skip $param inside url() with quotes - string IS protected', () => {
      // The string inside url() is protected, not url() itself
      const result = Scanner.findDollarVariablesStatic('background: url("/$path/hero.png");');

      expect(result).toEqual([]);
    });

    it('should skip $param inside block comment', () => {
      const result = Scanner.findDollarVariablesStatic('/* $param is documented */ color: red;');

      expect(result).toEqual([]);
    });

    it('should detect $param after string ends', () => {
      const result = Scanner.findDollarVariablesStatic('content: "text"; color: $primary;');

      expect(result).toEqual([
        { varName: '$primary', startIndex: 24, endIndex: 32 },
      ]);
    });

    it('should handle escaped quotes in strings', () => {
      const result = Scanner.findDollarVariablesStatic('content: "He said \\"$name\\""; color: $x;');

      // $name is inside the string (escaped quotes don't end it)
      // $x is outside and should be detected
      expect(result).toEqual([
        { varName: '$x', startIndex: 37, endIndex: 39 },
      ]);
    });

    it('should detect $param inside url() without quotes', () => {
      const result = Scanner.findDollarVariablesStatic('background: url($path/img.png); color: $primary;');

      expect(result).toEqual([
        { varName: '$path', startIndex: 16, endIndex: 21 },
        { varName: '$primary', startIndex: 39, endIndex: 47 },
      ]);
    });

    it('should detect $param after block comment ends', () => {
      const result = Scanner.findDollarVariablesStatic('/* comment */ color: $primary;');

      expect(result).toEqual([
        { varName: '$primary', startIndex: 21, endIndex: 29 },
      ]);
    });

    it('should handle url() with quoted string - string protection applies', () => {
      // url("...") - the STRING is protected, not url()
      const result = Scanner.findDollarVariablesStatic('background: url("/$path/$name.png"); color: $x;');

      // $path and $name inside quoted string, $x outside
      expect(result).toEqual([
        { varName: '$x', startIndex: 44, endIndex: 46 },
      ]);
    });
  });

  describe('return empty array for no matches', () => {
    it('should return empty array for empty string', () => {
      const result = Scanner.findDollarVariablesStatic('');

      expect(result).toEqual([]);
    });

    it('should return empty array for CSS with no $', () => {
      const result = Scanner.findDollarVariablesStatic('.box { color: red; }');

      expect(result).toEqual([]);
    });
  });

  describe('instance method delegates to static', () => {
    it('should work via instance method', () => {
      const scanner = new Scanner('');
      const result = scanner.findDollarVariables('color: $primary;');

      expect(result).toEqual([
        { varName: '$primary', startIndex: 7, endIndex: 15 },
      ]);
    });
  });
});

describe('transpile() with $param substitution', () => {
  /**
   * Helper to execute transpiled code and get CSS output.
   * The transpiled code is a JS module with preamble + export default.
   * We convert it to a function that executes preamble and returns the template.
   */
  function executeTranspiled(code: string): string {
    // Find the export default statement
    const exportMatch = code.match(/export default `([\s\S]*)`;\s*$/);
    if (!exportMatch) {
      throw new Error('Could not find export default in transpiled code');
    }

    // Get preamble (everything before export default)
    const exportStart = code.lastIndexOf('export default `');
    const preamble = code.slice(0, exportStart).trim();
    
    // Build a function that executes preamble and returns the template literal
    // We need to wrap the template in a return statement and execute the preamble first
    const templateContent = exportMatch[1];
    const wrappedCode = `${preamble}\nreturn \`${templateContent}\`;`;
    
    const fn = new Function(wrappedCode);
    return fn();
  }

  describe('basic substitution (AC3, AC4)', () => {
    it('should substitute $param in CSS value', () => {
      const source = `---
const $color = 'red'
---
p {
  color: $color;
}`;
      const result = transpile(source);

      // The transpiled code should contain __lassScriptLookup call
      expect(result.code).toContain('__lassScriptLookup');
      expect(result.code).toContain("'color'");
      expect(result.code).toContain('$color');

      // Execute and verify output
      const css = executeTranspiled(result.code);
      expect(css).toBe(`p {
  color: red;
}`);
    });

    it('should substitute multiple $params', () => {
      const source = `---
const $primary = '#3b82f6'
const $radius = '8px'
---
.button {
  background: $primary;
  border-radius: $radius;
}`;
      const result = transpile(source);

      expect(result.code).toContain("'primary'");
      expect(result.code).toContain("'radius'");

      const css = executeTranspiled(result.code);
      expect(css).toBe(`.button {
  background: #3b82f6;
  border-radius: 8px;
}`);
    });

    it('should perform text-only substitution (no evaluation)', () => {
      const source = `---
const $gap = 23
---
.box {
  padding: $gap * 2;
}`;
      const result = transpile(source);

      const css = executeTranspiled(result.code);
      // Should output "23 * 2" not "46" - no evaluation
      expect(css).toBe(`.box {
  padding: 23 * 2;
}`);
    });

    it('should work inside calc() for valid CSS', () => {
      const source = `---
const $gap = 23
---
.box {
  padding: calc($gap * 2);
}`;
      const result = transpile(source);

      const css = executeTranspiled(result.code);
      expect(css).toBe(`.box {
  padding: calc(23 * 2);
}`);
    });

    it('should substitute numeric values', () => {
      const source = `---
const $cols = 12
---
.grid {
  grid-template-columns: repeat($cols, 1fr);
}`;
      const result = transpile(source);

      const css = executeTranspiled(result.code);
      expect(css).toBe(`.grid {
  grid-template-columns: repeat(12, 1fr);
}`);
    });
  });

  describe('selector position (AC5)', () => {
    it('should substitute $param in selector', () => {
      const source = `---
const $component = 'card'
---
.$component {
  display: block;
}`;
      const result = transpile(source);

      const css = executeTranspiled(result.code);
      expect(css).toBe(`.card {
  display: block;
}`);
    });

    it('should handle hyphen as identifier boundary', () => {
      const source = `---
const $prefix = 'app'
---
.$prefix-header {
  display: flex;
}`;
      const result = transpile(source);

      const css = executeTranspiled(result.code);
      expect(css).toBe(`.app-header {
  display: flex;
}`);
    });
  });

  describe('protected contexts (AC2)', () => {
    it('should NOT substitute $param inside double-quoted string', () => {
      const source = `---
const $color = 'red'
---
.quote {
  content: "the value is $color";
}`;
      const result = transpile(source);

      const css = executeTranspiled(result.code);
      expect(css).toBe(`.quote {
  content: "the value is $color";
}`);
    });

    it('should substitute $param inside url() - url is NOT protected', () => {
      const source = `---
const $path = 'images'
---
.bg {
  background: url(/$path/hero.png);
}`;
      const result = transpile(source);

      const css = executeTranspiled(result.code);
      // url() is NOT protected - $path IS substituted
      expect(css).toBe(`.bg {
  background: url(/images/hero.png);
}`);
    });

    it('should NOT substitute $param inside url() with quoted string', () => {
      const source = `---
const $path = 'images'
---
.bg {
  background: url("/$path/hero.png");
}`;
      const result = transpile(source);

      const css = executeTranspiled(result.code);
      // The string inside url() IS protected
      expect(css).toBe(`.bg {
  background: url("/$path/hero.png");
}`);
    });

    it('should NOT substitute $param inside block comment', () => {
      const source = `---
const $var = 'test'
---
/* $var is documented */
p { color: red; }`;
      const result = transpile(source);

      const css = executeTranspiled(result.code);
      expect(css).toBe(`/* $var is documented */
p { color: red; }`);
    });
  });

  describe('$-prefixed visibility (AC3)', () => {
    it('should only see $-prefixed variables', () => {
      // Note: url() without quotes is NOT protected - $urlHeader IS substituted
      const source = `---
const headerImages = ['ici']
const $urlHeader = headerImages[0]
---
.h {
  content: "headers[0]";
  background: url($urlHeader);
}`;
      const result = transpile(source);

      const css = executeTranspiled(result.code);
      expect(css).toBe(`.h {
  content: "headers[0]";
  background: url(ici);
}`);
    });
  });

  describe('value coercion (AC4)', () => {
    it('should coerce object to [object Object]', () => {
      // $obj outside string is substituted, inside string is literal
      const source = `---
const $obj = { a: 1 }
---
p {
  --data: $obj;
}`;
      const result = transpile(source);

      const css = executeTranspiled(result.code);
      expect(css).toBe(`p {
  --data: [object Object];
}`);
    });

    it('should preserve $x for undefined value', () => {
      // undefined value → preserve $name unchanged
      const source = `---
const $x = undefined
---
p {
  --data: $x;
}`;
      const result = transpile(source);

      const css = executeTranspiled(result.code);
      expect(css).toBe(`p {
  --data: $x;
}`);
    });

    it('should output unset for null value', () => {
      // null value → 'unset'
      const source = `---
const $x = null
---
p {
  border: $x;
}`;
      const result = transpile(source);

      const css = executeTranspiled(result.code);
      expect(css).toBe(`p {
  border: unset;
}`);
    });

    it('should preserve $missing for non-existent variable', () => {
      // Non-existent variable → preserve $name unchanged
      const source = `p {
  border: $missing;
}`;
      const result = transpile(source);

      const css = executeTranspiled(result.code);
      expect(css).toBe(`p {
  border: $missing;
}`);
    });
  });

  describe('bare $ handling (AC7)', () => {
    it('should preserve bare $ as literal text', () => {
      const source = `p {
  content: "costs $";
}
.price::after {
  content: "$";
}`;
      const result = transpile(source);

      const css = executeTranspiled(result.code);
      expect(css).toBe(`p {
  content: "costs $";
}
.price::after {
  content: "$";
}`);
    });
  });

  describe('transpiled output format (AC6)', () => {
    it('should convert $param to __lassScriptLookup call in template literal', () => {
      const source = `---
const $color = 'red'
---
p { color: $color; }`;
      const result = transpile(source);

      // Should contain __lassScriptLookup helper
      expect(result.code).toContain('const __lassScriptLookup');
      // Should contain the call with name and getter
      expect(result.code).toContain("__lassScriptLookup('color', () => $color)");
      // Should be valid JS
      expect(result.code).toContain('export default `');
    });

    it('should include __lassScriptLookup helper only when needed', () => {
      const sourceWithDollar = `---\nconst $x = 1\n---\np { width: $x; }`;
      const sourceWithoutDollar = `---\np { width: 100px; }`;

      const resultWith = transpile(sourceWithDollar);
      const resultWithout = transpile(sourceWithoutDollar);

      expect(resultWith.code).toContain('__lassScriptLookup');
      expect(resultWithout.code).not.toContain('__lassScriptLookup');
    });
  });

  describe('ordering: $param before {{ }}', () => {
    it('should process $param before {{ }} expressions', () => {
      const source = `---
const $x = 10
const y = 5
---
.box {
  width: $x;
  height: {{ y * 2 }};
}`;
      const result = transpile(source);

      const css = executeTranspiled(result.code);
      expect(css).toBe(`.box {
  width: 10;
  height: 10;
}`);
    });

    it('should handle $param and {{ }} in same declaration', () => {
      const source = `---
const $gap = 8
const multiplier = 2
---
.box {
  padding: $gap + {{ multiplier }}px;
}`;
      const result = transpile(source);

      const css = executeTranspiled(result.code);
      // $gap becomes 8 (text), multiplier becomes 2 (evaluated)
      expect(css).toBe(`.box {
  padding: 8 + 2px;
}`);
    });
  });

  describe('{{ }} escape hatch in protected contexts', () => {
    it('should use {{ $param }} to substitute inside quoted url()', () => {
      // $param inside quoted string is protected, but {{ }} is universal
      const source = `---
const $path = 'images'
---
.bg {
  background: url("/$path/hero.png");
  background: url("/{{ $path }}/hero.png");
}`;
      const result = transpile(source);

      const css = executeTranspiled(result.code);
      expect(css).toBe(`.bg {
  background: url("/$path/hero.png");
  background: url("/images/hero.png");
}`);
    });

    it('should use {{ $param }} to substitute inside double-quoted string', () => {
      const source = `---
const $name = 'World'
---
.greeting {
  content: "Hello $name!";
  content: "Hello {{ $name }}!";
}`;
      const result = transpile(source);

      const css = executeTranspiled(result.code);
      expect(css).toBe(`.greeting {
  content: "Hello $name!";
  content: "Hello World!";
}`);
    });

    it('should use {{ $param }} to substitute inside block comment', () => {
      const source = `---
const $version = '1.0.0'
---
/* Version: $version */
/* Version: {{ $version }} */
p { color: red; }`;
      const result = transpile(source);

      const css = executeTranspiled(result.code);
      expect(css).toBe(`/* Version: $version */
/* Version: 1.0.0 */
p { color: red; }`);
    });
  });
});
