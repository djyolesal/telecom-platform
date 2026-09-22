import {
  resoudreIncidentSiPlusDeCoupure,
  promouvoirOrphelinesApresRetablissement,
  motifRefusRattachement,
} from './coupuresReseau.controller';

/**
 * Rebouclage coupure → incident : la résolution ne doit JAMAIS précéder
 * l'ouverture (contrainte SQL incidents_resolution_apres_ouverture). Cas réel
 * KPERGOU/BASSADJI : incident créé à la PRISE EN CHARGE, coupure clôturée
 * ensuite avec un rétablissement antérieur — la clôture partait en 500.
 */

jest.mock('../server', () => ({ io: { of: () => ({ emit: jest.fn() }), emit: jest.fn() } }));
jest.mock('../config/database', () => {
  const delegates: Record<string, Record<string, jest.Mock>> = {};
  const prisma = new Proxy({} as Record<string, unknown>, {
    get(_c, prop: string) {
      if (prop === '$queryRaw' || prop === '$executeRaw') return jest.fn().mockResolvedValue([]);
      if (prop === '$transaction') return jest.fn();
      if (!delegates[prop]) {
        delegates[prop] = {
          findMany: jest.fn().mockResolvedValue([]),
          findUnique: jest.fn().mockResolvedValue(null),
          findFirst: jest.fn().mockResolvedValue(null),
          count: jest.fn().mockResolvedValue(0),
          create: jest.fn().mockResolvedValue({}),
          update: jest.fn().mockResolvedValue({}),
          updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        };
      }
      return delegates[prop];
    },
  });
  return { prisma };
});

function fauxTx(incident: Record<string, unknown>, coupuresOuvertes = 0) {
  const update = jest.fn().mockResolvedValue({});
  const tx = {
    coupureReseau: { count: jest.fn().mockResolvedValue(coupuresOuvertes) },
    incident: { findUnique: jest.fn().mockResolvedValue(incident), update },
  };
  return { tx: tx as never, update };
}

describe('resoudreIncidentSiPlusDeCoupure', () => {
  const ouverture = new Date('2026-08-25T12:30:00Z');

  it('rétablissement ANTÉRIEUR à l’ouverture : résolution bornée, durée 0 (plus de 500)', async () => {
    const { tx, update } = fauxTx({ statut: 'OUVERT', dateOuverture: ouverture, dateIntervention: null, actionCorrective: null });
    const resolu = await resoudreIncidentSiPlusDeCoupure(tx, 'inc1', new Date('2026-08-25T12:07:00Z'));
    expect(resolu).toBe(true);
    const data = update.mock.calls[0][0].data;
    expect(data.dateResolution).toEqual(ouverture);
    expect(data.dureeCoupureMinutes).toBe(0);
    expect(data.actionCorrective).toContain('Rétablissement constaté par le NOC');
  });

  it('rétablissement postérieur : dates réelles conservées', async () => {
    const { tx, update } = fauxTx({ statut: 'EN_COURS', dateOuverture: ouverture, dateIntervention: new Date(), actionCorrective: 'GE redémarré' });
    const fin = new Date('2026-08-25T13:15:00Z');
    await resoudreIncidentSiPlusDeCoupure(tx, 'inc1', fin);
    const data = update.mock.calls[0][0].data;
    expect(data.dateResolution).toEqual(fin);
    expect(data.dureeCoupureMinutes).toBe(45);
    expect(data.actionCorrective).toBeUndefined(); // intervention réelle : on ne l'écrase pas
  });

  it('des coupures encore ouvertes : incident laissé tel quel', async () => {
    const { tx, update } = fauxTx({ statut: 'OUVERT', dateOuverture: ouverture, dateIntervention: null, actionCorrective: null }, 2);
    const resolu = await resoudreIncidentSiPlusDeCoupure(tx, 'inc1', new Date());
    expect(resolu).toBe(false);
    expect(update).not.toHaveBeenCalled();
  });
});

/**
 * Délai de grâce du reclassement (cas terrain 09/2026) : un site tombe et
 * entraîne 5 avals ; quand l'amont se rétablit, les avals mettent quelques
 * minutes à se réenregistrer. Sans délai, le balayage les DÉTACHAIT juste
 * avant qu'ils ne remontent — l'entraînement disparaissait de l'historique et
 * chacun héritait d'un « cause locale à qualifier » faux.
 */
describe('promouvoirOrphelinesApresRetablissement', () => {
  const dbFictive = () => {
    const findMany = jest.fn().mockResolvedValue([]);
    return { db: { coupureReseau: { findMany, update: jest.fn() } } as never, findMany };
  };

  it('n’affranchit un aval que si son amont est rétabli depuis le délai réglé', async () => {
    const { db, findMany } = dbFictive();
    const avant = Date.now();
    await promouvoirOrphelinesApresRetablissement(db);
    const où = findMany.mock.calls[0][0].where;
    // Le tri se fait en base : la racine doit être close AVANT le seuil.
    const seuil = où.coupureOrigine.dateFin.lt as Date;
    const minutes = (avant - seuil.getTime()) / 60_000;
    expect(minutes).toBeGreaterThan(19.9);
    expect(minutes).toBeLessThan(20.5);
    // Et on ne touche toujours qu'aux héritées encore ouvertes.
    expect(où.dateFin).toBeNull();
    expect(où.origine).toBe('HERITEE');
  });
});

/**
 * Rattachement MANUEL après coup : le NOC comprend parfois une fois la panne
 * passée qu'un site n'était qu'un écho de l'amont. On l'autorise sur une
 * coupure clôturée, mais pas n'importe comment — sinon n'importe quelle panne
 * pourrait être imputée à n'importe quelle autre.
 */
describe('motifRefusRattachement', () => {
  const d = (iso: string) => new Date(`2026-09-20T${iso}:00Z`);
  const FENETRE = 60;

  it('accepte un aval clôturé qui suit son amont clôturé', () => {
    const aval = { dateDebut: d('10:05'), dateFin: d('11:10') };
    const racine = { dateDebut: d('10:00'), dateFin: d('11:00') };
    expect(motifRefusRattachement(aval, racine, FENETRE)).toBeNull();
  });

  it('accepte un aval tombé AVANT son amont dans la fenêtre (batterie plus petite)', () => {
    const aval = { dateDebut: d('09:20'), dateFin: d('11:10') };
    const racine = { dateDebut: d('10:00'), dateFin: d('11:00') };
    expect(motifRefusRattachement(aval, racine, FENETRE)).toBeNull();
  });

  it('refuse un aval tombé bien avant l’amont : deux pannes distinctes', () => {
    const aval = { dateDebut: d('07:00'), dateFin: d('11:10') };
    const racine = { dateDebut: d('10:00'), dateFin: d('11:00') };
    expect(motifRefusRattachement(aval, racine, FENETRE)).toMatch(/180 min avant/);
  });

  it('refuse deux périodes qui ne se recouvrent pas', () => {
    const aval = { dateDebut: d('12:00'), dateFin: d('13:00') };
    const racine = { dateDebut: d('10:00'), dateFin: d('11:00') };
    expect(motifRefusRattachement(aval, racine, FENETRE)).toMatch(/ne se recouvrent pas/);
  });

  it('refuse de rattacher un site ENCORE coupé à un amont déjà rétabli', () => {
    const aval = { dateDebut: d('10:05'), dateFin: null };
    const racine = { dateDebut: d('10:00'), dateFin: d('11:00') };
    // Sinon le balayage de reclassement le détacherait au passage suivant.
    expect(motifRefusRattachement(aval, racine, FENETRE)).toMatch(/déjà rétabli/);
  });

  it('accepte deux coupures encore ouvertes (cas historique, inchangé)', () => {
    const aval = { dateDebut: d('10:05'), dateFin: null };
    const racine = { dateDebut: d('10:00'), dateFin: null };
    expect(motifRefusRattachement(aval, racine, FENETRE, d('11:30'))).toBeNull();
  });
});
