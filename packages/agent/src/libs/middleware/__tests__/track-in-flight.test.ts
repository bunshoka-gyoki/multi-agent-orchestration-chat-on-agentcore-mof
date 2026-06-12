/**
 * Unit tests for trackInFlightMiddleware.
 *
 * The middleware brackets an invocation's HTTP lifecycle: it marks the
 * container busy on entry and idle again when the response finishes or the
 * connection closes. This backs the `/ping` `HealthyBusy` signal that keeps
 * AgentCore Runtime from reclaiming the microVM mid-turn.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { EventEmitter } from 'node:events';
import type { Request, Response, NextFunction } from 'express';
import { trackInFlightMiddleware } from '../track-in-flight.js';
import { getInFlightCount, resetInFlight } from '../../health/in-flight.js';

/** A Response stub that is an EventEmitter so 'finish'/'close' can be driven. */
function mockResponse(): Response {
  return new EventEmitter() as unknown as Response;
}

describe('trackInFlightMiddleware', () => {
  beforeEach(() => {
    resetInFlight();
  });

  it('marks busy on entry and calls next()', () => {
    const res = mockResponse();
    const next = jest.fn() as unknown as NextFunction;

    trackInFlightMiddleware({} as Request, res, next);

    expect(getInFlightCount()).toBe(1);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('returns to idle when the response finishes', () => {
    const res = mockResponse();
    trackInFlightMiddleware({} as Request, res, jest.fn() as unknown as NextFunction);
    expect(getInFlightCount()).toBe(1);

    res.emit('finish');
    expect(getInFlightCount()).toBe(0);
  });

  it('returns to idle when the connection closes (client abort mid-stream)', () => {
    const res = mockResponse();
    trackInFlightMiddleware({} as Request, res, jest.fn() as unknown as NextFunction);
    expect(getInFlightCount()).toBe(1);

    res.emit('close');
    expect(getInFlightCount()).toBe(0);
  });

  it('decrements exactly once when both finish and close fire', () => {
    const res = mockResponse();
    trackInFlightMiddleware({} as Request, res, jest.fn() as unknown as NextFunction);

    res.emit('finish');
    res.emit('close');

    // Two invocations bracketed; a double-decrement from one of them would
    // wrongly read this as idle while the other is still running.
    expect(getInFlightCount()).toBe(0);
  });

  it('keeps the container busy while one of two concurrent responses is still open', () => {
    const resA = mockResponse();
    const resB = mockResponse();
    trackInFlightMiddleware({} as Request, resA, jest.fn() as unknown as NextFunction);
    trackInFlightMiddleware({} as Request, resB, jest.fn() as unknown as NextFunction);
    expect(getInFlightCount()).toBe(2);

    resA.emit('finish');
    resA.emit('close'); // both fire for A — must only drop A's single count
    expect(getInFlightCount()).toBe(1);

    resB.emit('close');
    expect(getInFlightCount()).toBe(0);
  });
});
