import { buildApp } from './app.js';
import { createDatabase, type CoreDatabase } from '@agentctl/core/db';
import { parseServerEnv } from '@agentctl/shared';
import type { FastifyInstance } from 'fastify';

export interface TestAppOptions {
  db?: CoreDatabase;
  env?: Record<string, string>;
}

export async function createTestApp(options: TestAppOptions = {}): Promise<{
  app: FastifyInstance;
  db: CoreDatabase;
}> {
  const db = options.db ?? createDatabase(':memory:');
  const env = parseServerEnv({
    AGENTCTL_SECRET: 'test-secret',
    AGENTCTL_SESSION_KEY: 'test-session-key-test-session-key-123456',
    AGENTCTL_SESSION_SALT: 'test-session-sal',
    PORT: '0',
    ...options.env,
  });

  const app = await buildApp({
    db,
    env,
  });

  return { app, db };
}
