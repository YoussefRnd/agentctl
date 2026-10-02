import { expect, it } from 'vitest';
import { createDatabase, projects } from './index.js';

it('commits synchronous transactions in every supported mode and returns their result', () => {
  const db = createDatabase(':memory:');
  for (const behavior of ['deferred', 'immediate', 'exclusive'] as const) {
    expect(
      db.transaction(
        (tx) => {
          tx.insert(projects).values({ id: behavior, name: behavior, path: '/tmp/project' }).run();
          return behavior;
        },
        { behavior },
      ),
    ).toBe(behavior);
  }
  expect(db.select().from(projects).all()).toHaveLength(3);
});

it('rolls back failed transactions and isolates nested savepoints', () => {
  const db = createDatabase(':memory:');
  expect(() =>
    db.transaction((tx) => {
      tx.insert(projects).values({ id: 'rollback', name: 'rollback', path: '/tmp' }).run();
      throw new Error('failed');
    }),
  ).toThrow('failed');
  expect(db.select().from(projects).all()).toHaveLength(0);
  db.transaction((tx) => {
    tx.insert(projects).values({ id: 'outer', name: 'outer', path: '/tmp' }).run();
    expect(() =>
      tx.transaction((nested) => {
        nested.insert(projects).values({ id: 'inner', name: 'inner', path: '/tmp' }).run();
        nested.rollback();
      }),
    ).toThrow();
  });
  expect(
    db
      .select()
      .from(projects)
      .all()
      .map((project) => project.id),
  ).toEqual(['outer']);
});
