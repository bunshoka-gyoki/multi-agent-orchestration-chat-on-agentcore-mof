/**
 * Composition root for the agents repository.
 *
 * The repository is deliberately `config`-free (client + table name injected)
 * so it stays integration-testable against DynamoDB Local. This factory is the
 * single place that binds it to runtime configuration and memoises one instance
 * for the API routes — the same pattern as `triggers-repository.factory.ts`.
 *
 * This is also the ONLY module that reaches into the implementation subtree
 * (`repositories/agents/dynamodb`) to pick a concrete repository. Everything
 * else depends on the `AgentsRepository` interface.
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { config } from '../config/index.js';
import type { AgentsRepository } from '../repositories/agents/index.js';
import { DynamoDBAgentsRepository } from '../repositories/agents/dynamodb/index.js';

let instance: AgentsRepository | null = null;

/** Get or create the env-bound AgentsRepository singleton. */
export function getAgentsRepository(): AgentsRepository {
  if (!instance) {
    instance = new DynamoDBAgentsRepository(
      new DynamoDBClient({ region: config.AWS_REGION }),
      config.AGENTS_TABLE_NAME
    );
  }
  return instance;
}
