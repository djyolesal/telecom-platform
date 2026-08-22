import { Request, Response } from 'express';
import { getCoherenceContacts } from './contacts.controller';

/**
 * Contrôle de cohérence comptes ↔ fiches contact : on vérifie le rapprochement
 * (email > téléphone > nom, dans les deux ordres) et la détection des écarts
 * de numéro/email, Prisma simulé.
 */

jest.mock('../config/database', () => {
  const delegates: Record<string, Record<string, jest.Mock>> = {};
  const prisma = new Proxy({} as Record<string, unknown>, {
    get(_cible, prop: string) {
      if (!delegates[prop]) {
        delegates[prop] = {
          findMany: jest.fn().mockResolvedValue([]),
          findUnique: jest.fn().mockResolvedValue(null),
          create: jest.fn().mockResolvedValue({}),
          update: jest.fn().mockResolvedValue({}),
        };
      }
      return delegates[prop];
    },
  });
  return { prisma };
});

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { prisma } = require('../config/database') as { prisma: Record<string, Record<string, jest.Mock>> };

function contexte() {
  const req = { user: { id: 'admin-1', role: 'ADMIN' } } as unknown as Request;
  const res = { json: jest.fn(), status: jest.fn().mockReturnThis() } as unknown as Response;
  const next = jest.fn();
  return { req, res, next };
}

const user = (u: Partial<Record<string, unknown>>) => ({
  id: 'u1', nom: 'KOSSI', prenom: 'Edem', email: 'edem@telecom.tg', telephone: null, role: 'TECHNICIEN', ...u,
});
const contact = (c: Partial<Record<string, unknown>>) => ({
  id: 'c1', nom: 'KOSSI', prenom: 'Edem', telephone: '+22890111111', email: null, societe: 'NETIS', actif: true, ...c,
});

async function lancer(users: unknown[], contacts: unknown[]) {
  prisma.user.findMany.mockResolvedValueOnce(users);
  prisma.contact.findMany.mockResolvedValueOnce(contacts);
  const { req, res, next } = contexte();
  await getCoherenceContacts(req, res, next);
  expect(next).not.toHaveBeenCalled();
  return (res.json as jest.Mock).mock.calls.at(-1)?.[0].data;
}

describe('cohérence comptes ↔ fiches contact', () => {
  it('rapproche par email et signale un numéro différent', async () => {
    const rows = await lancer(
      [user({ telephone: '+228 90 22 22 22' })],
      [contact({ email: 'EDEM@telecom.tg', nom: 'AUTRE', prenom: 'Nom' })]
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].critere).toBe('email');
    expect(rows[0].ecarts).toEqual([
      { champ: 'telephone', compte: '+228 90 22 22 22', contact: '+22890111111' },
    ]);
  });

  it('rapproche par nom même inversé, et signale compte sans numéro + fiche sans email', async () => {
    const rows = await lancer(
      [user({ nom: 'Edem', prenom: 'KOSSI' })], // ordre inversé côté compte
      [contact({})]
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].critere).toBe('nom');
    expect(rows[0].ecarts).toEqual(expect.arrayContaining([
      { champ: 'telephone', compte: null, contact: '+22890111111' },
      { champ: 'email', compte: 'edem@telecom.tg', contact: null },
    ]));
  });

  it('ne signale rien quand numéro et email concordent malgré les formats', async () => {
    const rows = await lancer(
      [user({ telephone: '90 11 11 11' })], // format local avec espaces
      [contact({ email: 'Edem@Telecom.tg' })]
    );
    expect(rows).toEqual([]);
  });

  it('préfère le rapprochement par téléphone au nom et ne réutilise pas une fiche', async () => {
    const rows = await lancer(
      [
        user({ id: 'u1', telephone: '+22890111111', email: 'edem@x.tg' }), // match téléphone
        user({ id: 'u2', nom: 'KOSSI', prenom: 'Edem', email: 'homonyme@x.tg' }), // même nom → fiche déjà prise
      ],
      [contact({ email: 'autre@x.tg' })]
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].userId).toBe('u1');
    expect(rows[0].critere).toBe('telephone');
    expect(rows[0].ecarts).toEqual([{ champ: 'email', compte: 'edem@x.tg', contact: 'autre@x.tg' }]);
  });
});
