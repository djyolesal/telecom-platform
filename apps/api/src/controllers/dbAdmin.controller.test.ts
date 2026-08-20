import { Request, Response } from 'express';
import * as ctrl from './dbAdmin.controller';
import { AppError } from '../utils/AppError';

/**
 * Contrôleurs de la console base de données, Prisma simulé : ces tests
 * vérifient ce qui part RÉELLEMENT à la base (filtres, tri, pagination) et les
 * refus attendus, sans exiger de serveur Postgres.
 */

jest.mock('../config/database', () => {
  const delegates: Record<string, Record<string, jest.Mock>> = {};
  const prisma = new Proxy({} as Record<string, unknown>, {
    get(_cible, prop: string) {
      if (prop === '$queryRaw') return jest.fn().mockResolvedValue([]);
      if (!delegates[prop]) {
        delegates[prop] = {
          findMany: jest.fn().mockResolvedValue([]),
          findUnique: jest.fn().mockResolvedValue(null),
          count: jest.fn().mockResolvedValue(0),
          create: jest.fn().mockResolvedValue({ id: 'nouveau' }),
          update: jest.fn().mockResolvedValue({ id: 'modifie' }),
          delete: jest.fn().mockResolvedValue({}),
        };
      }
      return delegates[prop];
    },
  });
  return { prisma, __delegates: delegates };
});

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { prisma } = require('../config/database') as { prisma: Record<string, Record<string, jest.Mock>> };

function contexte(params: Record<string, string>, query: Record<string, unknown> = {}, body: unknown = {}) {
  const req = { params, query, body, user: { id: 'admin-1', role: 'ADMIN' }, headers: {} } as unknown as Request;
  const res = { json: jest.fn(), status: jest.fn().mockReturnThis() } as unknown as Response;
  const next = jest.fn();
  return { req, res, next };
}

/** Dernier appel à findMany du delegate d'un modèle. */
const dernierFindMany = (cle: string) => prisma[cle].findMany.mock.calls.at(-1)?.[0];

describe('lecture d’une table', () => {
  it('pagine, trie et recherche côté base', async () => {
    const { req, res, next } = contexte({ modele: 'Site' }, { page: '3', limit: '10', q: 'lome', tri: 'nom', sens: 'asc' });
    await ctrl.listerLignes(req, res, next);

    expect(next).not.toHaveBeenCalled();
    const args = dernierFindMany('site');
    expect(args.skip).toBe(20);
    expect(args.take).toBe(10);
    expect(args.orderBy).toEqual({ nom: 'asc' });
    const ou = args.where.AND[0].OR as Array<Record<string, unknown>>;
    expect(ou).toContainEqual({ nom: { contains: 'lome', mode: 'insensitive' } });
    // L'empreinte du mot de passe n'entre jamais dans une sélection.
    expect(args.select.passwordHash).toBeUndefined();
  });

  it('ignore un champ de tri inventé et retombe sur un ordre sûr', async () => {
    const { req, res, next } = contexte({ modele: 'Site' }, { tri: 'DROP TABLE sites' });
    await ctrl.listerLignes(req, res, next);
    expect(dernierFindMany('site').orderBy).toEqual({ createdAt: 'desc' });
  });

  it('applique un filtre d’enum et rejette une valeur hors liste', async () => {
    const { req, res, next } = contexte({ modele: 'Maintenance' }, { f_statut: 'TERMINEE', f_type: 'INVENTÉ' });
    await ctrl.listerLignes(req, res, next);
    const clauses = dernierFindMany('maintenance').where.AND as Array<Record<string, unknown>>;
    expect(clauses).toContainEqual({ statut: 'TERMINEE' });
    expect(clauses.some((c) => 'type' in c)).toBe(false);
  });

  it('remplace les uuid des clés étrangères par un libellé lisible', async () => {
    prisma.maintenance.findMany.mockResolvedValueOnce([{ id: 'm1', siteId: 's1' }]);
    prisma.site.findMany.mockResolvedValueOnce([{ id: 's1', nom: 'Lomé-Centre', code: 'LOM01' }]);
    const { req, res, next } = contexte({ modele: 'Maintenance' });
    await ctrl.listerLignes(req, res, next);

    const reponse = (res.json as jest.Mock).mock.calls[0][0];
    expect(reponse.relations.siteId.s1).toBe('Lomé-Centre — LOM01');
  });

  it('refuse une table absente du catalogue', async () => {
    const { req, res, next } = contexte({ modele: 'pg_shadow' });
    await ctrl.listerLignes(req, res, next);
    expect(next.mock.calls[0][0]).toBeInstanceOf(AppError);
    expect((next.mock.calls[0][0] as AppError).statusCode).toBe(404);
  });
});

describe('écriture', () => {
  it('crée une ligne et la journalise', async () => {
    prisma.prestataire.create.mockResolvedValueOnce({ id: 'p1', nom: 'ACME' });
    const { req, res, next } = contexte({ modele: 'Prestataire' }, {}, { nom: 'ACME' });
    await ctrl.creerLigne(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(prisma.prestataire.create.mock.calls[0][0].data).toEqual({ nom: 'ACME' });
    const audit = prisma.auditLog.create.mock.calls.at(-1)?.[0].data;
    expect(audit).toMatchObject({ action: 'CREATE', resource: 'db:Prestataire', resourceId: 'p1' });
  });

  it('ne transmet que les champs modifiables', async () => {
    prisma.site.findUnique.mockResolvedValueOnce({ id: 's1', nom: 'Avant' });
    prisma.site.update.mockResolvedValueOnce({ id: 's1', nom: 'Après' });
    const { req, res, next } = contexte({ modele: 'Site' }, {}, { nom: 'Après', id: 'usurpé', createdAt: '2020-01-01' });
    await ctrl.modifierLigne(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(prisma.site.update.mock.calls[0][0].data).toEqual({ nom: 'Après' });
  });

  it('journalise le diff avant/après d’une modification', async () => {
    prisma.site.findUnique.mockResolvedValueOnce({ id: 's1', nom: 'Avant' });
    prisma.site.update.mockResolvedValueOnce({ id: 's1', nom: 'Après' });
    const { req, res, next } = contexte({ modele: 'Site' }, {}, { nom: 'Après' });
    await ctrl.modifierLigne(req, res, next);

    const audit = prisma.auditLog.create.mock.calls.at(-1)?.[0].data;
    expect(audit.action).toBe('UPDATE');
    expect(audit.details.diff.nom).toEqual({ avant: 'Avant', apres: 'Après' });
  });

  it('interdit toute écriture sur le journal d’audit', async () => {
    const { req, res, next } = contexte({ modele: 'AuditLog', id: 'a1' }, {}, { action: 'LOGIN' });
    await ctrl.supprimerLigne(req, res, next);
    expect((next.mock.calls[0][0] as AppError).statusCode).toBe(403);
    expect(prisma.auditLog.delete).not.toHaveBeenCalled();
  });

  it('annonce les lignes emportées par une suppression en cascade', async () => {
    prisma.maintenance.findUnique.mockResolvedValueOnce({ id: 'm1' });
    prisma.pieceRechange.count.mockResolvedValueOnce(3);
    const { req, res, next } = contexte({ modele: 'Maintenance', id: 'm1' });
    await ctrl.impactLigne(req, res, next);

    const impacts = (res.json as jest.Mock).mock.calls[0][0].data;
    expect(impacts).toContainEqual(
      expect.objectContaining({ modele: 'PieceRechange', champ: 'maintenanceId', action: 'Cascade', lignes: 3 })
    );
  });
});
