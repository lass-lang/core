---
"@lass-lang/core": minor
---

BREAKING: Remove `@prop` style lookup shorthand. Use `@(prop)` instead.

The bare `@prop` form conflicted with CSS at-rules (`@slot`, `@custom-variant`, `@layer`, `@apply`, `@scope`, etc.) and was not future-proof as CSS continues adding new `@`-prefixed syntax. The explicit `@(prop)` form is unambiguous and remains fully supported.

Removed:
- `StyleLookupShorthand` type export
- `findStyleLookupShorthands()` and `findStyleLookupShorthandsStatic()` Scanner methods
- `normalizeStyleLookupShorthands()` transpiler pipeline step
