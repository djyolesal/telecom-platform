import { enregistrerReleveHorsApp } from './releveHorsApp.service';
import { prisma } from '../config/database';
import { enregistrerAnomalies, verifierClotureEnergie } from './vraisemblance.service';
import { SaisieHorsApp } from '../utils/saisieHorsApp';

/**
 * Relevé pris hors application, inséré dans une chaîne de relevés existants.
 *
 * L'invariant gardé ici : les rapports ADDITIONNENT les consommations stockées
 * sur chaque relevé. Insérer un relevé entre deux autres sans recalculer le
 * suivant ferait compter deux fois la période qu'ils couvrent.
 */

jest.mock('../config/database', () => {
  const releveEnergie = { findFirst: jest.fn(), create: jest.fn(), update: jest.fn() };
  const tx = {
    $executeRaw: jest.fn().mockResolvedValue(0),
    releveEnergie,
    depotage: { aggregate: jest.fn().mockResolvedValue({ _sum: { volumeLitres: 0 } }) },
  };
  return {
    prisma: {
      site: { findUnique: jest.fn() },
      user: { findUnique: jest.fn() },
      $transaction: jest.fn(async (cb: (t: unknown) => unknown) => cb(tx)),
      __tx: tx,
    },
  };
});
jest.mock('./vraisemblance.service', () => ({
  verifierClotureEnergie: jest.fn().mockResolvedValue([]),
  enregistrerAnomalies: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('./cuve.service', () => ({
  configCuveDuSite: jest.fn().mockResolvedValue({}),
  litresPourHauteur: jest.fn().mockReturnValue(null),
}));
jest.mock('./settings.service', () => ({ getNum: (_k: string, d: number) => d }));
jest.mock('../utils/memo', () => ({ clearMemo: jest.fn() }));

const p = prisma as unknown as {
  site: { findUnique: jest.Mock };
  user: { findUnique: jest.Mock };
  $transaction: jest.Mock;
  __tx: {
    $executeRaw: jest.Mock;
    releveEnergie: { findFirst: jest.Mock; create: jest.Mock; update: jest.Mock };
    depotage: { aggregate: jest.Mock };
  };
};
const rel = () => p.__tx.releveEnergie;

const SITE = {
  id: 's1', nom: 'Site A', isActive: true, powerConfig: 'CEET_GE', cuveVolumeLitres: 2000,
  groupes: [{ id: 'g1', numero: 1 }],
};
const DATE = new Date('2026-09-10T08:00:00Z');
const saisie = (o: Partial<SaisieHorsApp> = {}): SaisieHorsApp => ({
  siteId: 's1', dateReleve: DATE, technicienId: null, observations: null,
  ceet: { indexCompteur: 1250 }, solaire: null, ge: null, ...o,
});

/** Réponses successives de `findFirst` pour la chaîne CEET : doublon, précédent, suivant. */
const chaineCeet = (prec: unknown, suiv: unknown) => {
  rel().findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(prec).mockResolvedValueOnce(suiv);
};

beforeEach(() => {
  jest.clearAllMocks();
  p.site.findUnique.mockResolvedValue(SITE);
  p.user.findUnique.mockResolvedValue({ id: 't1' });
  rel().findFirst.mockReset();
  rel().create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'new', source: data.source, groupeId: data.groupeId ?? null }));
  (verifierClotureEnergie as jest.Mock).mockResolvedValue([]);
});

describe('insertion d’un relevé dans la chaîne : rien n’est compté deux fois', () => {
  it('écrit la consommation du nouveau relevé ET recalcule celle de son successeur', async () => {
    chaineCeet(
      { id: 'p', indexCompteur: '1000', dateReleve: new Date('2026-09-01') },
      { id: 'suiv', indexCompteur: '1600', consommationKwh: '600', coutEstime: 63000, dateReleve: new Date('2026-10-01') },
    );
    const r = await enregistrerReleveHorsApp(saisie(), 'admin1', false);

    expect(r.statut).toBe('ENREGISTRE');
    expect(rel().create.mock.calls[0][0].data).toMatchObject({
      source: 'CEET', indexCompteur: 1250, consommationKwh: 250, origine: 'HORS_APP', saisiParId: 'admin1',
    });
    // Le successeur comptait 600 kWh depuis le précédent : il en compte 350 depuis ce relevé.
    expect(rel().update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'suiv' }, data: expect.objectContaining({ consommationKwh: 350 }),
    }));
    // 250 + 350 = 600 : la période est comptée une fois.
  });

  // Un successeur qui n'avait AUCUNE consommation (relevé autonome du portail)
  // n'en reçoit pas : lui en fabriquer ferait apparaître dans les rapports une
  // consommation qui n'y était pas.
  it('ne touche pas à un successeur qui ne portait pas de consommation', async () => {
    chaineCeet(
      { id: 'p', indexCompteur: '1000', dateReleve: new Date('2026-09-01') },
      { id: 'suiv', indexCompteur: '1600', consommationKwh: null, dateReleve: new Date('2026-10-01') },
    );
    await enregistrerReleveHorsApp(saisie(), 'admin1', false);
    expect(rel().update).not.toHaveBeenCalled();
  });

  it('sans relevé précédent, la consommation est inconnue (null), pas zéro', async () => {
    chaineCeet(null, null);
    await enregistrerReleveHorsApp(saisie(), 'admin1', false);
    expect(rel().create.mock.calls[0][0].data.consommationKwh).toBeNull();
    expect(rel().update).not.toHaveBeenCalled();
  });

  it('un relevé en fin de chaîne (aucun successeur) n’a rien à recalculer', async () => {
    chaineCeet({ id: 'p', indexCompteur: '1000', dateReleve: new Date('2026-09-01') }, null);
    await enregistrerReleveHorsApp(saisie(), 'admin1', false);
    expect(rel().create.mock.calls[0][0].data.consommationKwh).toBe(250);
    expect(rel().update).not.toHaveBeenCalled();
  });

  it('verrouille le site le temps de l’écriture', async () => {
    chaineCeet(null, null);
    await enregistrerReleveHorsApp(saisie(), 'admin1', false);
    expect(p.__tx.$executeRaw).toHaveBeenCalled();
  });
});

describe('relevé hors application : confirmation et refus', () => {
  const alerte = [{ code: 'INDEX_CEET_RECULE', champ: 'indexCompteur', message: 'recule' }];

  it('une valeur inhabituelle non confirmée n’écrit RIEN', async () => {
    (verifierClotureEnergie as jest.Mock).mockResolvedValue(alerte);
    const r = await enregistrerReleveHorsApp(saisie(), 'admin1', false);
    expect(r).toEqual({ statut: 'CONFIRMATION_REQUISE', avertissements: alerte });
    expect(p.$transaction).not.toHaveBeenCalled();
    expect(rel().create).not.toHaveBeenCalled();
  });

  it('confirmée, elle s’écrit et l’anomalie est tracée comme confirmée', async () => {
    (verifierClotureEnergie as jest.Mock).mockResolvedValue(alerte);
    chaineCeet(null, null);
    const r = await enregistrerReleveHorsApp(saisie(), 'admin1', true);
    expect(r.statut).toBe('ENREGISTRE');
    expect(enregistrerAnomalies).toHaveBeenCalledWith(alerte, expect.objectContaining({ source: 'RELEVE', confirmee: true }));
  });

  // Le contrôle compare à la DATE de la mesure, pas au dernier relevé connu.
  it('contrôle la vraisemblance À LA DATE de la mesure', async () => {
    chaineCeet(null, null);
    await enregistrerReleveHorsApp(saisie(), 'admin1', false);
    expect((verifierClotureEnergie as jest.Mock).mock.calls[0][4]).toEqual(DATE);
  });

  it('refuse une mesure que le site ne peut pas avoir', async () => {
    await expect(enregistrerReleveHorsApp(saisie({ ceet: null, solaire: { puissanceKva: 3 } }), 'admin1', false))
      .rejects.toMatchObject({ statusCode: 422, message: expect.stringContaining('production solaire') });
    expect(p.$transaction).not.toHaveBeenCalled();
  });

  it('refuse un relevé en double au même instant', async () => {
    rel().findFirst.mockResolvedValueOnce({ id: 'deja' });
    await expect(enregistrerReleveHorsApp(saisie(), 'admin1', false)).rejects.toMatchObject({ statusCode: 409 });
    expect(rel().create).not.toHaveBeenCalled();
  });

  it('refuse un site désactivé ou inconnu', async () => {
    p.site.findUnique.mockResolvedValueOnce(null);
    await expect(enregistrerReleveHorsApp(saisie(), 'a', false)).rejects.toMatchObject({ statusCode: 404 });
    p.site.findUnique.mockResolvedValueOnce({ ...SITE, isActive: false });
    await expect(enregistrerReleveHorsApp(saisie(), 'a', false)).rejects.toMatchObject({ statusCode: 422 });
  });

  it('refuse un technicien inconnu', async () => {
    p.user.findUnique.mockResolvedValueOnce(null);
    await expect(enregistrerReleveHorsApp(saisie({ technicienId: 'fantome' }), 'a', false))
      .rejects.toMatchObject({ statusCode: 422, message: expect.stringContaining('Technicien') });
  });

  it('refuse un index horaire rattaché à un groupe qui n’est pas sur le site', async () => {
    await expect(enregistrerReleveHorsApp(
      saisie({ ceet: null, ge: { volumeGasoilLitres: null, hauteurCuveCm: null, groupes: [{ groupeId: 'autre', indexHeuresGE: 100 }] } }),
      'a', false,
    )).rejects.toMatchObject({ statusCode: 422, message: expect.stringContaining('inconnu') });
  });

  it('un site à un seul groupe n’oblige pas à le désigner', async () => {
    rel().findFirst.mockResolvedValue(null);
    const r = await enregistrerReleveHorsApp(
      saisie({ ceet: null, ge: { volumeGasoilLitres: null, hauteurCuveCm: null, groupes: [{ groupeId: null, indexHeuresGE: 160 }] } }),
      'a', false,
    );
    expect(r.statut).toBe('ENREGISTRE');
    expect(rel().create.mock.calls[0][0].data.groupeId).toBe('g1');
  });

  it('une hauteur seule, sur une cuve sans barème, demande le volume en litres', async () => {
    await expect(enregistrerReleveHorsApp(
      saisie({ ceet: null, ge: { volumeGasoilLitres: null, hauteurCuveCm: 42, groupes: [] } }), 'a', false,
    )).rejects.toMatchObject({ statusCode: 422, message: expect.stringContaining('barème') });
  });
});
