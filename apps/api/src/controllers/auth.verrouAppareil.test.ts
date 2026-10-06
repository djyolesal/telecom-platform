import { Request, Response } from 'express';
import { login, refreshToken } from './auth.controller';
import jwt from 'jsonwebtoken';
import { redisClient } from '../config/redis';
import { sessionValide } from '../services/session.service';
import { auditLog } from '../services/audit.service';
import { prisma } from '../config/database';

/**
 * Verrou d'appareil au login : un compte terrain se lie au PREMIER téléphone
 * qui se connecte, et un téléphone ne sert qu'à un compte.
 *
 * Ces cas n'étaient couverts par aucun test : un décalage du versionCode par
 * architecture avait armé le verrou sur des identifiants de firmware, et le
 * second technicien d'un même modèle de téléphone était refusé.
 */

jest.mock('../config/database', () => ({
  prisma: { user: { findUnique: jest.fn(), findFirst: jest.fn(), update: jest.fn(), updateMany: jest.fn() } },
}));
jest.mock('../config/redis', () => ({ redisClient: { setEx: jest.fn().mockResolvedValue('OK'), set: jest.fn().mockResolvedValue('OK'), get: jest.fn(), del: jest.fn() } }));
jest.mock('../services/audit.service', () => ({ auditLog: jest.fn() }));
jest.mock('../services/email.service', () => ({ sendEmail: jest.fn() }));
jest.mock('../services/session.service', () => ({
  enregistrerSession: jest.fn(), effacerSession: jest.fn(), sessionValide: jest.fn(), revoquerToutesSessions: jest.fn(),
}));
jest.mock('jsonwebtoken', () => ({
  __esModule: true,
  default: { sign: jest.fn().mockReturnValue('jeton'), verify: jest.fn() },
}));
const reglages: Record<string, number> = {};
jest.mock('../services/settings.service', () => ({ getNum: (k: string, d: number) => reglages[k] ?? d }));
jest.mock('bcrypt', () => ({ __esModule: true, default: { compare: jest.fn().mockResolvedValue(true), hash: jest.fn(), hashSync: jest.fn().mockReturnValue('leurre') } }));

const p = prisma as unknown as {
  user: { findUnique: jest.Mock; findFirst: jest.Mock; update: jest.Mock; updateMany: jest.Mock };
};

const UUID_A = '11111111-1111-4111-8111-111111111111';
const UUID_B = '22222222-2222-4222-8222-222222222222';
const BUILD_ID = 'TP1A.220624.014';   // Build.ID d'un modèle : le même sur tous ses exemplaires

const technicien = (o: Record<string, unknown> = {}) => ({
  id: 'u1', nom: 'Kossi', prenom: 'Edem', email: 'e@x.tg', role: 'TECHNICIEN', region: null,
  passwordHash: 'h', isActive: true, appareilId: null, appareilLabel: null, ...o,
});

async function connecter(version: string | undefined, deviceId: string | undefined, role = 'TECHNICIEN') {
  const req = {
    body: { email: 'e@x.tg', password: 'x', platform: 'MOBILE', ...(deviceId !== undefined ? { deviceId, deviceLabel: 'TECNO CL6k' } : {}) },
    headers: version ? { 'x-app-version': version } : {},
    ip: '127.0.0.1',
  } as unknown as Request;
  const res = { json: jest.fn(), status: jest.fn().mockReturnThis(), cookie: jest.fn() } as unknown as Response;
  const next = jest.fn();
  p.user.findUnique.mockResolvedValue(technicien({ role }));
  await login(req, res, next);
  return { next, res };
}
const refus = (next: jest.Mock) => (next.mock.calls[0]?.[0] as { statusCode?: number; message?: string } | undefined);
const lie = () => p.user.update.mock.calls.some(([a]) => a.data?.appareilId !== undefined);

beforeEach(() => {
  jest.clearAllMocks();
  p.user.findFirst.mockResolvedValue(null);
  p.user.update.mockResolvedValue({ id: 'u1' });
  p.user.updateMany.mockResolvedValue({ count: 1 });
});

describe('verrou d’appareil au login', () => {
  it('b49 arm64 (versionCode 2049) : le compte se lie à son UUID', async () => {
    const { next } = await connecter('1.8.0+2049', UUID_A);
    expect(refus(next)).toBeUndefined();
    expect(p.user.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ appareilId: UUID_A }),
    }));
  });

  it('b49 armeabi-v7a (versionCode 1049) : se lie aussi', async () => {
    await connecter('1.8.0+1049', UUID_A);
    expect(lie()).toBe(true);
  });

  it('un téléphone déjà lié à un autre compte est refusé', async () => {
    p.user.findFirst.mockResolvedValue({ id: 'u2', nom: 'Lawson', prenom: 'Komla' });
    const { next } = await connecter('1.8.0+2049', UUID_A);
    expect(refus(next)).toMatchObject({ statusCode: 403, message: expect.stringContaining('déjà lié à un autre compte') });
    expect(lie()).toBe(false);
  });

  it('un compte lié à un autre téléphone est refusé (réinstallation : nouvel UUID)', async () => {
    p.user.findUnique.mockResolvedValue(technicien({ appareilId: UUID_A, appareilLabel: 'TECNO CL6k' }));
    const req = { body: { email: 'e@x.tg', password: 'x', platform: 'MOBILE', deviceId: UUID_B }, headers: { 'x-app-version': '1.8.0+2049' }, ip: '1' } as unknown as Request;
    const next = jest.fn();
    await login(req, { json: jest.fn(), status: jest.fn().mockReturnThis(), cookie: jest.fn() } as unknown as Response, next);
    expect(refus(next)).toMatchObject({ statusCode: 403, message: expect.stringContaining('lié à un autre appareil') });
  });

  it('un compte reconnecté depuis SON téléphone passe, sans réécrire la liaison', async () => {
    p.user.findUnique.mockResolvedValue(technicien({ appareilId: UUID_A }));
    const req = { body: { email: 'e@x.tg', password: 'x', platform: 'MOBILE', deviceId: UUID_A }, headers: { 'x-app-version': '1.8.0+2049' }, ip: '1' } as unknown as Request;
    const next = jest.fn();
    await login(req, { json: jest.fn(), status: jest.fn().mockReturnThis(), cookie: jest.fn() } as unknown as Response, next);
    expect(refus(next)).toBeUndefined();
    expect(lie()).toBe(false);
  });

  it('un compte terrain qui n’envoie pas d’identifiant est refusé (le verrou n’est pas déclaratif)', async () => {
    const { next } = await connecter('1.8.0+2049', undefined);
    expect(refus(next)).toMatchObject({ statusCode: 403 });
  });
});

describe('verrou d’appareil : APK anciens', () => {
  // LE DÉFAUT CORRIGÉ. Un b46 arm64 rapporte versionCode 2046 et envoie le
  // Build.ID de son modèle : il ne doit NI lier NI refuser.
  it('b46 arm64 (2046) avec un Build.ID : ni liaison, ni refus', async () => {
    const { next } = await connecter('1.8.0+2046', BUILD_ID);
    expect(refus(next)).toBeUndefined();
    expect(lie()).toBe(false);
  });

  it('deux techniciens d’un même modèle, sur b46, se connectent tous les deux', async () => {
    p.user.findFirst.mockResolvedValue({ id: 'u2', nom: 'Lawson', prenom: 'Komla' });   // « déjà pris » : ne doit pas être consulté
    const { next } = await connecter('1.8.0+2046', BUILD_ID);
    expect(refus(next)).toBeUndefined();
    expect(p.user.findFirst).not.toHaveBeenCalled();
  });

  it('un APK muet (b43) n’est ni lié ni refusé', async () => {
    const { next } = await connecter(undefined, BUILD_ID);
    expect(refus(next)).toBeUndefined();
    expect(lie()).toBe(false);
  });

  // Seconde protection : même si le numéro de build était mal lu, un identifiant
  // qui n'a pas la forme d'un UUID ne désigne aucun téléphone.
  it('un Build.ID n’arme jamais le verrou, même avec un build déclaré récent', async () => {
    const { next } = await connecter('1.8.0+2049', BUILD_ID);
    expect(refus(next)).toBeUndefined();
    expect(lie()).toBe(false);
    expect(p.user.findFirst).not.toHaveBeenCalled();
  });
});

describe('verrou d’appareil : périmètre', () => {
  it('ne concerne ni les superviseurs ni les managers', async () => {
    for (const role of ['SUPERVISEUR', 'MANAGER', 'ADMIN']) {
      p.user.update.mockClear();
      const { next } = await connecter('1.8.0+2049', UUID_A, role);
      expect(refus(next)).toBeUndefined();
      expect(lie()).toBe(false);
    }
  });

  it('s’applique au transporteur', async () => {
    await connecter('1.8.0+2049', UUID_A, 'TRANSPORTEUR');
    expect(lie()).toBe(true);
  });
});

describe('version enregistrée', () => {
  it('s’écrit sans le décalage par architecture', async () => {
    await connecter('1.8.0+2049', UUID_A);
    expect(p.user.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ appVersion: '1.8.0+49' }),
    }));
  });
});


describe('renouvellement de jeton : téléphone non lié', () => {
  // La liaison ne se fait qu'au login ; une session de 30 jours laisse passer un
  // technicien qui a mis l'APK à jour sans se reconnecter. Un réglage, éteint par
  // défaut, lui demande de se reconnecter une fois.
  const R = redisClient as unknown as { get: jest.Mock; setEx: jest.Mock };

  async function renouveler(o: { version?: string; role?: string; appareilId?: string | null; plt?: 'MOBILE' | 'WEB' }) {
    (jwt.verify as jest.Mock).mockReturnValue({ sub: 'u1', sid: 's1', plt: o.plt ?? 'MOBILE' });
    R.get.mockResolvedValue('jeton-refresh');
    (sessionValide as jest.Mock).mockResolvedValue(true);
    p.user.findUnique.mockResolvedValue({ id: 'u1', role: o.role ?? 'TECHNICIEN', isActive: true, appareilId: o.appareilId ?? null });
    const req = { body: { refreshToken: 'jeton-refresh' }, headers: o.version ? { 'x-app-version': o.version } : {}, ip: '1' } as unknown as Request;
    const json = jest.fn();
    const next = jest.fn();
    await refreshToken(req, { json } as unknown as Response, next);
    return { json, next };
  }

  beforeEach(() => { for (const k of Object.keys(reglages)) delete reglages[k]; });

  it('réglage éteint (défaut) : rien ne change, même pour un téléphone non lié', async () => {
    const { json, next } = await renouveler({ version: '1.8.0+49' });
    expect(next).not.toHaveBeenCalled();
    expect(json).toHaveBeenCalled();
  });

  describe('réglage allumé', () => {
    beforeEach(() => { reglages['auth.reconnexionSiAppareilNonLie'] = 1; });

    it('demande une reconnexion à un technicien b49 dont le téléphone n’est pas lié', async () => {
      const { json, next } = await renouveler({ version: '1.8.0+49' });
      expect(json).not.toHaveBeenCalled();
      expect(next.mock.calls[0][0]).toMatchObject({ statusCode: 401, message: expect.stringContaining('reconnectez-vous') });
      expect(auditLog).toHaveBeenCalledWith('u1', 'LOGIN', 'auth', undefined, expect.objectContaining({ reconnexionRequise: 'appareil non lié' }), expect.anything());
      // Aucun nouveau jeton n'a été émis.
      expect(R.setEx).not.toHaveBeenCalled();
    });

    it('laisse passer un téléphone déjà lié', async () => {
      const { json, next } = await renouveler({ version: '1.8.0+49', appareilId: '11111111-1111-4111-8111-111111111111' });
      expect(next).not.toHaveBeenCalled();
      expect(json).toHaveBeenCalled();
    });

    // Ces APK n'identifient pas leur téléphone : leur demander de se reconnecter
    // ne les lierait pas, et les déconnecterait en boucle.
    it('ne touche pas un APK antérieur à b48, ni un APK muet', async () => {
      for (const version of ['1.8.0+46', '1.8.0+47', undefined]) {
        const { next, json } = await renouveler({ version });
        expect(next).not.toHaveBeenCalled();
        expect(json).toHaveBeenCalled();
      }
    });

    it('ne touche ni le web, ni les rôles que le verrou ne vise pas', async () => {
      for (const o of [{ plt: 'WEB' as const }, { role: 'SUPERVISEUR' }, { role: 'MANAGER' }, { role: 'ADMIN' }]) {
        const { next, json } = await renouveler({ version: '1.8.0+49', ...o });
        expect(next).not.toHaveBeenCalled();
        expect(json).toHaveBeenCalled();
      }
    });

    it('vise aussi le transporteur', async () => {
      const { next } = await renouveler({ version: '1.8.0+49', role: 'TRANSPORTEUR' });
      expect(next.mock.calls[0][0]).toMatchObject({ statusCode: 401 });
    });
  });
});
