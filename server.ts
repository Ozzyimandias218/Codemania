import net from 'node:net';
import path from 'node:path';
import { createApp } from './src/backend/app.ts';
import { env } from './src/backend/config/env.ts';
import { prisma } from './src/backend/config/prisma.ts';
import { closeRedisConnection } from './src/backend/config/redis.ts';
import { startWorkers, stopWorkers } from './src/backend/jobs/workers.ts';

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
  const dbOk = await isDatabaseReachable();
  const useSandboxFallback = !dbOk && process.env.REQUIRE_POSTGRES !== 'true';

  if (useSandboxFallback) {
    console.warn(
      '[codemania] PostgreSQL is unreachable; starting with in-memory sandbox store.',
    );
  }

  let frontendMiddleware;
  let viteClose: (() => Promise<void>) | null = null;

  if (env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    frontendMiddleware = vite.middlewares;
    viteClose = () => vite.close();
  }

  const app = createApp({
    useSandboxFallback,
    frontendMiddleware,
    staticDistDir: env.NODE_ENV === 'production' ? path.resolve(process.cwd(), 'dist') : undefined,
  });

  if (!useSandboxFallback) {
    await startWorkers();
  }

  const server = app.listen(env.PORT, '0.0.0.0', () => {
    console.info(
      `[codemania] listening on http://0.0.0.0:${env.PORT} (${env.NODE_ENV}, db=${useSandboxFallback ? 'sandbox' : 'postgres'})`,
    );
  });

  const shutdown = async (signal: string) => {
    console.info(`[codemania] received ${signal}, shutting down...`);
    server.close(async () => {
      if (viteClose) await viteClose();
      await stopWorkers();
      await closeRedisConnection();
      if (!useSandboxFallback) {
        await prisma.$disconnect();
      }
      process.exit(0);
    });
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

void bootstrap();
