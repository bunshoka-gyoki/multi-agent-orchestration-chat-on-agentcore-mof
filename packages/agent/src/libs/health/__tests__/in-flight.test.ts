/**
 * Unit tests for the in-flight invocation tracker.
 *
 * The tracker backs the `/ping` health endpoint's `HealthyBusy` status:
 * AgentCore Runtime treats a session as Idle (and reclaims its microVM,
 * sending SIGTERM) unless the agent reports `HealthyBusy` while a long-running
 * invocation is still being processed. See libs/health/in-flight.ts.
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import {
  beginInvocation,
  endInvocation,
  getInFlightCount,
  isBusy,
  resetInFlight,
} from '../in-flight.js';

describe('in-flight invocation tracker', () => {
  beforeEach(() => {
    resetInFlight();
  });

  it('starts idle (count 0, not busy)', () => {
    expect(getInFlightCount()).toBe(0);
    expect(isBusy()).toBe(false);
  });

  it('is busy while one invocation is in flight', () => {
    beginInvocation();
    expect(getInFlightCount()).toBe(1);
    expect(isBusy()).toBe(true);
  });

  it('returns to idle after the invocation ends', () => {
    beginInvocation();
    endInvocation();
    expect(getInFlightCount()).toBe(0);
    expect(isBusy()).toBe(false);
  });

  it('tracks concurrent invocations and only reports idle when all end', () => {
    beginInvocation();
    beginInvocation();
    expect(getInFlightCount()).toBe(2);
    expect(isBusy()).toBe(true);

    endInvocation();
    expect(getInFlightCount()).toBe(1);
    expect(isBusy()).toBe(true);

    endInvocation();
    expect(getInFlightCount()).toBe(0);
    expect(isBusy()).toBe(false);
  });

  it('never lets the counter go negative even on an unbalanced end', () => {
    // A stray endInvocation (e.g. double-decrement on an error path) must not
    // drive the counter below zero, which would wedge the gauge and make a
    // genuinely busy container look idle.
    endInvocation();
    expect(getInFlightCount()).toBe(0);
    expect(isBusy()).toBe(false);

    beginInvocation();
    endInvocation();
    endInvocation();
    expect(getInFlightCount()).toBe(0);
  });
});
