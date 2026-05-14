import { describe, it, expect } from 'vitest';
import { createDatabase } from './index.js';

describe('db', () => {
  it('should create an in-memory database', () => {
    const db = createDatabase(':memory:');
    expect(db).toBeDefined();
  });
});
