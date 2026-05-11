import { buildApp } from './app.js';

const start = async () => {
  const fastify = await buildApp();
  try {
    const port = Number(process.env.PORT ?? 3000);
    const host = process.env.AGENTCTL_HOST ?? '127.0.0.1';
    
    await fastify.listen({ port, host });
    
    // eslint-disable-next-line no-console
    console.log(`Server listening on ${host}:${String(port)}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

void start();
