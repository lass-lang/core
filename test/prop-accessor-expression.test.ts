/**
 * Scanner tests for @(prop) property accessor inside {{ }} expressions.
 *
 * Story 3.3: Lookup in {{ }} Context
 *
 * NOTE: Lass→CSS behavior tests are in style-lookup.common.md and
 * style-lookup.extra-cases.md axioms. These tests cover scanner detection only.
 */

import { describe, test, expect } from 'vitest';
import { Scanner } from '../src/index.js';

describe('Story 3.3: @(prop) inside {{ }} expressions - Scanner', () => {
  describe('scanner detection', () => {
    test('scanner detects @(prop) inside {{ }}', () => {
      const cssZone = '.box { color: blue; background: {{ @(color) }}; }';
      const accessors = Scanner.findPropertyAccessorsStatic(cssZone);
      expect(accessors).toHaveLength(1);
      expect(accessors[0]!.propName).toBe('color');
    });

    test('scanner detects multiple @(prop) inside {{ }}', () => {
      const cssZone = '.box { a: 1; b: 2; c: {{ @(a) + @(b) }}; }';
      const accessors = Scanner.findPropertyAccessorsStatic(cssZone);
      expect(accessors).toHaveLength(2);
      expect(accessors[0]!.propName).toBe('a');
      expect(accessors[1]!.propName).toBe('b');
    });

    test('scanner handles {{ }} nesting correctly', () => {
      // Multiple {{ }} in same block, each with @(prop)
      const cssZone = '.box { x: 1; a: {{ @(x) }}; b: {{ @(x) }}; }';
      const accessors = Scanner.findPropertyAccessorsStatic(cssZone);
      expect(accessors).toHaveLength(2);
    });
  });
});
