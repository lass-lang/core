/**
 * Landing page example verification tests (Story 9.2).
 *
 * Each test transpiles the actual Lass source from the landing page examples,
 * executes the output JS, and verifies the CSS output matches what we display.
 *
 * AC1: Every example must compile and produce the shown output.
 * AC3: No example forces Lass where CSS works fine.
 */

import { describe, it, expect } from 'vitest';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { transpile } from '../src/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(__dirname, 'fixtures');

/**
 * Executes transpiled Lass code and returns the CSS output.
 */
async function executeTranspiledCode(code: string): Promise<string> {
  const originalLog = console.log;
  console.log = () => {};
  try {
    const dataUrl = `data:text/javascript;charset=utf-8,${encodeURIComponent(code)}`;
    const module = await import(dataUrl);
    if (typeof module.default !== 'string') {
      throw new Error(`Transpiled module did not export a CSS string (got ${typeof module.default})`);
    }
    return module.default;
  } finally {
    console.log = originalLog;
  }
}

/**
 * Helper: transpile + execute, return CSS string.
 */
async function lassToCSS(source: string): Promise<string> {
  const { code } = transpile(source);
  return executeTranspiledCode(code);
}

// =============================================================================
// Example 1: CSS Passthrough
// =============================================================================

describe('Landing Example 1: CSS Passthrough', () => {
  const input = `.card {
  --card-bg: oklch(97% 0.01 240);
  background: var(--card-bg);
  border-radius: 8px;
  padding: 1.5rem;

  & h2 {
    margin: 0 0 0.5rem;
    font-size: 1.25rem;
  }

  & p {
    color: oklch(45% 0 0);
    line-height: 1.6;
  }
}

@layer components {
  .card { container-type: inline-size; }
}`;

  it('should pass through unchanged (byte-identical input/output)', async () => {
    const css = await lassToCSS(input);
    expect(css).toBe(input);
  });

  it('should preserve modern CSS features (nesting, custom properties, @layer) in output', async () => {
    const css = await lassToCSS(input);
    expect(css).toContain('&');
    expect(css).toContain('--card-bg');
    expect(css).toContain('@layer');
  });
});

// =============================================================================
// Example 2: Design Token Import
// =============================================================================

describe('Landing Example 2: Design Token Import', () => {
  // For testing, we inline the palette data instead of using import (which
  // requires file resolution). The transpile output is structurally identical.
  const input = `const palette = {
  sun: {
    morning: "oklch(85% 0.12 85)",
    noon:    "oklch(95% 0.08 95)",
    sunset:  "oklch(65% 0.18 35)",
    nadir:   "oklch(15% 0.05 270)",
  }
}
--- design token import
:root {
{{ Object.entries(palette.sun).map(([name, value]) => \`  --sun-\${name}: \${value};\`).join('\\n') }}
}`;

  const expectedCSS = `:root {
  --sun-morning: oklch(85% 0.12 85);
  --sun-noon: oklch(95% 0.08 95);
  --sun-sunset: oklch(65% 0.18 35);
  --sun-nadir: oklch(15% 0.05 270);
}`;

  it('should generate CSS custom properties from token data', async () => {
    const css = await lassToCSS(input);
    expect(css).toBe(expectedCSS);
  });

  it('should work with real import (as shown in README)', async () => {
    // This tests the actual `import palette from './palette.json'` syntax
    // shown on the landing page. The transpiler preserves the import statement;
    // we rewrite the relative path to an absolute file:// URL so the dynamic
    // import can resolve it outside a bundler context.
    const importInput = `import palette from './palette.json'
--- design token import
:root {
{{ Object.entries(palette.sun).map(([name, value]) => \`  --sun-\${name}: \${value};\`).join('\\n') }}
}`;
    const { code } = transpile(importInput);
    const fixtureUrl = pathToFileURL(join(fixturesDir, 'palette.json')).href;
    const resolvedCode = code.replace(
      /from\s+['"]\.\/palette\.json['"]/,
      `from '${fixtureUrl}' with { type: 'json' }`,
    );
    const css = await executeTranspiledCode(resolvedCode);
    expect(css).toBe(expectedCSS);
  });
});

// =============================================================================
// Example 3: Sass @each → Lass .map()
// =============================================================================

describe('Landing Example 3: Sass @each → Lass .map()', () => {
  const input = `const sizes = [4, 8, 16, 24, 32]
--- generate gap utilities
{{ sizes.map(s => @{
.gap-\${s} {
  gap: \${s}px;
}
}) }}`;

  // Multi-line @{ } blocks contain newlines, so array auto-joins with \n
  const expectedCSS = `.gap-4 {
  gap: 4px;
}
.gap-8 {
  gap: 8px;
}
.gap-16 {
  gap: 16px;
}
.gap-24 {
  gap: 24px;
}
.gap-32 {
  gap: 32px;
}`;

  it('should generate utility classes from .map()', async () => {
    const css = await lassToCSS(input);
    expect(css).toBe(expectedCSS);
  });
});

// =============================================================================
// Example 4: @(prop) Lookup
// =============================================================================

describe('Landing Example 4: @(prop) Lookup', () => {
  const input = `--- component with derived values
.button {
  border: 2px solid oklch(50% 0.2 250);
  outline-offset: 4px;
  outline: @(border);
}`;

  const expectedCSS = `.button {
  border: 2px solid oklch(50% 0.2 250);
  outline-offset: 4px;
  outline: 2px solid oklch(50% 0.2 250);
}`;

  it('should resolve @(border) to the previously declared value', async () => {
    const css = await lassToCSS(input);
    expect(css).toBe(expectedCSS);
  });
});

// =============================================================================
// Example 5: Tailwind + Lass Custom Variants
// =============================================================================

describe('Landing Example 5: Tailwind + Lass Custom Variants', () => {
  const input = `const themes = ["sunrise", "noon", "sunset", "midnight"]
---
@import "tailwindcss";

{{ themes.map(t => @{
  @custom-variant theme-\${t} {
    &:where([data-theme="\${t}"] *) {
      @slot;
    }
  }
}) }}`;

  const expectedCSS = `@import "tailwindcss";

@custom-variant theme-sunrise {
  &:where([data-theme="sunrise"] *) {
    @slot;
  }
}
@custom-variant theme-noon {
  &:where([data-theme="noon"] *) {
    @slot;
  }
}
@custom-variant theme-sunset {
  &:where([data-theme="sunset"] *) {
    @slot;
  }
}
@custom-variant theme-midnight {
  &:where([data-theme="midnight"] *) {
    @slot;
  }
}`;

  it('should produce exact expected CSS output', async () => {
    const css = await lassToCSS(input);
    expect(css).toBe(expectedCSS);
  });

  it('should generate exactly 4 custom variants', async () => {
    const css = await lassToCSS(input);
    const variantMatches = css.match(/@custom-variant theme-/g);
    expect(variantMatches).toHaveLength(4);
  });
});
