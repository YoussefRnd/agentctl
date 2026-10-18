import { describe, it, expect, beforeEach, afterEach } from 'vite-plus/test';
import { buildApp } from '../app.js';
import { createDatabase } from '@agentctl/core/db';
import { projects, sessions } from '@agentctl/core/db';
import type { FastifyInstance } from 'fastify';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

describe('Attachments Routes', () => {
  let app: FastifyInstance;
  const testSessionId = 'sess-attachment-test-1';

  beforeEach(async () => {
    const db = createDatabase(':memory:');

    await db.insert(projects).values({
      id: 'proj-1',
      name: 'Test Project',
      path: '/tmp/test-proj',
    });

    await db.insert(sessions).values({
      id: testSessionId,
      projectId: 'proj-1',
      branch: 'main',
      worktreePath: '/tmp/test-proj',
      taskSlug: 'test-slug',
      baseCommit: 'c0ffee',
      agent: 'test-agent',
      selectedProvider: 'default',
      status: 'idle',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    app = await buildApp({
      db,
      embedded: true,
    });
  });

  afterEach(async () => {
    await app.close();
    const sessionAttachmentsDir = path.join(os.tmpdir(), 'agentctl-attachments', testSessionId);
    if (fs.existsSync(sessionAttachmentsDir)) {
      fs.rmSync(sessionAttachmentsDir, { recursive: true, force: true });
    }
  });

  it('uploads a valid image and retrieves it successfully', async () => {
    const dummyPng = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

    const uploadRes = await app.inject({
      method: 'POST',
      url: `/api/sessions/${testSessionId}/attachments`,
      headers: {
        'content-type': 'image/png',
        'x-filename': encodeURIComponent('screenshot.png'),
      },
      payload: dummyPng,
    });

    expect(uploadRes.statusCode).toBe(201);
    const body = uploadRes.json() as {
      attachmentId: string;
      mimeType: string;
      filename: string;
      sizeBytes: number;
    };
    expect(body.attachmentId).toBeDefined();
    expect(body.mimeType).toBe('image/png');
    expect(body.filename).toBe('screenshot.png');
    expect(body.sizeBytes).toBe(dummyPng.length);

    // Fetch the uploaded attachment
    const getRes = await app.inject({
      method: 'GET',
      url: `/api/sessions/${testSessionId}/attachments/${body.attachmentId}`,
    });

    expect(getRes.statusCode).toBe(200);
    expect(getRes.headers['content-type']).toBe('image/png');
    expect(getRes.rawPayload).toEqual(dummyPng);
  });

  it('returns 415 for unsupported media types', async () => {
    const uploadRes = await app.inject({
      method: 'POST',
      url: `/api/sessions/${testSessionId}/attachments`,
      headers: {
        'content-type': 'application/pdf',
      },
      payload: Buffer.from('dummy pdf'),
    });

    expect(uploadRes.statusCode).toBe(415);
  });

  it('returns 404 for nonexistent session', async () => {
    const uploadRes = await app.inject({
      method: 'POST',
      url: `/api/sessions/nonexistent-session/attachments`,
      headers: {
        'content-type': 'image/png',
      },
      payload: Buffer.from('dummy'),
    });

    expect(uploadRes.statusCode).toBe(404);
  });

  it('rejects content that does not match the declared image type', async () => {
    const uploadRes = await app.inject({
      method: 'POST',
      url: `/api/sessions/${testSessionId}/attachments`,
      headers: {
        'content-type': 'image/png',
      },
      payload: Buffer.from('<script>alert("not an image")</script>'),
    });

    expect(uploadRes.statusCode).toBe(400);
  });
});
