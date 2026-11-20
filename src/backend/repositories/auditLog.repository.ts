import { Prisma } from '@prisma/client';
import { prisma } from '../config/prisma.ts';

export class AuditLogRepository {
  async create(
    data: {
      actorUserId: string;
      entityType: string;
      entityId: string;
      action: string;
      reason?: string | null;
      changes: Prisma.InputJsonValue;
    },
    tx: Prisma.TransactionClient = prisma,
  ) {
    return tx.auditLog.create({ data });
  }

  async listRecent(limit = 100) {
    return prisma.auditLog.findMany({
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: {
        actor: { select: { id: true, email: true, name: true } },
      },
    });
  }
}

export const auditLogRepository = new AuditLogRepository();
