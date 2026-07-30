import * as SunCalc from 'suncalc';

/** FAA-relevant sun/twilight instants for a date and location, or `null` for events that don't occur (polar day/night). */
export interface SunTimes {
  morningCivilTwilightBeginsAt: string | null;
  sunriseAt: string | null;
  sunsetAt: string | null;
  eveningCivilTwilightEndsAt: string | null;
}

/** Converts a suncalc event (a `Date`, or `null` when the event doesn't occur) to an ISO string or `null`. */
function toIsoOrNull(date: Date | null): string | null {
  return date ? date.toISOString() : null;
}

/**
 * Computes the beginning of morning civil twilight, sunrise, sunset, and the end of evening
 * civil twilight for the given date and point, per the FAA's civil-twilight-based definition
 * of night (14 CFR 1.1).
 */
export function getSunTimes(date: Date, lat: number, lon: number): SunTimes {
  const times = SunCalc.getTimes(date, lat, lon);
  return {
    morningCivilTwilightBeginsAt: toIsoOrNull(times.dawn),
    sunriseAt: toIsoOrNull(times.sunrise),
    sunsetAt: toIsoOrNull(times.sunset),
    eveningCivilTwilightEndsAt: toIsoOrNull(times.dusk),
  };
}
