/**
 * Unit tests for Manage Trigger tool definition
 */

import { manageTriggerDefinition, manageTriggerSchema } from '../definitions/manage-trigger';

describe('Manage Trigger Tool Definition', () => {
  it('should have correct tool name', () => {
    expect(manageTriggerDefinition.name).toBe('manage_trigger');
  });

  it('should expose the supported actions only', () => {
    const accepted = ['create', 'update', 'get', 'list', 'list_event_sources'];
    for (const action of accepted) {
      expect(manageTriggerSchema.shape.action.safeParse(action).success).toBe(true);
    }
    // Out-of-scope actions must be rejected
    for (const action of ['delete', 'enable', 'disable']) {
      expect(manageTriggerSchema.shape.action.safeParse(action).success).toBe(false);
    }
  });

  it('should document that created triggers are disabled by default', () => {
    expect(manageTriggerDefinition.description).toContain('enabled=false');
  });

  it('should require action in the JSON schema', () => {
    expect(manageTriggerDefinition.jsonSchema.required).toContain('action');
  });

  it('should accept a valid create input', () => {
    const result = manageTriggerSchema.safeParse({
      action: 'create',
      name: 'PR opened',
      agentId: 'agent-1',
      prompt: 'Review the PR',
      eventConfig: { eventSourceId: 'github-pr' },
    });
    expect(result.success).toBe(true);
  });

  it('should require eventConfig.eventSourceId when eventConfig is provided', () => {
    const result = manageTriggerSchema.safeParse({
      action: 'create',
      eventConfig: {},
    });
    expect(result.success).toBe(false);
  });

  it('should pass through additive eventConfig keys', () => {
    const result = manageTriggerSchema.safeParse({
      action: 'create',
      eventConfig: { eventSourceId: 'github-pr', eventBusName: 'default' },
    });
    expect(result.success).toBe(true);
  });

  it('should reject an unknown action', () => {
    const result = manageTriggerSchema.safeParse({ action: 'delete' });
    expect(result.success).toBe(false);
  });

  it('should be included in allToolDefinitions', async () => {
    const { allToolDefinitions } = await import('../definitions/index');
    expect(allToolDefinitions.find((def) => def.name === 'manage_trigger')).toBeDefined();
  });

  it('should be included in allMCPToolDefinitions', async () => {
    const { allMCPToolDefinitions } = await import('../definitions/index');
    const mcp = allMCPToolDefinitions.find((def) => def.name === 'manage_trigger');
    expect(mcp).toBeDefined();
    expect(mcp?.inputSchema).toEqual(manageTriggerDefinition.jsonSchema);
  });
});
