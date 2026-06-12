/**
 * Unit tests for the health (`/ping`) handler.
 *
 * AgentCore Runtime polls `/ping` to decide whether a session is Idle. A bare
 * `Healthy` while a long invocation is still running lets the platform reclaim
 * the microVM (SIGTERM) mid-task. `handlePing` must therefore report
 * `HealthyBusy` whenever an invocation is in flight.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import type { Request, Response } from 'express';
import { handlePing } from '../health.js';
import { beginInvocation, resetInFlight } from '../../libs/health/in-flight.js';

/** Minimal Response stub capturing the JSON body. */
function mockResponse(): { res: Response; body: () => unknown } {
  let captured: unknown;
  const res = {
    json: jest.fn((payload: unknown) => {
      captured = payload;
      return res;
    }),
  } as unknown as Response;
  return { res, body: () => captured };
}

describe('handlePing', () => {
  beforeEach(() => {
    resetInFlight();
  });

  it('reports "Healthy" when no invocation is in flight', () => {
    const { res, body } = mockResponse();
    handlePing({} as Request, res);
    expect((body() as { status: string }).status).toBe('Healthy');
  });

  it('reports "HealthyBusy" while an invocation is in flight', () => {
    beginInvocation();
    const { res, body } = mockResponse();
    handlePing({} as Request, res);
    expect((body() as { status: string }).status).toBe('HealthyBusy');
  });

  it('always includes a numeric time_of_last_update', () => {
    const { res, body } = mockResponse();
    handlePing({} as Request, res);
    expect(typeof (body() as { time_of_last_update: number }).time_of_last_update).toBe('number');
  });
});
