/**
 * Axiom-based tests for @lass-lang/core transpiler.
 *
 * This file dynamically generates tests from axiom files in @lass-lang/axioms.
 * Axioms are markdown files (.common.md, .extra-cases.md) that define input/output
 * pairs for the transpiler.
 *
 * Test execution flow:
 * 1. Load all axioms from @lass-lang/axioms
 * 2. For each axiom, generate describe block per feature
 * 3. For valid cases: transpile input, execute JS, compare CSS output
 * 4. For invalid cases: verify transpile/execute throws matching error
 */

import { describe, test, expect } from 'vitest';
import { loadAllAxioms, type AxiomFile, type TestCase } from '@lass-lang/axioms';
import { transpile } from '../src/index.js';

/**
 * Executes transpiled Lass code and returns the CSS output.
 * Uses dynamic import with data URL to execute the JS module.
 */
async function executeTranspiledCode(code: string): Promise<string> {
  // Suppress console.log during preamble execution to keep test output clean
  const originalLog = console.log;
  console.log = () => {};

  try {
    const dataUrl = `data:text/javascript;charset=utf-8,${encodeURIComponent(code)}`;
    const module = await import(dataUrl);
    return module.default;
  } finally {
    console.log = originalLog;
  }
}

/**
 * Run a valid test case: transpile, execute, and compare output.
 */
async function runValidTestCase(testCase: TestCase): Promise<void> {
  const { code } = transpile(testCase.input);
  const output = await executeTranspiledCode(code);
  expect(output).toBe(testCase.expected);
}

/**
 * Run an invalid test case: verify that transpile/execute throws.
 */
async function runInvalidTestCase(testCase: TestCase): Promise<void> {
  // For invalid cases, we expect either transpile or execution to throw
  // The expected field contains the error message substring
  try {
    const { code } = transpile(testCase.input);
    await executeTranspiledCode(code);
    // If we get here, no error was thrown
    expect.fail(`Expected error containing "${testCase.expected}" but no error was thrown`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    expect(errorMessage).toContain(testCase.expected);
  }
}

// Load all axioms
const axioms = loadAllAxioms();

// Generate tests dynamically from axioms
for (const axiom of axioms) {
  // Skip axioms marked as not-implemented or vite-only (require Vite plugin context)
  const shouldSkip = axiom.metadata.status === 'not-implemented' || (axiom.metadata.status as string) === 'vite-only';

  describe(axiom.feature, () => {
    // Group by outcome
    const validCases = axiom.testCases.filter((tc) => tc.outcome === 'valid');
    const invalidCases = axiom.testCases.filter((tc) => tc.outcome === 'invalid');

    if (validCases.length > 0) {
      describe('valid cases', () => {
        for (const testCase of validCases) {
          if (shouldSkip) {
            test.skip(testCase.name, async () => {
              await runValidTestCase(testCase);
            });
          } else {
            test(testCase.name, async () => {
              await runValidTestCase(testCase);
            });
          }
        }
      });
    }

    if (invalidCases.length > 0) {
      describe('invalid cases', () => {
        for (const testCase of invalidCases) {
          if (shouldSkip) {
            test.skip(testCase.name, async () => {
              await runInvalidTestCase(testCase);
            });
          } else {
            test(testCase.name, async () => {
              await runInvalidTestCase(testCase);
            });
          }
        }
      });
    }
  });
}

// Export test helpers for use by other packages
export { runValidTestCase, runInvalidTestCase, executeTranspiledCode };
