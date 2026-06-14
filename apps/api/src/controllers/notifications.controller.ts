import { Request, Response, NextFunction } from 'express';
import { prisma } from '../config/database';
import { AppError } from '../utils/AppError';
import { paginate } from '../utils/paginator';

export async function getNotifications(req: Request, res: Response, next: NextFunction) {
  try {
    const { is_read, page = '1', limit = '20' } = req.query as Record<string, string>;
    const where: Record<string, unknown> = { userId: req.user!.id };
    if (is_read != null) where.isRead = is_read === 'true';

    const { data, meta } = await paginate(
      prisma.notification,
      { where, orderBy: { createdAt: 'desc' } },
      { page: parseInt(page), limit: parseInt(limit) }
    );

    const unread = await prisma.notification.count({ where: { userId: req.user!.id, isRead: false } });
    res.json({ success: true, data, meta, unread });
  } catch (err) { next(err); }
}

export async function markRead(req: Request, res: Response, next: NextFunction) {
  try {
    const notif = await prisma.notification.findUnique({ where: { id: req.params.id } });
    if (!notif || notif.userId !== req.user!.id) throw new AppError('Notification introuvable', 404);
    const updated = await prisma.notification.update({
      where: { id: req.params.id },
      data: { isRead: true },
    });
    res.json({ success: true, data: updated });
  } catch (err) { next(err); }
}

export async function markAllRead(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await prisma.notification.updateMany({
      where: { userId: req.user!.id, isRead: false },
      data: { isRead: true },
    });
    res.json({ success: true, data: { updated: result.count } });
  } catch (err) { next(err); }
}
