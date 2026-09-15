import { EventEmitter } from 'events';

/**
 * Le limiteur d'authentification a provoqué une panne de connexion en
 * production : le refresh partageait le seau du login (clé (IP, email) avec un
 * email VIDE), si bien que toutes les sessions d'une même IP — le conteneur web
 * pour l'ensemble du portail — se disputaient 10 jetons par quart d'heure ; une
 * fois ce seau vide, les refresh refusés en boucle épuisaient le plafond par IP
 * et les CONNEXIONS légitimes repartaient en 429, affichées « identifiants
 * incorrects ». Ces tests verrouillent les trois propriétés qui l'empêchent.
 */

// Redis simulé (compteurs en mémoire, mêmes primitives que node-redis v4).
const store = new Map<string, number>();
const ttls = new Map<string, number>();
let redisHS = false;
const garde = () => { if (redisHS) throw new Error('Redis indisponible'); };

jest.mock('../config/redis', () => ({
  redisClient: {
    get: async (k: string) => { garde(); return store.has(k) ? String(store.get(k)) : null; },
    incr: async (k: string) => { garde(); const n = (store.get(k) ?? 0) + 1; store.set(k, n); return n; },
    expire: async (k: string, s: number) => { garde(); ttls.set(k, s); return true; },
    ttl: async (k: string) => { garde(); return ttls.get(k) ?? -1; },
    del: async (k: string) => { garde(); return store.delete(k) ? 1 : 0; },
  },
}));
jest.mock('../utils/logger', () => ({ logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn() } }));

import { rateLimit, empreinteJeton } from './rateLimit';

/** Joue une requête et renvoie le statut final (`statut` = réponse du handler). */
async function jouer(mw: any, req: any, statut = 200): Promise<number> {
  const res: any = new EventEmitter();
  res.statusCode = 200;
  res.setHeader = () => {};
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = () => { res.emit('finish'); return res; };

  let passe = false;
  let erreur: any = null;
  await mw(req as any, res as any, (e?: any) => { passe = true; erreur = e ?? null; });

  if (erreur) return erreur.statusCode ?? 500;   // AppError (fail-closed)
  if (!passe) return res.statusCode;             // refusé par le limiteur (429)
  res.statusCode = statut;                       // le handler a répondu
  res.emit('finish');
  await new Promise((r) => setImmediate(r));     // laisser courir l'incrément différé
  return statut;
}

const reqLogin = (email: string, ip = '10.0.0.5') => ({ ip, socket: {}, body: { email } });

beforeEach(() => { store.clear(); ttls.clear(); redisHS = false; });

describe('rateLimit — mode « échecs seulement » (login)', () => {
  const login = () => rateLimit({ windowSec: 900, max: 3, ipMax: 5, keyPrefix: 'login', failClosed: true, countOnlyFailures: true });

  it('ne compte PAS les connexions réussies : 50 succès d\'affilée passent', async () => {
    const mw = login();
    for (let i = 0; i < 50; i++) {
      expect(await jouer(mw, reqLogin('a@x.tg'), 200)).toBe(200);
    }
  });

  it('des comptes DIFFÉRENTS derrière une MÊME IP ne se verrouillent pas entre eux', async () => {
    const mw = login();
    for (let i = 0; i < 30; i++) {
      expect(await jouer(mw, reqLogin(`user${i}@x.tg`), 200)).toBe(200);
    }
  });

  it('bloque après `max` échecs sur le même compte', async () => {
    const mw = login();
    for (let i = 0; i < 3; i++) expect(await jouer(mw, reqLogin('a@x.tg'), 401)).toBe(401);
    expect(await jouer(mw, reqLogin('a@x.tg'), 401)).toBe(429);
  });

  it('une connexion RÉUSSIE efface l\'ardoise du compte', async () => {
    const mw = login();
    await jouer(mw, reqLogin('a@x.tg'), 401);
    await jouer(mw, reqLogin('a@x.tg'), 401);
    expect(await jouer(mw, reqLogin('a@x.tg'), 200)).toBe(200);  // bon mot de passe
    for (let i = 0; i < 3; i++) expect(await jouer(mw, reqLogin('a@x.tg'), 401)).toBe(401);
    expect(await jouer(mw, reqLogin('a@x.tg'), 429)).toBe(429);
  });

  it('le plafond par IP reste actif contre le password-spraying (échecs sur N comptes)', async () => {
    const mw = login();
    for (let i = 0; i < 5; i++) expect(await jouer(mw, reqLogin(`cible${i}@x.tg`, '9.9.9.9'), 401)).toBe(401);
    expect(await jouer(mw, reqLogin('cible99@x.tg', '9.9.9.9'), 401)).toBe(429);
  });

  it('un refus 429 ne s\'auto-alimente pas (le compteur ne monte plus)', async () => {
    const mw = login();
    for (let i = 0; i < 3; i++) await jouer(mw, reqLogin('a@x.tg'), 401);
    const avant = store.get('rl:login:10.0.0.5:a@x.tg');
    await jouer(mw, reqLogin('a@x.tg'), 401);
    await jouer(mw, reqLogin('a@x.tg'), 401);
    expect(store.get('rl:login:10.0.0.5:a@x.tg')).toBe(avant);
  });

  it('reste fail-closed si Redis tombe', async () => {
    const mw = login();
    redisHS = true;
    expect(await jouer(mw, reqLogin('a@x.tg'), 200)).toBe(429);
  });
});

describe('rateLimit — refresh par empreinte de jeton', () => {
  const refresh = () => rateLimit({
    windowSec: 900, max: 3, keyPrefix: 'refresh',
    identite: (r: any) => (typeof r.body?.refreshToken === 'string' && r.body.refreshToken ? empreinteJeton(r.body.refreshToken) : ''),
  });
  const reqRef = (jeton: string, ip = '172.18.0.4') => ({ ip, socket: {}, body: { refreshToken: jeton } });

  it('N sessions derrière UNE SEULE IP ne partagent plus de quota', async () => {
    const mw = refresh();
    // 40 appareils via le NAT de l'opérateur : chacun garde son propre compteur.
    for (let i = 0; i < 40; i++) {
      expect(await jouer(mw, reqRef(`jeton-appareil-${i}`), 200)).toBe(200);
    }
  });

  it('plafonne quand même UNE session emballée', async () => {
    const mw = refresh();
    for (let i = 0; i < 3; i++) expect(await jouer(mw, reqRef('jeton-fou'), 200)).toBe(200);
    expect(await jouer(mw, reqRef('jeton-fou'), 200)).toBe(429);
  });

  it('n\'écrit jamais le jeton en clair dans Redis', async () => {
    const mw = refresh();
    await jouer(mw, reqRef('secret-tres-sensible'), 200);
    for (const k of store.keys()) expect(k).not.toContain('secret-tres-sensible');
  });

  it('est fail-OPEN : une panne Redis ne tue pas les sessions', async () => {
    const mw = refresh();
    redisHS = true;
    expect(await jouer(mw, reqRef('jeton-appareil-1'), 200)).toBe(200);
  });

  it('n\'utilise PAS le seau du login (aucune clé rl:login:*)', async () => {
    const mw = refresh();
    await jouer(mw, reqRef('jeton-appareil-1'), 200);
    expect([...store.keys()].some((k) => k.startsWith('rl:login'))).toBe(false);
  });
});
