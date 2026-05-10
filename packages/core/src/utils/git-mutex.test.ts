import { describe, it, expect } from 'vitest';
import { GitMutex } from './git-mutex.js';

describe('GitMutex', () => {
  it('should execute tasks sequentially for the same project', async () => {
    const mutex = new GitMutex();
    const results: number[] = [];

    const task1 = mutex.run('project-1', async () => {
      await new Promise((r) => setTimeout(r, 50));
      results.push(1);
    });
    const task2 = mutex.run('project-1', () => {
      results.push(2);
      return Promise.resolve();
    });

    await Promise.all([task1, task2]);
    expect(results).toEqual([1, 2]);
  });

  it('should execute tasks in parallel for different projects', async () => {
    const mutex = new GitMutex();
    const results: string[] = [];

    const task1 = mutex.run('p1', async () => {
      await new Promise((r) => setTimeout(r, 50));
      results.push('p1');
    });
    const task2 = mutex.run('p2', () => {
      results.push('p2');
      return Promise.resolve();
    });

    await Promise.all([task1, task2]);
    // p2 should finish first because it didn't wait for p1
    expect(results).toEqual(['p2', 'p1']);
  });

  it('should isolate errors (task failure should not block subsequent tasks)', async () => {
    const mutex = new GitMutex();
    const results: string[] = [];

    const task1 = mutex.run('project-1', () => {
      return Promise.reject(new Error('Task 1 failed'));
    });

    const task2 = mutex.run('project-1', () => {
      results.push('task-2');
      return Promise.resolve('success');
    });

    await expect(task1).rejects.toThrow('Task 1 failed');
    const res2 = await task2;

    expect(results).toEqual(['task-2']);
    expect(res2).toBe('success');
  });

  it('should cleanup the queue map when idle', async () => {
    const mutex = new GitMutex();
    const projectId = 'project-1';

    const task = mutex.run(projectId, () => {
      expect(mutex.isPending(projectId)).toBe(true);
      return Promise.resolve();
    });

    await task;
    expect(mutex.isPending(projectId)).toBe(false);
  });

  it('should return the value of the task', async () => {
    const mutex = new GitMutex();
    const result = await mutex.run('project-1', () => {
      return Promise.resolve(42);
    });
    expect(result).toBe(42);
  });
});
