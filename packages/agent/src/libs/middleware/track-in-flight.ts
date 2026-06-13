/**
 * In-flight tracking middleware for the agent invocation route.
 *
 * Brackets an invocation's HTTP lifecycle so `/ping` can report `HealthyBusy`
 * while a turn is being processed, keeping AgentCore Runtime from judging the
 * session Idle and reclaiming the microVM (SIGTERM) mid-turn. See
 * libs/health/in-flight.ts for the full platform rationale.
 *
 * WHY a middleware (not begin/end inside the handler):
 *   - The busy window is tied to the RESPONSE lifecycle, not the handler's
 *     control flow. Releasing on `res` 'finish' (response fully written) AND
 *     'close' (client/socket disconnected mid-stream) covers the streaming
 *     abort case that a handler-level `try/finally` misses.
 *   - It is a single choke point: any future long-running route gets correct
 *     busy reporting just by adding this middleware, with no per-handler
 *     boilerplate to forget.
 */

import type { Request, Response, NextFunction } from 'express';
import { beginInvocation, endInvocation } from '../health/in-flight.js';

/**
 * Mark the container busy for the lifetime of this request's response.
 *
 * The release is guarded so it runs exactly once even though Node fires both
 * `finish` and `close` for a normal response — a double decrement would let a
 * still-open concurrent response read as idle and reintroduce the mid-turn
 * SIGTERM this guards against.
 */
export function trackInFlightMiddleware(req: Request, res: Response, next: NextFunction): void {
  beginInvocation();

  let released = false;
  const release = (): void => {
    if (released) return;
    released = true;
    endInvocation();
  };

  // 'finish' = response fully sent; 'close' = connection closed (incl. client
  // abort mid-stream, where 'finish' may never fire). Whichever lands first wins.
  res.once('finish', release);
  res.once('close', release);

  next();
}
