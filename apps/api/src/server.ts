import { buildApp } from './app.js';
import { env } from './config/env.js';
import { connectToDatabase, disconnectFromDatabase } from './db/connection.js';

export async function startServer(): Promise<void> {
  // Connect to MongoDB before accepting network requests
  try {
    await connectToDatabase(env.MONGODB_URI);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Fatal: Failed to connect to MongoDB during server startup: ${message}`);
    process.exit(1);
  }

  const app = await buildApp();

  try {
    const address = await app.listen({ port: env.PORT, host: env.HOST });
    app.log.info(`Decision OS API listening at ${address}`);
  } catch (err) {
    app.log.error(err);
    await disconnectFromDatabase();
    process.exit(1);
  }

  const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM'];
  for (const signal of signals) {
    process.on(signal, async () => {
      app.log.info(`Received ${signal}, closing server gracefully...`);
      await app.close();
      await disconnectFromDatabase();
      process.exit(0);
    });
  }
}

if (process.env.NODE_ENV !== 'test') {
  startServer();
}
