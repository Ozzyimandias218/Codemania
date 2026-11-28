import type { Express, RequestHandler } from 'express';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { env } from './src/backend/config/env.ts';

function isTcpReachable(host: string, port: number, timeoutMs = 1000): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    let done = false;
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.on('connect', () => finish(true));
    socket.on('timeout', () => finish(false));
    socket.on('error', () => finish(false));
  });
}

async function isDatabaseReachable(): Promise<boolean> {
  const rawUrl = process.env.DATABASE_URL?.trim();
  if (!rawUrl || (!rawUrl.startsWith('postgresql://') && !rawUrl.startsWith('postgres://'))) {
    if (process.env.REQUIRE_POSTGRES !== 'true') {
      return false;
    }
  }

  try {
    const parsed = new URL(env.DATABASE_URL);
    const port = parsed.port ? Number(parsed.port) : 5432;
    const tcpOk = await isTcpReachable(parsed.hostname, port, 1000);
    if (!tcpOk) {
      return false;
    }

    const { prisma } = await import('./src/backend/config/prisma.ts');
    await Promise.race([
      prisma.$queryRaw`SELECT 1`,
      new Promise((_, reject) => setTimeout(() => reject(new Error('DB ping timeout')), 1500)),
    ]);
    return true;
  } catch {
    return false;
  }
}

async function bootstrap() {
  const isDev = env.NODE_ENV !== 'production';

  const vitePromise = isDev
    ? import('vite').then(({ createServer: createViteServer }) =>
        createViteServer({
          server: { middlewareMode: true },
          appType: 'spa',
        }),
      )
    : null;

  if (vitePromise) {
    vitePromise.catch((err) => {
      console.error('[codemania] Vite dev middleware failed to initialize:', err);
    });
  }

  let useSandboxFallback = true;

  const appPromise: Promise<Express> = (async () => {
    const [{ createApp }, dbOk] = await Promise.all([
      import('./src/backend/app.ts'),
      isDatabaseReachable(),
    ]);
    useSandboxFallback = !dbOk && process.env.REQUIRE_POSTGRES !== 'true';

    if (useSandboxFallback) {
      console.warn(
        '[codemania] PostgreSQL is unreachable; starting with in-memory sandbox store.',
      );
    }

    const frontendMiddleware: RequestHandler | undefined = vitePromise
      ? (req, res, next) => {
          vitePromise
            .then((vite) => vite.middlewares(req, res, next))
            .catch(next);
        }
      : undefined;

    const app = createApp({
      useSandboxFallback,
      frontendMiddleware,
      staticDistDir: !isDev ? path.resolve(process.cwd(), 'dist') : undefined,
    });

    if (!useSandboxFallback) {
      const { startWorkers } = await import('./src/backend/jobs/workers.ts');
      await startWorkers();
    }

    return app;
  })();

  appPromise.catch((err) => {
    console.error('[codemania] Fatal initialization error:', err);
    process.exit(1);
  });

  const server = http.createServer((req, res) => {
    appPromise
      .then((app) => app(req, res))
      .catch((err) => {
        console.error('[codemania] Request handler failed:', err);
        if (!res.headersSent) {
          res.statusCode = 500;
          res.end('Internal Server Error');
        }
      });
  });

  server.on('error', (err) => {
    console.error('[codemania] HTTP server failed to bind:', err);
    process.exit(1);
  });

  server.listen(env.PORT, '0.0.0.0', () => {
    console.info(
      `[codemania] listening on http://0.0.0.0:${env.PORT} (${env.NODE_ENV})`,
    );
  });

  const shutdown = async (signal: string) => {
    console.info(`[codemania] received ${signal}, shutting down...`);
    server.close(async () => {
      if (vitePromise) {
        const vite = await vitePromise.catch(() => null);
        if (vite) await vite.close();
      }
      const { stopWorkers } = await import('./src/backend/jobs/workers.ts');
      const { closeRedisConnection } = await import('./src/backend/config/redis.ts');
      await stopWorkers();
      await closeRedisConnection();
      if (!useSandboxFallback) {
        const { prisma } = await import('./src/backend/config/prisma.ts');
        await prisma.$disconnect();
      }
      process.exit(0);
    });
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

bootstrap().catch((err) => {
  console.error('[codemania] Fatal startup error:', err);
  process.exit(1);
});
