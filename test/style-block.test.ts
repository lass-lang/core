/**
 * Unit tests for style block translation (Story 5.1).
 *
 * Tests the @{ } style block syntax which translates to JS template literals.
 * These are lower-level unit tests for the translation functions.
 * Integration tests are in axioms.test.ts.
 */

import { describe, it, expect } from 'vitest';
import { translateStyleBlocks } from '../src/transpiler.js';

describe('translateStyleBlocks()', () => {
  describe('basic translation', () => {
    it('should translate @{ } to backticks', () => {
      // Single-line style blocks are trimmed
      const result = translateStyleBlocks('@{ color: red; }');
      expect(result.text).toBe('`color: red;`');
    });

    it('should return unchanged text without @{', () => {
      const result = translateStyleBlocks('const x = 1;');
      expect(result.text).toBe('const x = 1;');
      expect(result.hasDollarVariables).toBe(false);
    });

    it('should handle empty input', () => {
      const result = translateStyleBlocks('');
      expect(result.text).toBe('');
      expect(result.hasDollarVariables).toBe(false);
    });

    it('should handle empty style block', () => {
      const result = translateStyleBlocks('@{}');
      expect(result.text).toBe('``');
    });
  });

  describe('$param translation', () => {
    it('should translate $param to __lassScriptLookup call', () => {
      const result = translateStyleBlocks('@{ color: $color; }');
      expect(result.text).toContain('__lassScriptLookup');
      expect(result.text).toContain("'color'");
      expect(result.text).toContain('$color');
      expect(result.hasDollarVariables).toBe(true);
    });

    it('should NOT translate $param inside {{ }}', () => {
      const result = translateStyleBlocks('@{ color: {{ $color }}; }');
      // $color inside {{ }} should remain as-is
      expect(result.text).toContain('$color');
      // The outer {{ }} becomes ${__lassScriptExpression(...)}
      expect(result.text).toContain('__lassScriptExpression');
      // Should not have __lassScriptLookup since $param is in {{ }}
      expect(result.hasDollarVariables).toBe(false);
    });

    it('should track hasDollarVariables correctly', () => {
      const withDollar = translateStyleBlocks('@{ color: $x; }');
      expect(withDollar.hasDollarVariables).toBe(true);

      const withoutDollar = translateStyleBlocks('@{ color: red; }');
      expect(withoutDollar.hasDollarVariables).toBe(false);
    });
  });

  describe('{{ }} translation', () => {
    it('should translate {{ }} to ${__lassScriptExpression(...)}', () => {
      const result = translateStyleBlocks('@{ color: {{ x }}; }');
      expect(result.text).toContain('${__lassScriptExpression(x)}');
    });

    it('should handle nested braces in expressions', () => {
      const result = translateStyleBlocks("@{ color: {{ x > 0 ? 'red' : 'blue' }}; }");
      expect(result.text).toContain("x > 0 ? 'red' : 'blue'");
    });
  });

  describe('protected contexts', () => {
    it('should NOT translate @{ inside string literals', () => {
      const result = translateStyleBlocks('const s = "not @{ a block }";');
      expect(result.text).toBe('const s = "not @{ a block }";');
    });

    it('should NOT translate @{ inside block comments', () => {
      const result = translateStyleBlocks('/* not @{ a block } */');
      expect(result.text).toBe('/* not @{ a block } */');
    });

    it('should handle @{ after exiting string context', () => {
      // Single-line style blocks are trimmed
      const result = translateStyleBlocks('const s = "test"; @{ color: red; }');
      expect(result.text).toBe('const s = "test"; `color: red;`');
    });

    it('should handle block comment inside style block content', () => {
      // Block comment inside @{ } - findStyleBlockClose needs to handle /* */
      // Single-line style blocks are trimmed
      const result = translateStyleBlocks('@{ /* comment */ color: red; }');
      expect(result.text).toBe('`/* comment */ color: red;`');
    });

    it('should handle string with escape inside style block', () => {
      // Escaped quote inside string inside @{ }
      // Single-line style blocks are trimmed
      const result = translateStyleBlocks('@{ content: "test\\"value"; }');
      expect(result.text).toBe('`content: "test\\"value";`');
    });
  });

  describe('nested style blocks', () => {
    it('should handle nested @{ } blocks', () => {
      const result = translateStyleBlocks('@{ outer: @{ inner: val; } }');
      // Both @{ should become backticks
      expect(result.text).toContain('`');
      expect(result.text).not.toContain('@{');
    });

    it('should track $param in nested blocks', () => {
      const result = translateStyleBlocks('@{ outer: @{ inner: $x; } }');
      expect(result.hasDollarVariables).toBe(true);
    });
  });

  describe('brace matching', () => {
    it('should handle JS object literals inside {{ }}', () => {
      const result = translateStyleBlocks('@{ {{ {a: 1, b: 2} }} }');
      // The JS object braces should not close the style block
      expect(result.text).toContain('`');
      expect(result.text).toContain('{a: 1, b: 2}');
    });

    it('should handle unmatched @{ gracefully', () => {
      const result = translateStyleBlocks('const x = @{');
      // Should preserve as literal text
      expect(result.text).toBe('const x = @{');
    });

    it('should handle @{ at end of text', () => {
      const result = translateStyleBlocks('const f = () => @{');
      // Should preserve as literal text when no closing }
      expect(result.text).toBe('const f = () => @{');
    });

    it('should handle @{ with only whitespace before EOF', () => {
      const result = translateStyleBlocks('@{   ');
      // No closing } found, preserved as literal
      expect(result.text).toBe('@{   ');
    });

    it('should handle unclosed {{ inside style block', () => {
      // {{ without }} inside @{ } - the {{ is preserved as literal
      // Single-line style blocks are trimmed
      const result = translateStyleBlocks('@{ before {{ after }');
      // The @{ } translates, but {{ without }} stays as literal text
      expect(result.text).toBe('`before {{ after`');
    });
  });

  describe('arrow functions with style blocks', () => {
    it('should translate arrow function returning style block', () => {
      // Single-line style blocks are trimmed
      const result = translateStyleBlocks('const f = () => @{ color: red; }');
      expect(result.text).toBe('const f = () => `color: red;`');
    });

    it('should handle multiple arrow functions', () => {
      // Single-line style blocks are trimmed
      const result = translateStyleBlocks('const a = () => @{ a: 1; }; const b = () => @{ b: 2; }');
      expect(result.text).toBe('const a = () => `a: 1;`; const b = () => `b: 2;`');
    });
  });
});
