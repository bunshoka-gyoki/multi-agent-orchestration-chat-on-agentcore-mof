/**
 * Sessions Repository — DynamoDB data-access layer for user session metadata.
 *
 * Like {@link TriggersRepository}, this module is free of any dependency on
 * `config/index.ts`: the `DynamoDBClient` and table name are injected via the
 * constructor (DI) so it can be pointed at DynamoDB Local in tests. The
 * env-bound production singleton lives in
 * `services/sessions-repository.factory.ts`.
 *
 * The backend only reads/deletes sessions; rows are written by the agent
 * package's SessionsService.
 */

import {
  DynamoDBClient,
  QueryCommand,
  DeleteItemCommand,
  GetItemCommand,
  type AttributeValue,
} from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import type { AgentId, IdentityId } from '@moca/core';
import { createLogger } from '../libs/logger/index.js';
// Import directly from the pagination submodule (not the libs/http barrel) to
// keep this repository's dependency surface minimal and config-free.
import { encodePageToken } from '../libs/http/pagination.js';

const logger = createLogger('SessionsRepository');

/**
 * Session type
 */
export type SessionType = 'user' | 'event' | 'subagent';

/**
 * Session data stored in DynamoDB
 */
export interface SessionData {
  userId: IdentityId;
  sessionId: string;
  title: string;
  agentId?: AgentId;
  storagePath?: string;
  sessionType?: SessionType;
  createdAt: string;
  updatedAt: string;
}

/**
 * Session summary for frontend display
 */
export interface SessionSummary {
  sessionId: string;
  title: string;
  agentId?: AgentId;
  storagePath?: string;
  sessionType?: SessionType;
  createdAt: string;
  updatedAt: string;
}

/**
 * Session list result with pagination
 */
export interface SessionListResult {
  sessions: SessionSummary[];
  nextToken?: string;
  hasMore: boolean;
}

/**
 * Sessions Repository.
 *
 * Construct with an explicit `DynamoDBClient` and table name. In production the
 * singleton in `services/sessions-repository.factory.ts` builds the client from
 * `config`; in tests the client is pointed at DynamoDB Local.
 */
export class SessionsRepository {
  private readonly client: DynamoDBClient;
  private readonly tableName: string;

  constructor(client: DynamoDBClient, tableName: string) {
    this.client = client;
    this.tableName = tableName;
  }

  /**
   * Whether the repository is wired to a table. Routes call this to short-
   * circuit with a CONFIGURATION_ERROR (or skip optional work) before invoking
   * the data methods, so the methods themselves assume a configured table —
   * matching {@link TriggersRepository}, which carries no per-method guards.
   */
  isConfigured(): boolean {
    return !!this.tableName;
  }

  /**
   * List sessions for a user (sorted by updatedAt descending)
   */
  async listSessions(
    userId: IdentityId,
    maxResults: number = 50,
    exclusiveStartKey?: Record<string, unknown>
  ): Promise<SessionListResult> {
    try {
      const result = await this.client.send(
        new QueryCommand({
          TableName: this.tableName,
          IndexName: 'userId-updatedAt-index',
          KeyConditionExpression: 'userId = :userId',
          ExpressionAttributeValues: marshall({ ':userId': userId }),
          ScanIndexForward: false, // Sort descending (newest first)
          Limit: maxResults,
          // The caller decodes/validates the opaque page token (→ 400 on a
          // malformed token); here we receive the already-parsed key. The token
          // is the previously-emitted (marshalled) LastEvaluatedKey, so it is a
          // valid AttributeValue map for this low-level QueryCommand.
          ExclusiveStartKey: exclusiveStartKey as Record<string, AttributeValue> | undefined,
        })
      );

      const sessions: SessionSummary[] = (result.Items || []).map((item) => {
        const data = unmarshall(item) as SessionData;
        return {
          sessionId: data.sessionId,
          title: data.title,
          agentId: data.agentId,
          storagePath: data.storagePath,
          sessionType: data.sessionType,
          createdAt: data.createdAt,
          updatedAt: data.updatedAt,
        };
      });

      const hasMore = !!result.LastEvaluatedKey;
      // Use the shared encoder (same base64(JSON) format the triggers route
      // uses and that the sessions route's decodePageToken expects) so the
      // opaque token format has a single source of truth.
      const newNextToken = encodePageToken(result.LastEvaluatedKey);

      logger.info(`Listed ${sessions.length} sessions for user ${userId}`);

      return {
        sessions,
        nextToken: newNextToken,
        hasMore,
      };
    } catch (error) {
      logger.error({ err: error }, 'Error listing sessions:');
      throw error;
    }
  }

  /**
   * Get a single session
   */
  async getSession(userId: IdentityId, sessionId: string): Promise<SessionData | null> {
    try {
      const result = await this.client.send(
        new GetItemCommand({
          TableName: this.tableName,
          Key: marshall({ userId, sessionId }),
        })
      );

      if (!result.Item) {
        return null;
      }

      return unmarshall(result.Item) as SessionData;
    } catch (error) {
      logger.error({ err: error }, 'Error getting session:');
      throw error;
    }
  }

  /**
   * Delete a session from DynamoDB
   */
  async deleteSession(userId: IdentityId, sessionId: string): Promise<void> {
    try {
      await this.client.send(
        new DeleteItemCommand({
          TableName: this.tableName,
          Key: marshall({ userId, sessionId }),
        })
      );

      logger.info(`Deleted session ${sessionId} for user ${userId}`);
    } catch (error) {
      logger.error({ err: error }, 'Error deleting session:');
      throw error;
    }
  }
}
