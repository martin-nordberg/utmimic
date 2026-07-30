import { describe, expect, test } from 'bun:test';
import { getSunTimes } from './astronomy';

describe('getSunTimes', () => {
  test('orders morning civil twilight before sunrise before sunset before evening civil twilight', () => {
    const times = getSunTimes(new Date('2026-07-30T00:00:00Z'), 47.6062, -122.3321);

    expect(times.morningCivilTwilightBeginsAt).not.toBeNull();
    expect(times.sunriseAt).not.toBeNull();
    expect(times.sunsetAt).not.toBeNull();
    expect(times.eveningCivilTwilightEndsAt).not.toBeNull();

    const dawn = new Date(times.morningCivilTwilightBeginsAt as string).getTime();
    const sunrise = new Date(times.sunriseAt as string).getTime();
    const sunset = new Date(times.sunsetAt as string).getTime();
    const dusk = new Date(times.eveningCivilTwilightEndsAt as string).getTime();

    expect(dawn).toBeLessThan(sunrise);
    expect(sunrise).toBeLessThan(sunset);
    expect(sunset).toBeLessThan(dusk);
  });

  test('returns all-null during polar day (sun never sets)', () => {
    const times = getSunTimes(new Date('2026-06-21T00:00:00Z'), 78.2232, 15.6267);
    expect(times).toEqual({
      morningCivilTwilightBeginsAt: null,
      sunriseAt: null,
      sunsetAt: null,
      eveningCivilTwilightEndsAt: null,
    });
  });

  test('returns all-null during polar night (sun never rises)', () => {
    const times = getSunTimes(new Date('2026-12-21T00:00:00Z'), 78.2232, 15.6267);
    expect(times).toEqual({
      morningCivilTwilightBeginsAt: null,
      sunriseAt: null,
      sunsetAt: null,
      eveningCivilTwilightEndsAt: null,
    });
  });
});
