import { buildApp } from './app.js';
import { env } from './config/env.js';

export async function startServer(): Promise<void> {
  const app = await buildApp();

  try {
    const address = await app.listen({ port: env.PORT, host: env.HOST });
    app.log.info(`Decision OS API listening at ${address}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }

  const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM'];
  for (const signal of signals) {
    process.on(signal, async () => {
      app.log.info(`Received ${signal}, closing server gracefully...`);
      await app.close();
      process.exit(0);
    });
  }
}

if (process.env.NODE_ENV !== 'test') {
  startServer();
}
