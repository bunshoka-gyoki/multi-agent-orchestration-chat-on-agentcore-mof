/**
 * Composition root for {@link TriggersRepository}.
 *
 * The repository is deliberately `config`-free (client + table name injected)
 * so it stays unit/integration-testable against DynamoDB Local. This factory is
 * the single place that binds it to runtime configuration: it builds the
 * `DynamoDBClient` from `config` and memoises one repository instance for the
 * API routes. Keeping this concern here — rather than in the repository — is
 * what prevents `config`'s env validation / `process.exit` from leaking into
 * the testable data-access layer.
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { config } from '../config/index.js';
import { TriggersRepository } from '../repositories/triggers-repository.js';

let instance: TriggersRepository | null = null;

/**
 * Get or create the env-bound TriggersRepository singleton.
 */
export function getTriggersRepository(): TriggersRepository {
  if (!instance) {
    instance = new TriggersRepository(
      new DynamoDBClient({ region: config.AWS_REGION }),
      config.TRIGGERS_TABLE_NAME
    );
  }
  return instance;
}
