/**
 * Axiom-based tests for @lass-lang/core transpiler.
 *
 * This file dynamically generates tests from axiom files in @lass-lang/docs.
 * Axioms are markdown files (.common.md, .extra-cases.md) that define input/output
 * pairs for the transpiler.
 *
 * Test execution flow:
 * 1. Read all .md files from @lass-lang/docs/content/axioms/
 * 2. Extract test cases using extractTestCasesFromMD
 * 3. For valid cases: transpile input, execute JS, compare CSS output
 * 4. For invalid cases: verify transpile/execute throws matching error
 */

import { describe, test, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractTestCasesFromMD, type TestCase } from '@lass-lang/docs';
import { transpile } from '../src/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Path to axioms files directory (in @lass-lang/docs)
const axiomsDir = join(__dirname, '..', '..', '..', 'apps', 'lass-docs', 'content', 'axioms');

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
async function runValidTestCase(testCase: TestCase): Promise<string> {
  const { code } = transpile(testCase.input);
  const result = await executeTranspiledCode(code);
  expect(result).toBe(testCase.output);
  return result;
}

/**
 * Run an invalid test case: verify that transpile/execute throws.
 */
async function runInvalidTestCase(testCase: TestCase): Promise<void> {
  try {
    const { code } = transpile(testCase.input);
    await executeTranspiledCode(code);
    expect.fail(`Expected error containing "${testCase.output}" but no error was thrown`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    expect(errorMessage).toContain(testCase.output);
  }
}

/**
 * Parse frontmatter to get metadata (for skipping not-implemented features)
 */
function parseMetadataStatus(content: string): string | undefined {
  const statusMatch = content.match(/^status:\s*(\S+)$/m);
  return statusMatch?.[1];
}

// Load axiom files and generate tests
const axiomFiles = readdirSync(axiomsDir)
  .filter((f) => f.endsWith('.common.md') || f.endsWith('.extra-cases.md'))
  .sort();

for (const fileName of axiomFiles) {
  const filePath = join(axiomsDir, fileName);
  const content = readFileSync(filePath, 'utf-8');
  const testCases = extractTestCasesFromMD(content, fileName);

  if (testCases.length === 0) continue;

  // Check if feature is not implemented
  const status = parseMetadataStatus(content);
  const shouldSkip =
    status === 'not-implemented' ||
    status === 'in-progress' ||
    status === 'deferred' ||
    status === 'vite-only';

  // Use filename without extension as feature name
  const featureName = fileName.replace(/\.(common|extra-cases)\.md$/, '');

  describe(featureName, () => {
    const validCases = testCases.filter((tc) => tc.outcome === 'valid');
    const invalidCases = testCases.filter((tc) => tc.outcome === 'invalid');

    if (validCases.length > 0) {
      describe('valid cases', () => {
        for (const testCase of validCases) {
          if (shouldSkip || testCase.skip) {
            test.skip(testCase.description, async () => {
              await runValidTestCase(testCase);
            });
          } else {
            test(testCase.description, async () => {
              await runValidTestCase(testCase);
            });
          }
        }
      });
    }

    if (invalidCases.length > 0) {
      describe('invalid cases', () => {
        for (const testCase of invalidCases) {
          if (shouldSkip || testCase.skip) {
            test.skip(testCase.description, async () => {
              await runInvalidTestCase(testCase);
            });
          } else {
            test(testCase.description, async () => {
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
