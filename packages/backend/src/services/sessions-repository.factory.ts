/**
 * Composition root for {@link SessionsRepository}.
 *
 * Mirrors triggers-repository.factory.ts: the repository is `config`-free for
 * testability, and this factory is the single place that binds it to runtime
 * configuration (DynamoDBClient + table name from `config`) and memoises one
 * instance for the API routes.
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { config } from '../config/index.js';
import { SessionsRepository } from '../repositories/sessions-repository.js';

let instance: SessionsRepository | null = null;

/**
 * Get or create the env-bound SessionsRepository singleton.
 */
export function getSessionsRepository(): SessionsRepository {
  if (!instance) {
    instance = new SessionsRepository(
      new DynamoDBClient({ region: config.AWS_REGION }),
      config.SESSIONS_TABLE_NAME
    );
  }
  return instance;
}
