import { notifierIncidentCoupure, notifierAction, cibleAlerte } from './sms.service';
import { prisma } from '../config/database';
import { getNum } from './settings.service';

/**
 * Alertes des FME bornées à leur zone de maintenance (sms.perimetreZoneFme).
 *
 * Avant : un FME, contact de son prestataire, recevait les alertes de TOUS les
 * sites des lots de sa société. Avec les zones : celles de SA zone seulement -
 * et les autres contacts (superviseur, interne « toutes sociétés ») gardent la
 * règle d'avant. Vérifié sur les SMS réellement journalisés (mode simulé).
 */

jest.mock('../config/database', () => ({
  prisma: {
    site: { findUnique: jest.fn() },
    contact: { findMany: jest.fn() },
    zoneMaintenance: { findMany: jest.fn() },
    user: { findUnique: jest.fn() },
    smsLog: { create: jest.fn().mockResolvedValue({}), count: jest.fn().mockResolvedValue(0) },
  },
}));
jest.mock('../config/env', () => ({ env: { SMS_API_URL: undefined, SMS_API_KEY: 'k', SMS_SENDER: 'EMOPS' } }));
jest.mock('../utils/logger', () => ({ logger: { info: jest.fn(), warn: jest.fn() } }));
jest.mock('./settings.service', () => ({
  getNum: jest.fn((_k: string, d: number) => d),
  getRaw: jest.fn(() => undefined),
  getStr: jest.fn((_k: string, d: string) => d),
}));

const p = prisma as unknown as {
  site: { findUnique: jest.Mock }; contact: { findMany: jest.Mock }; zoneMaintenance: { findMany: jest.Mock };
  user: { findUnique: jest.Mock }; smsLog: { create: jest.Mock };
};

const c = (id: string, tel: string, extra: Record<string, unknown> = {}) => ({
  id, telephone: tel, actif: true, prestataireId: 'ACTIF', toutesSocietes: false,
  notifIncidents: true, notifCoupures: true, notifDemarrage: true, notifCloture: true, notifMaintenances: true, ...extra,
});
const FME_LOME1 = c('fme1', '90000001');
const FME_KARA = c('fme2', '90000002');
const SUPERVISEUR = c('sup', '90000003');
const NOC = c('noc', '90000004', { prestataireId: null, toutesSocietes: true });

const destinataires = () => p.smsLog.create.mock.calls.map(([a]) => a.data.telephone).sort();

beforeEach(() => {
  jest.clearAllMocks();
  (getNum as jest.Mock).mockImplementation((_k: string, d: number) => d);
  p.contact.findMany.mockResolvedValue([FME_LOME1, FME_KARA, SUPERVISEUR, NOC]);
  p.zoneMaintenance.findMany.mockResolvedValue([
    { id: 'z-lome1', responsableContactId: 'fme1' },
    { id: 'z-kara', responsableContactId: 'fme2' },
  ]);
  // Site de LOME 1, dans un lot dont le prestataire ACTIF tient l'actif.
  p.site.findUnique.mockImplementation(async ({ select }) => (select.lot
    ? { lot: { assignments: [{ prestataireId: 'ACTIF', scope: 'ACTIVE' }] } }
    : { zoneMaintenanceId: 'z-lome1' }));
  p.user.findUnique.mockResolvedValue({ nom: 'TECH', prenom: 'Jo', prestataireId: 'ACTIF', prestataire: { nom: 'ACTIF SA' } });
});

describe('coupure partielle sur un site de LOME 1', () => {
  it('FME de LOME 1 prévenu, FME de KARA non ; superviseur et NOC comme avant', async () => {
    await notifierIncidentCoupure('site-1', 'Coupure 4G', 'COUPURE', 'ACTIVE', 'coupures');
    expect(destinataires()).toEqual(['+22890000001', '+22890000003', '+22890000004']);
  });

  it('paramètre à 0 : règle du lot, tous les contacts du prestataire', async () => {
    (getNum as jest.Mock).mockImplementation((k: string, d: number) => (k === 'sms.perimetreZoneFme' ? 0 : d));
    await notifierIncidentCoupure('site-1', 'Coupure 4G', 'COUPURE', 'ACTIVE', 'coupures');
    expect(destinataires()).toEqual(['+22890000001', '+22890000002', '+22890000003', '+22890000004']);
  });

  it('un FME est prévenu pour SA zone même hors du périmètre contractuel de sa société', async () => {
    p.contact.findMany.mockResolvedValue([c('fme1', '90000001', { prestataireId: 'AUTRE' })]);
    await notifierIncidentCoupure('site-1', 'Site tombé', 'INCIDENT', 'PASSIVE', 'incidents');
    expect(destinataires()).toEqual(['+22890000001']);
  });

  it('site sans zone : aucun FME prévenu, les autres contacts oui', async () => {
    p.site.findUnique.mockImplementation(async ({ select }) => (select.lot
      ? { lot: { assignments: [{ prestataireId: 'ACTIF', scope: 'ACTIVE' }] } }
      : { zoneMaintenanceId: null }));
    await notifierIncidentCoupure('site-1', 'Coupure 4G', 'COUPURE', 'ACTIVE', 'coupures');
    expect(destinataires()).toEqual(['+22890000003', '+22890000004']);
  });
});

describe('équipe FME', () => {
  it('un ÉQUIPIER de la zone est prévenu comme le responsable, et pas pour les autres zones', async () => {
    const EQUIPIER = c('eq1', '90000009');
    p.contact.findMany.mockResolvedValue([FME_LOME1, FME_KARA, EQUIPIER]);
    p.zoneMaintenance.findMany.mockResolvedValue([
      { id: 'z-lome1', responsableContactId: 'fme1', membres: [{ contactId: 'eq1' }] },
      { id: 'z-kara', responsableContactId: 'fme2', membres: [] },
    ]);
    await notifierIncidentCoupure('site-1', 'Coupure 4G', 'COUPURE', 'ACTIVE', 'coupures');
    expect(destinataires()).toEqual(['+22890000001', '+22890000009']);
  });
});

describe('démarrage d\'une maintenance', () => {
  it('même règle de zone pour les actions terrain', async () => {
    await notifierAction({ domaine: 'MAINTENANCE', evenement: 'DEMARRAGE', siteNom: 'ABOBO', siteId: 'site-1', technicienId: 't1' });
    expect(destinataires()).toEqual(['+22890000001', '+22890000003', '+22890000004']);
  });
});

describe('cibleAlerte', () => {
  const zones = { actif: true, zonesParContact: new Map([['fme1', new Set(['z1'])]]), zoneDuSite: 'z1' };
  it('contact sans zone : la règle de société décide', () => {
    expect(cibleAlerte('autre', true, zones)).toBe(true);
    expect(cibleAlerte('autre', false, zones)).toBe(false);
  });
  it('FME : sa zone décide, pas la règle de société', () => {
    expect(cibleAlerte('fme1', false, zones)).toBe(true);
    expect(cibleAlerte('fme1', true, { ...zones, zoneDuSite: 'z2' })).toBe(false);
  });
});
