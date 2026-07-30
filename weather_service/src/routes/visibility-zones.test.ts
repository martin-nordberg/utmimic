import { describe, expect, test } from 'bun:test';
import { normalizeToArray } from './visibility-zones';

describe('normalizeToArray', () => {
  test('wraps a single object in an array', () => {
    expect(normalizeToArray({ a: 1 })).toEqual([{ a: 1 }]);
  });

  test('passes an array through unchanged', () => {
    const input = [{ a: 1 }, { a: 2 }];
    expect(normalizeToArray(input)).toBe(input);
  });

  test('passes an empty array through unchanged', () => {
    expect(normalizeToArray([])).toEqual([]);
  });
});
