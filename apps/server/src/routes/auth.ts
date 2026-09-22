import { z } from 'zod';
import type { FastifyPluginCallbackZod } from '@fastify/type-provider-zod';
import type { ZodTypeProvider } from '@fastify/type-provider-zod';

const AUTH_ATTEMPT_WINDOW_MS = 60_000;
const MAX_AUTH_FAILURES_PER_WINDOW = 10;

interface AuthFailureWindow {
  failures: number;
  resetsAt: number;
}

class AuthAttemptLimiter {
  private readonly windows = new Map<string, AuthFailureWindow>();

  check(key: string): { allowed: boolean; retryAfterSeconds: number } {
    const now = Date.now();
    const window = this.windows.get(key);
    if (!window || now >= window.resetsAt) {
      if (window) this.windows.delete(key);
      return { allowed: true, retryAfterSeconds: 0 };
    }
    return {
      allowed: window.failures < MAX_AUTH_FAILURES_PER_WINDOW,
      retryAfterSeconds: Math.max(1, Math.ceil((window.resetsAt - now) / 1000)),
    };
  }

  recordFailure(key: string): void {
    const now = Date.now();
    if (this.windows.size >= 1_000) {
      for (const [windowKey, window] of this.windows) {
        if (now >= window.resetsAt) this.windows.delete(windowKey);
      }
      if (this.windows.size >= 1_000) {
        const oldestKey = this.windows.keys().next().value as string | undefined;
        if (oldestKey) this.windows.delete(oldestKey);
      }
    }
    const current = this.windows.get(key);
    if (!current || now >= current.resetsAt) {
      this.windows.set(key, { failures: 1, resetsAt: now + AUTH_ATTEMPT_WINDOW_MS });
      return;
    }
    current.failures += 1;
  }

  reset(key: string): void {
    this.windows.delete(key);
  }
}

const pairingConsumeSchema = z.object({
  pairingToken: z.string().min(1),
});

const pairingCreateSchema = z.object({
  label: z.string().trim().min(1).max(100).optional(),
  ttlMs: z
    .number()
    .int()
    .min(30_000)
    .max(15 * 60 * 1000)
    .optional(),
});

export const authRoutes: FastifyPluginCallbackZod = (fastify, _opts, done) => {
  const attemptLimiter = new AuthAttemptLimiter();

  // Check auth status
  fastify.get('/auth/status', (request) => {
    const isDev = fastify.config.NODE_ENV !== 'production';
    const isEmbedded = fastify.embedded;
    const authSessionId = request.session.get('authSessionId');
    const isAuthenticated = authSessionId
      ? fastify.authManager.validateBrowserSession(authSessionId)
      : false;

    return {
      authenticated: isEmbedded || isDev || isAuthenticated,
      authRequired: !isEmbedded && !isDev,
      mode: isEmbedded ? 'embedded' : isDev ? 'development' : 'production',
    };
  });

  // Consume a one-time pairing token
  fastify.withTypeProvider<ZodTypeProvider>().post(
    '/auth/pairing/consume',
    {
      schema: {
        body: pairingConsumeSchema,
      },
    },
    async (request, reply) => {
      const limit = attemptLimiter.check(request.ip);
      if (!limit.allowed) {
        return reply
          .header('Retry-After', limit.retryAfterSeconds)
          .code(429)
          .send({ error: 'Too many authentication attempts. Try again shortly.' });
      }
      const { pairingToken } = request.body;
      try {
        const result = fastify.authManager.consumePairingToken(pairingToken, {
          userAgent: request.headers['user-agent'],
          ip: request.ip,
        });
        request.session.set('authSessionId', result.id);
        request.session.options({
          maxAge: fastify.config.AGENTCTL_PAIRED_SESSION_MAX_AGE_SECONDS,
        });
        attemptLimiter.reset(request.ip);
        return {
          success: true,
          session: {
            id: result.id,
            clientLabel: result.clientLabel,
            expiresAt: new Date(result.expiresAt),
          },
        };
      } catch (err) {
        attemptLimiter.recordFailure(request.ip);
        return reply.code(401).send({
          error: err instanceof Error ? err.message : 'Invalid or expired pairing token',
        });
      }
    },
  );

  // Generate a new pairing token for another device
  fastify.withTypeProvider<ZodTypeProvider>().post(
    '/auth/pairing/create',
    {
      schema: {
        body: pairingCreateSchema,
      },
    },
    (request) => {
      const { label, ttlMs } = request.body;
      const { token, expiresAt } = fastify.authManager.createPairingToken({ label, ttlMs });
      const host = request.headers.host || 'localhost:3000';
      const protocol = request.protocol || 'http';
      const pairingUrl = `${protocol}://${host}/#pairing=${encodeURIComponent(token)}`;

      return {
        token,
        expiresAt,
        pairingUrl,
      };
    },
  );

  // List active connected client sessions
  fastify.get('/auth/sessions', () => {
    return {
      sessions: fastify.authManager.listActiveSessions(),
    };
  });

  // Revoke a specific connected client session
  fastify.delete(
    '/auth/sessions/:id',
    {
      schema: {
        params: z.object({
          id: z.string().min(1),
        }),
      },
    },
    (request, reply) => {
      const { id } = request.params;
      const success = fastify.authManager.revokeSession(id);
      if (!success) {
        return reply.code(404).send({ error: 'Session not found' });
      }
      if (request.session.get('authSessionId') === id) {
        request.session.delete();
      }
      return { success: true };
    },
  );

  fastify.withTypeProvider<ZodTypeProvider>().post('/logout', (request) => {
    const authSessionId = request.session.get('authSessionId');
    if (authSessionId) fastify.authManager.revokeSession(authSessionId);
    request.session.delete();
    return { success: true };
  });

  done();
};
