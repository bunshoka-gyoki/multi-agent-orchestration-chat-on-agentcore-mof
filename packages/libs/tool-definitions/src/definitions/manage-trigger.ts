import { z } from 'zod';
import { zodToJsonSchema } from '../utils/schema-converter.js';
import { GATEWAY_TOOL_NAMES, RUNTIME_TOOL_NAMES } from '../tool-names.js';
import type { ToolDefinition } from '../types.js';

/**
 * Event subscription config. `eventSourceId` identifies which registered event
 * source the trigger subscribes to (obtain valid ids via the
 * `list_event_sources` action). Additive keys (e.g. `eventBusName`,
 * `eventPattern`) are passed through to match the Backend's permissive
 * eventConfig schema.
 */
const eventConfigSchema = z
  .object({
    eventSourceId: z
      .string()
      .describe('Registered event source id to subscribe to (see list_event_sources action)'),
  })
  .passthrough();

export const manageTriggerSchema = z.object({
  action: z
    .enum(['create', 'update', 'get', 'list', 'list_event_sources'])
    .describe(
      "Action: 'create' a new event trigger, 'update' an existing one, 'get' a single trigger, 'list' the caller's triggers, 'list_event_sources' to discover valid event sources"
    ),

  // Trigger ID (required for update/get)
  triggerId: z.string().optional().describe('Trigger ID (required for update/get actions)'),

  // Trigger configuration (required for create, optional for update)
  name: z.string().optional().describe('Human-readable trigger name'),
  description: z.string().optional().describe('Brief description of what this trigger does'),
  agentId: z.string().optional().describe('ID of the agent to invoke when the event fires'),
  prompt: z.string().optional().describe('Prompt passed to the agent on invocation'),
  eventConfig: eventConfigSchema
    .optional()
    .describe('Event subscription config; eventSourceId is required for event triggers'),
  enabledTools: z
    .array(z.string())
    .optional()
    .describe(
      `Array of tool names the invoked agent may use (e.g. ["${RUNTIME_TOOL_NAMES.EXECUTE_COMMAND}", "${GATEWAY_TOOL_NAMES.TAVILY_SEARCH}"])`
    ),
  modelId: z.string().optional().describe('Model ID override for the invocation (optional)'),
  workingDirectory: z
    .string()
    .optional()
    .describe('Working directory for the invoked agent (optional)'),
});

export const manageTriggerDefinition: ToolDefinition<typeof manageTriggerSchema> = {
  name: RUNTIME_TOOL_NAMES.MANAGE_TRIGGER,
  description: `Create, update, retrieve, or list event-driven triggers that invoke an agent when an external event fires.

**Available Actions:**
- 'create': Create a new event trigger
- 'update': Modify an existing trigger (partial update)
- 'get': Retrieve a single trigger by id
- 'list': List the caller's triggers
- 'list_event_sources': List available event sources so you can pick a valid eventConfig.eventSourceId

**For 'create' action (required parameters):**
- name: Human-readable trigger name
- agentId: Which agent to invoke
- prompt: Prompt passed to the agent
- eventConfig.eventSourceId: The event source to subscribe to (use 'list_event_sources' first)
- enabledTools, modelId, workingDirectory (optional)

**Important:** Newly created triggers are always disabled (enabled=false). A human must
enable them via the Triggers UI before they start firing. This tool cannot enable, disable,
or delete triggers.

**For 'update' action:**
- triggerId (required): ID of the trigger to update
- Any combination of: name, description, agentId, prompt, eventConfig, enabledTools, modelId, workingDirectory
- Only provided fields are updated (partial update). The enabled state is never changed by this tool.

**For 'get' action:**
- triggerId (required): ID of the trigger to retrieve

**Returns:**
- For create/update/get: the trigger configuration
- For list: an array of triggers
- For list_event_sources: an array of available event sources (id, name, description)`,
  zodSchema: manageTriggerSchema,
  jsonSchema: zodToJsonSchema(manageTriggerSchema),
};
