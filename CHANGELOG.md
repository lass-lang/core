# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Initial release preparation

## [0.0.1] - 2026-02-07

### Added
- Initial development version
- Two-zone model with `---` separator for JS preamble
- Dollar substitution (`$name` variables)
- Expression interpolation (`{{ expr }}`)
- Property lookup (`@(prop)` and `@prop` shorthand)
- Style blocks (`@{ }` CSS fragments from JS)
- Single-line comment stripping (`//`)
- Error handling with `LassTranspileError` and error categories
