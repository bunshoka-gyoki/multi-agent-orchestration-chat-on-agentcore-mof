/**
 * Unit tests for the manage_trigger tool handler (runManageTrigger).
 *
 * Uses jest.unstable_mockModule + dynamic import for ESM compatibility.
 * The Backend `/triggers` and `/events` endpoints are exercised through a
 * mocked global fetch.
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals';

const mockGetCurrentContext = jest.fn<any>();

jest.unstable_mockModule('../../../config/index.js', () => ({
  config: { BACKEND_API_URL: 'https://api.test' },
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

jest.unstable_mockModule('../../../libs/logger/index.js', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

jest.unstable_mockModule('../../../libs/context/request-context.js', () => ({
  getCurrentContext: mockGetCurrentContext,
}));

const { runManageTrigger } = await import('../manage-trigger.js');

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    statusText: ok ? 'OK' : 'Error',
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

const fetchMock = jest.fn<any>();

beforeEach(() => {
  jest.clearAllMocks();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  mockGetCurrentContext.mockReturnValue({
    authorizationHeader: 'Bearer token',
    idToken: 'id-token',
    userId: 'user-1',
  });
});

describe('runManageTrigger', () => {
  it('requires authentication', async () => {
    mockGetCurrentContext.mockReturnValue(undefined);
    const result = JSON.parse(await runManageTrigger({ action: 'list' }));
    expect(result.success).toBe(false);
    expect(result.error).toBe('Authentication required');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects an unknown action', async () => {
    const result = JSON.parse(await runManageTrigger({ action: 'delete' }));
    expect(result.success).toBe(false);
    expect(result.error).toBe('Invalid action');
  });

  describe('create', () => {
    it('validates required fields', async () => {
      const result = JSON.parse(await runManageTrigger({ action: 'create', name: 'x' }));
      expect(result.success).toBe(false);
      expect(result.error).toContain('Missing required parameters');
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('creates an event trigger then disables it (enabled=false default)', async () => {
      fetchMock
        .mockResolvedValueOnce(jsonResponse({ trigger: { id: 't1', name: 'PR', enabled: true } }))
        .mockResolvedValueOnce(jsonResponse({ trigger: { id: 't1', name: 'PR', enabled: false } }));

      const result = JSON.parse(
        await runManageTrigger({
          action: 'create',
          name: 'PR',
          agentId: 'a1',
          prompt: 'review',
          eventConfig: { eventSourceId: 'github-pr' },
        })
      );

      expect(result.success).toBe(true);
      expect(result.trigger.enabled).toBe(false);

      // First call: POST /triggers with type=event
      const [createUrl, createOpts] = fetchMock.mock.calls[0];
      expect(createUrl).toBe('https://api.test/triggers');
      expect(createOpts.method).toBe('POST');
      expect(JSON.parse(createOpts.body).type).toBe('event');

      // Second call: POST /triggers/t1/disable
      const [disableUrl, disableOpts] = fetchMock.mock.calls[1];
      expect(disableUrl).toBe('https://api.test/triggers/t1/disable');
      expect(disableOpts.method).toBe('POST');
    });

    it('forwards auth/id-token/target-user headers', async () => {
      fetchMock
        .mockResolvedValueOnce(jsonResponse({ trigger: { id: 't1', enabled: true } }))
        .mockResolvedValueOnce(jsonResponse({ trigger: { id: 't1', enabled: false } }));

      await runManageTrigger({
        action: 'create',
        name: 'PR',
        agentId: 'a1',
        prompt: 'review',
        eventConfig: { eventSourceId: 'github-pr' },
      });

      const headers = fetchMock.mock.calls[0][1].headers;
      expect(headers.Authorization).toBe('Bearer token');
      expect(headers['X-Amzn-Bedrock-AgentCore-Runtime-Custom-Id-Token']).toBe('id-token');
      expect(headers['X-Target-User-Id']).toBe('user-1');
    });

    it('warns when create succeeds but disable fails', async () => {
      fetchMock
        .mockResolvedValueOnce(jsonResponse({ trigger: { id: 't1', enabled: true } }))
        .mockResolvedValueOnce(jsonResponse({ error: 'boom' }, false, 500));

      const result = JSON.parse(
        await runManageTrigger({
          action: 'create',
          name: 'PR',
          agentId: 'a1',
          prompt: 'review',
          eventConfig: { eventSourceId: 'github-pr' },
        })
      );

      expect(result.success).toBe(true);
      expect(result.warning).toBeDefined();
    });

    it('returns a structured error when create fails', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'bad' }, false, 400));
      const result = JSON.parse(
        await runManageTrigger({
          action: 'create',
          name: 'PR',
          agentId: 'a1',
          prompt: 'review',
          eventConfig: { eventSourceId: 'github-pr' },
        })
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('HTTP 400');
    });
  });

  describe('update', () => {
    it('requires triggerId', async () => {
      const result = JSON.parse(await runManageTrigger({ action: 'update', name: 'x' }));
      expect(result.success).toBe(false);
      expect(result.message).toContain('triggerId is required');
    });

    it('rejects an empty update', async () => {
      const result = JSON.parse(await runManageTrigger({ action: 'update', triggerId: 't1' }));
      expect(result.success).toBe(false);
      expect(result.error).toBe('No fields to update');
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('does not send an enabled field (PUT only carries provided fields)', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ trigger: { id: 't1', name: 'new' } }));
      const result = JSON.parse(
        await runManageTrigger({ action: 'update', triggerId: 't1', name: 'new' })
      );
      expect(result.success).toBe(true);
      const [url, opts] = fetchMock.mock.calls[0];
      expect(url).toBe('https://api.test/triggers/t1');
      expect(opts.method).toBe('PUT');
      expect(JSON.parse(opts.body)).not.toHaveProperty('enabled');
    });
  });

  describe('get', () => {
    it('requires triggerId', async () => {
      const result = JSON.parse(await runManageTrigger({ action: 'get' }));
      expect(result.success).toBe(false);
    });

    it('fetches a single trigger', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ trigger: { id: 't1' } }));
      const result = JSON.parse(await runManageTrigger({ action: 'get', triggerId: 't1' }));
      expect(result.success).toBe(true);
      expect(result.trigger.id).toBe('t1');
      expect(fetchMock.mock.calls[0][1].method).toBe('GET');
    });
  });

  describe('list', () => {
    it('lists triggers', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ triggers: [{ id: 't1' }, { id: 't2' }] }));
      const result = JSON.parse(await runManageTrigger({ action: 'list' }));
      expect(result.success).toBe(true);
      expect(result.count).toBe(2);
      expect(fetchMock.mock.calls[0][0]).toBe('https://api.test/triggers');
    });
  });

  describe('list_event_sources', () => {
    it('lists event sources from /events', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({ eventSources: [{ id: 'github-pr', name: 'GitHub PR', description: '' }] })
      );
      const result = JSON.parse(await runManageTrigger({ action: 'list_event_sources' }));
      expect(result.success).toBe(true);
      expect(result.count).toBe(1);
      expect(fetchMock.mock.calls[0][0]).toBe('https://api.test/events');
    });
  });
});
