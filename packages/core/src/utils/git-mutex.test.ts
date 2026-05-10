import { describe, it, expect } from 'vitest';
import { GitMutex } from './git-mutex.js';

describe('GitMutex', () => {
  it('should execute tasks sequentially for the same project', async () => {
    const mutex = new GitMutex();
    const results: number[] = [];

    const task1 = mutex.run('project-1', async () => {
      await new Promise(r => setTimeout(r, 50));
      results.push(1);
    });
    const task2 = mutex.run('project-1', async () => {
      results.push(2);
    });

    await Promise.all([task1, task2]);
    expect(results).toEqual([1, 2]);
  });

  it('should execute tasks in parallel for different projects', async () => {
     const mutex = new GitMutex();
     const results: string[] = [];

     const task1 = mutex.run('p1', async () => {
       await new Promise(r => setTimeout(r, 50));
       results.push('p1');
     });
     const task2 = mutex.run('p2', async () => {
       results.push('p2');
     });

     await Promise.all([task1, task2]);
     // p2 should finish first because it didn't wait for p1
     expect(results).toEqual(['p2', 'p1']);
  });
});
