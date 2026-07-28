import { describe, expect, test } from 'bun:test';
import { ProfileBodySchema } from './profile';

describe('ProfileBodySchema', () => {
  test('accepts an arbitrary JSON object', () => {
    expect(
      ProfileBodySchema.safeParse({
        pollIntervalMs: { min: 2000, max: 5000 },
        latencyMs: { min: 200, max: 1500 },
      }).success,
    ).toBe(true);
  });

  test('accepts an empty object', () => {
    expect(ProfileBodySchema.safeParse({}).success).toBe(true);
  });

  test('rejects a JSON array', () => {
    expect(ProfileBodySchema.safeParse([1, 2, 3]).success).toBe(false);
  });

  test('rejects a bare string', () => {
    expect(ProfileBodySchema.safeParse('not an object').success).toBe(false);
  });

  test('rejects null', () => {
    expect(ProfileBodySchema.safeParse(null).success).toBe(false);
  });
});
