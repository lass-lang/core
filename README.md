# @lass-lang/core

Core transpiler for the Lass language. Converts `.lass` files to executable JavaScript modules that produce CSS.

## Installation

```bash
pnpm add @lass-lang/core
```

## Usage

```typescript
import { transpile } from '@lass-lang/core';

// Transpile Lass source to a JavaScript module
const source = `
.button {
  color: blue;
  padding: 8px 16px;
}
`;

const { code } = transpile(source);
// code is a JS module string that exports the CSS

// Execute the transpiled code to get CSS
const dataUrl = `data:text/javascript;charset=utf-8,${encodeURIComponent(code)}`;
const module = await import(dataUrl);
console.log(module.default); // The CSS string
```

## API

### `transpile(source, options?)`

Transpiles Lass source code to a JavaScript module.

**Parameters:**
- `source` (string): The Lass source code
- `options` (TranspileOptions, optional):
  - `filename` (string): Source file path for error messages
  - `sourceMap` (boolean): Generate source maps (future)

**Returns:** `TranspileResult`
- `code` (string): The generated JavaScript module code
- `map` (string, optional): Source map (future)

### Error Handling

```typescript
import { LassTranspileError, ErrorCategory } from '@lass-lang/core';

try {
  const { code } = transpile(source, { filename: 'style.lass' });
} catch (error) {
  if (error instanceof LassTranspileError) {
    console.error(`${error.category} error at line ${error.location.line}`);
  }
}
```

**Error Categories:**
- `ErrorCategory.SCAN` - Scanner-level errors
- `ErrorCategory.SYMBOL` - Symbol detection errors
- `ErrorCategory.SYNTAX` - Syntax errors

## Features

The Lass transpiler supports the full language feature set:

- **Two-zone model** - Use `---` separator to define a JS preamble zone followed by a CSS zone
- **Dollar substitution** - `$name` text substitution from preamble variables
- **Expression interpolation** - `{{ expr }}` for inline JavaScript expressions
- **Property lookup** - `@(prop)` or `@prop` shorthand to reference previously defined CSS property values
- **Style blocks** - `@{ }` to embed CSS fragments generated from JavaScript
- **Comment stripping** - `//` single-line comments are removed from output

## License

MIT
