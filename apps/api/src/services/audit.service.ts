import { Request } from 'express';
import { AuditAction } from '@prisma/client';
import { prisma } from '../config/database';
import { logger } from '../utils/logger';

/**
 * Enregistre une action sensible dans le journal d'audit.
 * Ne lève jamais d'exception : un échec d'audit ne doit pas casser la requête métier.
 */
export async function auditLog(
  userId: string,
  action: AuditAction | keyof typeof AuditAction,
  resource: string,
  resourceId?: string,
  details?: unknown,
  req?: Request
): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        userId,
        action: action as AuditAction,
        resource,
        resourceId: resourceId ?? null,
        details: details ? (details as object) : undefined,
        ipAddress: req?.ip ?? req?.socket?.remoteAddress ?? null,
        userAgent: req?.headers['user-agent'] ?? null,
        success:
          typeof details === 'object' && details !== null && 'success' in (details as object)
            ? Boolean((details as { success: unknown }).success)
            : true,
      },
    });
  } catch (err) {
    logger.error('Échec écriture audit log:', err);
  }
}
