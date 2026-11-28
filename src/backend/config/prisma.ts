import { PrismaClient } from '@prisma/client';
import { env } from './env.ts';

declare global {
  var __codemaniaPrisma: PrismaClient | undefined;
}

export const prisma: PrismaClient =
  globalThis.__codemaniaPrisma ??
  new PrismaClient({
    datasources: {
      db: {
        url: env.DATABASE_URL,
      },
    },
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalThis.__codemaniaPrisma = prisma;
}
