import { expect, test, vi } from 'vite-plus/test';

const opened = vi.hoisted(() => vi.fn());
vi.mock('node:sqlite', async (original) => {
  const sqlite = await original<typeof import('node:sqlite')>();
  return {
    ...sqlite,
    DatabaseSync: class extends sqlite.DatabaseSync {
      constructor(...args: ConstructorParameters<typeof sqlite.DatabaseSync>) {
        super(...args);
        opened(args[0]);
      }
    },
  };
});

import { createDatabase, getDefaultDatabase, projects } from './index.js';

test('database imports are inert and startup initializes the default only once', () => {
  vi.stubEnv('NODE_ENV', 'test');
  vi.stubEnv('TEST_DATABASE_URL', ':memory:');
  try {
    expect(opened).not.toHaveBeenCalled();
    const isolated = createDatabase(':memory:');
    expect(opened).toHaveBeenCalledTimes(1);
    const application = getDefaultDatabase();
    expect(getDefaultDatabase()).toBe(application);
    expect(application).not.toBe(isolated);
    expect(opened).toHaveBeenCalledTimes(2);
    expect(application.select().from(projects).all()).toEqual([]);
  } finally {
    vi.unstubAllEnvs();
  }
});
