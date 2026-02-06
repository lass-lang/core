import { describe, it, expect } from 'vitest';
import {
  LassTranspileError,
  ErrorCategory,
  formatLocation,
} from '../src/errors.js';

describe('LassTranspileError', () => {
  describe('constructor', () => {
    it('creates error with all location fields', () => {
      const error = new LassTranspileError('test message', ErrorCategory.SCAN, {
        line: 10,
        column: 5,
        offset: 100,
        filename: 'test.lass',
      });

      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(LassTranspileError);
      expect(error.name).toBe('LassTranspileError');
      expect(error.category).toBe(ErrorCategory.SCAN);
      expect(error.location.line).toBe(10);
      expect(error.location.column).toBe(5);
      expect(error.location.offset).toBe(100);
      expect(error.location.filename).toBe('test.lass');
    });

    it('formats message with filename when provided', () => {
      const error = new LassTranspileError('unexpected token', ErrorCategory.SYNTAX, {
        line: 5,
        column: 10,
        offset: 50,
        filename: 'style.lass',
      });

      expect(error.message).toBe('style.lass:5:10 - [SYNTAX] unexpected token');
    });

    it('formats message without filename when not provided', () => {
      const error = new LassTranspileError('invalid symbol', ErrorCategory.SYMBOL, {
        line: 3,
        column: 7,
        offset: 25,
      });

      expect(error.message).toBe('3:7 - [SYMBOL] invalid symbol');
    });
  });

  describe('static at()', () => {
    it('creates error without filename', () => {
      const error = LassTranspileError.at('test error', ErrorCategory.SCAN, 1, 1, 0);

      expect(error.message).toBe('1:1 - [SCAN] test error');
      expect(error.location.filename).toBeUndefined();
    });

    it('defaults offset to 0', () => {
      const error = LassTranspileError.at('test', ErrorCategory.SCAN, 1, 1);

      expect(error.location.offset).toBe(0);
    });
  });

  describe('static atFile()', () => {
    it('creates error with filename', () => {
      const error = LassTranspileError.atFile(
        'test error',
        ErrorCategory.SYNTAX,
        'app.lass',
        5,
        10,
        50
      );

      expect(error.message).toBe('app.lass:5:10 - [SYNTAX] test error');
      expect(error.location.filename).toBe('app.lass');
    });

    it('defaults offset to 0', () => {
      const error = LassTranspileError.atFile('test', ErrorCategory.SCAN, 'f.lass', 1, 1);

      expect(error.location.offset).toBe(0);
    });
  });

  describe('ErrorCategory', () => {
    it('has SCAN category', () => {
      expect(ErrorCategory.SCAN).toBe('SCAN');
    });

    it('has SYMBOL category', () => {
      expect(ErrorCategory.SYMBOL).toBe('SYMBOL');
    });

    it('has SYNTAX category', () => {
      expect(ErrorCategory.SYNTAX).toBe('SYNTAX');
    });
  });
});

describe('formatLocation', () => {
  it('formats location with filename', () => {
    const result = formatLocation({
      line: 10,
      column: 5,
      offset: 100,
      filename: 'test.lass',
    });

    expect(result).toBe('test.lass:10:5');
  });

  it('formats location without filename', () => {
    const result = formatLocation({
      line: 3,
      column: 7,
      offset: 25,
    });

    expect(result).toBe('3:7');
  });
});
