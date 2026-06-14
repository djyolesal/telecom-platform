/**
 * Pagination générique pour les delegates Prisma.
 *
 * Usage :
 *   const { data, meta } = await paginate(
 *     prisma.site,
 *     { where, orderBy, include },
 *     { page, limit }
 *   );
 */

export interface PaginationParams {
  page: number;
  limit: number;
}

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

interface PrismaDelegate {
  // `any` est requis ici : les signatures génériques des delegates Prisma
  // ne sont pas compatibles avec un type de paramètre plus strict (contravariance).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  findMany: (args: any) => Promise<any[]>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  count: (args: any) => Promise<number>;
}

export async function paginate<T = unknown>(
  model: PrismaDelegate,
  query: Record<string, unknown>,
  { page, limit }: PaginationParams
): Promise<{ data: T[]; meta: PaginationMeta }> {
  const safePage = Math.max(1, page || 1);
  const safeLimit = Math.min(200, Math.max(1, limit || 20));
  const skip = (safePage - 1) * safeLimit;

  const where = (query.where as Record<string, unknown>) ?? {};

  const [data, total] = await Promise.all([
    model.findMany({ ...query, skip, take: safeLimit }),
    model.count({ where }),
  ]);

  const totalPages = Math.ceil(total / safeLimit) || 1;

  return {
    data: data as T[],
    meta: {
      page: safePage,
      limit: safeLimit,
      total,
      totalPages,
      hasNext: safePage < totalPages,
      hasPrev: safePage > 1,
    },
  };
}
