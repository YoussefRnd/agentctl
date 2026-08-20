import { z } from 'zod';
import type { FastifyPluginCallbackZod } from '@fastify/type-provider-zod';
import type { ZodTypeProvider } from '@fastify/type-provider-zod';

const pairingConsumeSchema = z.object({
  pairingToken: z.string().min(1),
});

const pairingCreateSchema = z.object({
  label: z.string().optional(),
  ttlMs: z.number().optional(),
});

const loginSchema = z.object({
  secret: z.string().min(1),
});

export const authRoutes: FastifyPluginCallbackZod = (fastify, _opts, done) => {
  // Check auth status
  fastify.get('/auth/status', (request) => {
    const isDev = process.env.NODE_ENV !== 'production';
    const isEmbedded = fastify.embedded;
    const isAuthenticated = !!request.session.get('authenticated');

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
      const { pairingToken } = request.body;
      try {
        const result = fastify.authManager.consumePairingToken(pairingToken, {
          userAgent: request.headers['user-agent'],
          ip: request.ip,
        });
        request.session.set('authenticated', true);
        request.session.options({ maxAge: 30 * 24 * 60 * 60 }); // 30 days
        return result;
      } catch (err) {
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
      const pairingUrl = `${protocol}://${host}/#token=${token}`;

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
      return { success: true };
    },
  );

  // Traditional login fallback
  fastify.withTypeProvider<ZodTypeProvider>().post(
    '/login',
    {
      schema: {
        body: loginSchema,
      },
    },
    async (request, reply) => {
      const { secret } = request.body;

      // Try consuming as pairing token first
      try {
        const result = fastify.authManager.consumePairingToken(secret, {
          userAgent: request.headers['user-agent'],
          ip: request.ip,
        });
        request.session.set('authenticated', true);
        request.session.options({ maxAge: 30 * 24 * 60 * 60 });
        return { success: true, sessionToken: result.sessionToken };
      } catch {
        // Check if matching startup token
        if (secret === fastify.authManager.getStartupToken()) {
          const direct = fastify.authManager.createDirectSession({
            userAgent: request.headers['user-agent'],
            ip: request.ip,
          });
          request.session.set('authenticated', true);
          request.session.options({ maxAge: 30 * 24 * 60 * 60 });
          return { success: true, sessionToken: direct.sessionToken };
        }

        // Check dev secret in dev mode
        if (process.env.NODE_ENV !== 'production' && secret === 'dev-secret') {
          const direct = fastify.authManager.createDirectSession({
            userAgent: request.headers['user-agent'],
            ip: request.ip,
          });
          request.session.set('authenticated', true);
          return { success: true, sessionToken: direct.sessionToken };
        }

        return reply.code(401).send({ error: 'Invalid or expired pairing code' });
      }
    },
  );

  fastify.withTypeProvider<ZodTypeProvider>().post('/logout', (request) => {
    request.session.delete();
    return { success: true };
  });

  done();
};
