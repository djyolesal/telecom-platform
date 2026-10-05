import { verifierClotureEnergie } from './vraisemblance.service';
import { prisma } from '../config/database';

/**
 * Un relevé de septembre enregistré en octobre doit être jugé à sa DATE.
 *
 * Comparé au dernier relevé connu - un relevé d'octobre - une saisie correcte
 * déclenchait un faux « l'index recule ». Avec la date de la mesure, on compare
 * à ce qui la précède ET à ce qui la suit.
 */

jest.mock('../config/database', () => ({ prisma: { releveEnergie: { findFirst: jest.fn() } } }));
jest.mock('./settings.service', () => ({ getNum: (_k: string, d: number) => d }));

const findFirst = (prisma as unknown as { releveEnergie: { findFirst: jest.Mock } }).releveEnergie.findFirst;

const SEPT_1 = new Date('2026-09-01T08:00:00Z');
const OCT_1 = new Date('2026-10-01T08:00:00Z');
const MESURE = new Date('2026-09-10T08:00:00Z');
const SITE = { id: 's1', cuveVolumeLitres: 2000, groupes: [{ id: 'g1', numero: 1 }] };

/** Chaîne : un relevé avant la mesure (1er sept.), un après (1er oct.). Sans date : le dernier connu. */
function chaine(champ: 'indexCompteur' | 'indexHeuresGE', avant: number, apres: number) {
  findFirst.mockImplementation(async ({ where }: { where: { dateReleve?: { lt?: Date; gt?: Date } } }) => {
    if (where.dateReleve?.lt) return { [champ]: avant, dateReleve: SEPT_1 };
    if (where.dateReleve?.gt) return { [champ]: apres, dateReleve: OCT_1 };
    return { [champ]: apres, dateReleve: OCT_1 };   // pas de date : le DERNIER relevé connu
  });
}

beforeEach(() => findFirst.mockReset());

describe('vraisemblance d’un relevé daté dans le passé : CEET', () => {
  it('une saisie correcte entre deux relevés ne déclenche aucune alerte', async () => {
    chaine('indexCompteur', 1000, 1600);
    const r = await verifierClotureEnergie(SITE, { indexCompteur: 1250 }, ['CEET'], {}, MESURE);
    expect(r).toEqual([]);
  });

  // Le cœur du défaut corrigé : la comparaison se fait au relevé qui PRÉCÈDE la
  // date de la mesure (et au suivant), jamais au dernier relevé connu.
  it('compare au relevé qui précède la date, pas au dernier relevé connu', async () => {
    chaine('indexCompteur', 1000, 1600);
    await verifierClotureEnergie(SITE, { indexCompteur: 1250 }, ['CEET'], {}, MESURE);
    const wheres = findFirst.mock.calls.map(([a]) => a.where.dateReleve);
    expect(wheres.some((d) => d?.lt && d.lt.getTime() === MESURE.getTime())).toBe(true);
    expect(wheres.some((d) => d?.gt && d.gt.getTime() === MESURE.getTime())).toBe(true);
  });

  it('signale un index SUPÉRIEUR au relevé déjà fait ensuite', async () => {
    chaine('indexCompteur', 1000, 1600);
    const r = await verifierClotureEnergie(SITE, { indexCompteur: 1700 }, ['CEET'], {}, MESURE);
    expect(r).toHaveLength(1);
    expect(r[0].code).toBe('INDEX_CEET_RECULE');
    expect(r[0].message).toContain('déjà relevé ensuite');
  });

  it('signale un index INFÉRIEUR au relevé qui précède', async () => {
    chaine('indexCompteur', 1000, 1600);
    const r = await verifierClotureEnergie(SITE, { indexCompteur: 900 }, ['CEET'], {}, MESURE);
    expect(r.map((a) => a.code)).toEqual(['INDEX_CEET_RECULE']);
    expect(r[0].message).toContain('dernier index connu');
  });

  // Le bond plausible se mesure jusqu'à la DATE DE LA MESURE, pas jusqu'à aujourd'hui.
  it('mesure le bond jusqu’à la date de la mesure, pas jusqu’à aujourd’hui', async () => {
    chaine('indexCompteur', 1000, 99999);
    const unJourApres = new Date('2026-09-02T08:00:00Z');   // 1 jour après le précédent : 2 000 kWh au plus
    const r = await verifierClotureEnergie(SITE, { indexCompteur: 6000 }, ['CEET'], {}, unJourApres);
    expect(r.map((a) => a.code)).toEqual(['CONSO_CEET_ABERRANTE']);
  });
});

describe('vraisemblance d’un relevé daté dans le passé : index horaire du GE', () => {
  const geHours = (v: number) => ({ geHours: { g1: v } });

  it('une saisie correcte entre deux relevés ne déclenche aucune alerte', async () => {
    chaine('indexHeuresGE', 100, 220);
    expect(await verifierClotureEnergie(SITE, geHours(160), ['GE'], {}, MESURE)).toEqual([]);
  });

  it('signale un index horaire supérieur à celui déjà relevé ensuite', async () => {
    chaine('indexHeuresGE', 100, 220);
    const r = await verifierClotureEnergie(SITE, geHours(250), ['GE'], {}, MESURE);
    expect(r.map((a) => a.code)).toEqual(['INDEX_GE_RECULE']);
    expect(r[0].message).toContain('déjà relevé ensuite');
  });

  it('signale un index horaire inférieur à celui qui précède', async () => {
    chaine('indexHeuresGE', 100, 220);
    const r = await verifierClotureEnergie(SITE, geHours(80), ['GE'], {}, MESURE);
    expect(r.map((a) => a.code)).toEqual(['INDEX_GE_RECULE']);
  });
});

describe('sans date de mesure : comportement d’origine inchangé', () => {
  it('compare au dernier relevé connu, sans filtre de date ni contrôle du suivant', async () => {
    findFirst.mockResolvedValue({ indexCompteur: 1000, dateReleve: new Date() });
    await verifierClotureEnergie(SITE, { indexCompteur: 1100 }, ['CEET'], {});
    expect(findFirst).toHaveBeenCalledTimes(1);
    expect(findFirst.mock.calls[0][0].where).not.toHaveProperty('dateReleve');
  });
});
