/**
 * Unit tests for session-terminator
 *
 * Covers ARN recovery from the platform-injected AGENTCORE_RUNTIME_URL and the
 * best-effort StopRuntimeSession call (success + swallowed-failure paths).
 */

import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';

// Mock config so importing the module doesn't pull in real env parsing.
jest.unstable_mockModule('../../config/index.js', () => ({
  config: { AWS_REGION: 'ap-northeast-1' },
}));

// Mock the AWS SDK client; `sendMock` is asserted/overridden per test.
const sendMock = jest.fn<(...args: unknown[]) => Promise<unknown>>();
jest.unstable_mockModule('@aws-sdk/client-bedrock-agentcore', () => ({
  BedrockAgentCoreClient: jest.fn().mockImplementation(() => ({ send: sendMock })),
  StopRuntimeSessionCommand: jest
    .fn()
    .mockImplementation((input: unknown) => ({ __input: input })),
}));

const { resolveOwnRuntimeArn, stopOwnSession } = await import('../session-terminator.js');
const { StopRuntimeSessionCommand } = await import('@aws-sdk/client-bedrock-agentcore');

const ARN = 'arn:aws:bedrock-agentcore:ap-northeast-1:123456789012:runtime/moca-3bl7hC71J7';
const RUNTIME_URL = `https://bedrock-agentcore.ap-northeast-1.amazonaws.com/runtimes/${encodeURIComponent(
  ARN
)}/invocations`;

describe('resolveOwnRuntimeArn', () => {
  it('extracts and decodes the ARN from a percent-encoded runtime URL', () => {
    expect(resolveOwnRuntimeArn(RUNTIME_URL)).toBe(ARN);
  });

  it('returns undefined when the env var is absent', () => {
    expect(resolveOwnRuntimeArn(undefined)).toBeUndefined();
  });

  it('returns undefined when the URL lacks a /runtimes/<arn>/invocations segment', () => {
    expect(
      resolveOwnRuntimeArn('https://bedrock-agentcore.ap-northeast-1.amazonaws.com/ping')
    ).toBeUndefined();
  });

  it('falls back to process.env.AGENTCORE_RUNTIME_URL when no argument is passed', () => {
    const prev = process.env.AGENTCORE_RUNTIME_URL;
    process.env.AGENTCORE_RUNTIME_URL = RUNTIME_URL;
    try {
      expect(resolveOwnRuntimeArn()).toBe(ARN);
    } finally {
      if (prev === undefined) delete process.env.AGENTCORE_RUNTIME_URL;
      else process.env.AGENTCORE_RUNTIME_URL = prev;
    }
  });
});

describe('stopOwnSession', () => {
  beforeEach(() => {
    sendMock.mockReset();
    (StopRuntimeSessionCommand as unknown as jest.Mock).mockClear();
    process.env.AGENTCORE_RUNTIME_URL = RUNTIME_URL;
  });

  afterEach(() => {
    delete process.env.AGENTCORE_RUNTIME_URL;
  });

  it('calls StopRuntimeSession with the resolved ARN and given session id', async () => {
    sendMock.mockResolvedValue({ statusCode: 200 });

    await stopOwnSession('session-abc-0000000000000000000000000');

    expect(StopRuntimeSessionCommand).toHaveBeenCalledWith({
      agentRuntimeArn: ARN,
      runtimeSessionId: 'session-abc-0000000000000000000000000',
    });
    expect(sendMock).toHaveBeenCalledTimes(1);
  });

  it('does not call the SDK when the ARN cannot be resolved', async () => {
    delete process.env.AGENTCORE_RUNTIME_URL;

    await stopOwnSession('session-abc');

    expect(sendMock).not.toHaveBeenCalled();
  });

  it('swallows SDK errors (best-effort)', async () => {
    sendMock.mockRejectedValue(new Error('AccessDeniedException'));

    await expect(stopOwnSession('session-abc')).resolves.toBeUndefined();
    expect(sendMock).toHaveBeenCalledTimes(1);
  });
});
