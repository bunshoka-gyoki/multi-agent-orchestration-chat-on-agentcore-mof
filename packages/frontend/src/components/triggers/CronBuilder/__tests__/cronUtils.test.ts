/**
 * Tests for schedule interval detection and classification.
 *
 * The behaviour being tested is the primary guard against users scheduling
 * triggers that fire more often than once per 10 minutes — a cadence that
 * would quickly exhaust the `GetOpenIdTokenForDeveloperIdentity` 25 TPS hard
 * quota when aggregated across multiple users, and drive up per-fire
 * Lambda/Bedrock cost. The backend enforces the same rule
 * in `packages/backend/src/services/scheduler-service.ts`; any change to
 * `getMinimumIntervalMinutes` here must be mirrored there (and vice-versa).
 */

import { describe, it, expect } from 'vitest';
import {
  getMinimumIntervalMinutes,
  validateScheduleInterval,
  COST_WARNING_THRESHOLD_MINUTES,
  MINIMUM_INTERVAL_MINUTES,
} from '../cronUtils';

describe('getMinimumIntervalMinutes', () => {
  it.each<[string, number]>([
    // Cron expressions (6 fields: minute hour day month dow year)
    ['* * * * ? *', 1], // every minute
    ['*/5 * * * ? *', 5], // every 5 minutes
    ['0 * * * ? *', 60], // every hour (on the minute)
    ['0 0 * * ? *', 60 * 24], // every day at 00:00 → 24h
    ['0 0 ? * MON-FRI *', 60 * 24], // every weekday (simplified to daily)
    ['0,30 * * * ? *', 30], // every 30 minutes
    ['0 */2 * * ? *', 120], // every 2 hours
    ['0 9 * * ? *', 60 * 24], // daily at 9 → 24h
    // rate() expressions
    ['rate(1 minute)', 1],
    ['rate(5 minutes)', 5],
    ['rate(1 hour)', 60],
    ['rate(2 hours)', 120],
    ['rate(30 seconds)', 0.5],
    // whitespace tolerance
    ['  *  *  *  *  ?  *  ', 1],
    // cron(...) wrapper
    ['cron(0 * * * ? *)', 60],
  ])('parses %s → %s minutes', (expression, expected) => {
    expect(getMinimumIntervalMinutes(expression)).toBeCloseTo(expected);
  });

  it('returns null for unparseable expressions', () => {
    expect(getMinimumIntervalMinutes('not a cron')).toBeNull();
    expect(getMinimumIntervalMinutes('0 0 0')).toBeNull();
    expect(getMinimumIntervalMinutes('rate(10 fortnights)')).toBeNull();
  });
});

describe('validateScheduleInterval', () => {
  it('returns "too-short" for schedules faster than the 10-minute floor', () => {
    expect(validateScheduleInterval('rate(30 seconds)')).toBe('too-short');
    expect(validateScheduleInterval('rate(0.5 minutes)')).toBe('too-short');
    expect(validateScheduleInterval('* * * * ? *')).toBe('too-short'); // every minute
    expect(validateScheduleInterval('*/5 * * * ? *')).toBe('too-short'); // every 5 minutes
    expect(validateScheduleInterval('rate(9 minutes)')).toBe('too-short'); // just under floor
  });

  it('treats exactly the 10-minute floor as allowed (with warning)', () => {
    // Boundary: 10 min is >= MINIMUM_INTERVAL_MINUTES, so it is no longer
    // blocked, but still < COST_WARNING_THRESHOLD_MINUTES so it warns.
    expect(validateScheduleInterval('*/10 * * * ? *')).toBe('warning');
    expect(validateScheduleInterval('rate(10 minutes)')).toBe('warning');
  });

  it('returns "warning" for sub-hourly schedules at or above the floor', () => {
    expect(validateScheduleInterval('*/30 * * * ? *')).toBe('warning'); // every 30 minutes
    expect(validateScheduleInterval('0,30 * * * ? *')).toBe('warning');
  });

  it('returns "ok" for hourly-or-sparser schedules', () => {
    expect(validateScheduleInterval('0 * * * ? *')).toBe('ok'); // every hour
    expect(validateScheduleInterval('0 0 * * ? *')).toBe('ok'); // every day
    expect(validateScheduleInterval('0 0 ? * MON *')).toBe('ok'); // every Monday
    expect(validateScheduleInterval('rate(1 hour)')).toBe('ok');
    expect(validateScheduleInterval('rate(1 day)')).toBe('ok');
  });

  it('returns "unknown" for unparseable expressions', () => {
    // "unknown" is deliberately distinct from "too-short" so the UI can
    // surface the warning banner (prompting the user to double-check)
    // without outright blocking submit.
    expect(validateScheduleInterval('garbage')).toBe('unknown');
  });

  it('uses the documented thresholds', () => {
    // These constants are part of the shared contract between the frontend
    // and backend implementations. Changing them requires matching changes
    // in scheduler-service.ts.
    expect(MINIMUM_INTERVAL_MINUTES).toBe(10);
    expect(COST_WARNING_THRESHOLD_MINUTES).toBe(60);
  });
});
