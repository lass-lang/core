# Changelog

## 0.1.0

### Minor Changes

- Breaking: delimiter format change, removed shorthand, array join behavior

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Removed

- **BREAKING:** `@prop` shorthand syntax removed — use `@(prop)` instead. The bare `@prop` form conflicted with CSS at-rules (`@slot`, `@custom-variant`, `@layer`, `@apply`, `@scope`, etc.) and was not future-proof as CSS continues adding new `@`-prefixed syntax. The explicit `@(prop)` form is unambiguous and remains fully supported.
- `StyleLookupShorthand` type no longer exported from `@lass-lang/core`
- `findStyleLookupShorthands()` and `findStyleLookupShorthandsStatic()` methods removed from Scanner
- `normalizeStyleLookupShorthands()` function removed from transpiler pipeline

### Added

- Initial release preparation

## [0.0.1] - 2026-02-07

### Added

- Initial development version
- Two-zone model with `---` separator for JS preamble
- Dollar substitution (`$name` variables)
- Expression interpolation (`{{ expr }}`)
- Property lookup (`@(prop)`)
- Style blocks (`@{ }` CSS fragments from JS)
- Single-line comment stripping (`//`)
- Error handling with `LassTranspileError` and error categories
