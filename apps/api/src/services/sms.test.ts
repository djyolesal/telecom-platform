import { normaliserTelephone, telephoneLocal, envoyerSmsManuel, numerosEnEchec } from './sms.service';
import { prisma } from '../config/database';
import { env } from '../config/env';

jest.mock('../config/database', () => ({
  prisma: { smsLog: { create: jest.fn().mockResolvedValue({}), count: jest.fn().mockResolvedValue(0) } },
}));
jest.mock('../config/env', () => ({
  env: { SMS_API_URL: undefined, SMS_API_KEY: 'cle-secrete', SMS_SENDER: 'EMOPS' },
}));
jest.mock('../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn() },
}));

describe('normaliserTelephone', () => {
  it('préfixe +228 les numéros locaux à 8 chiffres (format du fichier contacts)', () => {
    expect(normaliserTelephone('97589258')).toBe('+22897589258');
  });

  it('gère espaces et séparateurs', () => {
    expect(normaliserTelephone('97 58 92 58')).toBe('+22897589258');
    expect(normaliserTelephone('97-58-92-58')).toBe('+22897589258');
  });

  it('conserve les numéros déjà internationaux', () => {
    expect(normaliserTelephone('+22897589258')).toBe('+22897589258');
    expect(normaliserTelephone('22897589258')).toBe('+22897589258');
  });
});

describe('telephoneLocal (format passerelle : 8 chiffres sans +228)', () => {
  it('retire le préfixe +228 quel que soit le format saisi', () => {
    expect(telephoneLocal('+22897589258')).toBe('97589258');
    expect(telephoneLocal('22897589258')).toBe('97589258');
    expect(telephoneLocal('97 58 92 58')).toBe('97589258');
    expect(telephoneLocal('97589258')).toBe('97589258');
  });
});

describe('envoyerSmsManuel', () => {
  const logCreate = prisma.smsLog.create as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    (env as { SMS_API_URL?: string }).SMS_API_URL = undefined;
  });

  it('sans passerelle configurée : statut SIMULE, journalisé, aucun appel réseau', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch');
    const { simule, resultats } = await envoyerSmsManuel(
      [{ telephone: '97589258', contactId: 'c1' }, { telephone: '+22890000000' }],
      'Test'
    );
    expect(simule).toBe(true);
    expect(resultats).toEqual([
      { telephone: '+22897589258', contactId: 'c1', statut: 'SIMULE', erreur: null },
      { telephone: '+22890000000', contactId: null, statut: 'SIMULE', erreur: null },
    ]);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(logCreate).toHaveBeenCalledTimes(2);
    expect(logCreate.mock.calls[0][0].data).toMatchObject({ evenement: 'MANUEL', statut: 'SIMULE' });
    fetchSpy.mockRestore();
  });

  it('avec passerelle : UN SEUL POST JSON, clé en en-tête Authorization: Bearer, destinataires locaux', async () => {
    (env as { SMS_API_URL?: string }).SMS_API_URL = 'https://sms.example/send';
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true, text: () => Promise.resolve('OK') } as unknown as Response);
    const { simule, resultats } = await envoyerSmsManuel(
      [{ telephone: '97589258' }, { telephone: '+22890000000' }],
      'Test é'
    );
    expect(simule).toBe(false);
    expect(resultats.map((r) => r.statut)).toEqual(['ENVOYE', 'ENVOYE']);
    expect(fetchSpy).toHaveBeenCalledTimes(1); // un lot = une requête
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(String(url)).toBe('https://sms.example/send');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({
      'Content-Type': 'application/json',
      Authorization: 'Bearer cle-secrete',
    });
    expect(JSON.parse(String(init.body))).toEqual({
      sender: 'EMOPS',
      recipients: ['97589258', '90000000'], // locaux, sans +228 - la clé n'est PAS dans le corps
      message: 'Test é',
    });
    fetchSpy.mockRestore();
  });

  it('panne réseau : la cause réelle (ECONNREFUSED…) est extraite du « fetch failed »', async () => {
    (env as { SMS_API_URL?: string }).SMS_API_URL = 'https://sms.example/send';
    const err = new TypeError('fetch failed');
    (err as { cause?: unknown }).cause = { code: 'ECONNREFUSED' };
    const fetchSpy = jest.spyOn(global, 'fetch').mockRejectedValue(err);
    const { resultats } = await envoyerSmsManuel([{ telephone: '97589258' }], 'Test');
    expect(resultats[0].statut).toBe('ECHEC');
    expect(resultats[0].erreur).toContain('ECONNREFUSED');
    expect(resultats[0].erreur).toContain('injoignable');
    fetchSpy.mockRestore();
  });

  it('réponse non-2xx : statut ECHEC pour tout le lot, erreur journalisée', async () => {
    (env as { SMS_API_URL?: string }).SMS_API_URL = 'https://sms.example/send';
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 401,
      text: () => Promise.resolve('invalid api key'),
    } as unknown as Response);
    const { resultats } = await envoyerSmsManuel([{ telephone: '97589258' }, { telephone: '90000000' }], 'Test');
    expect(resultats.map((r) => r.statut)).toEqual(['ECHEC', 'ECHEC']);
    expect(resultats[0].erreur).toContain('HTTP 401');
    expect(logCreate.mock.calls[0][0].data).toMatchObject({ statut: 'ECHEC' });
    fetchSpy.mockRestore();
  });
});

describe('numerosEnEchec (statut SMS par numéro)', () => {
  it('format inconnu → aucun échec signalé (statut global conservé)', () => {
    expect(numerosEnEchec('OK').size).toBe(0);
    expect(numerosEnEchec('{"status":"queued"}').size).toBe(0);
  });
  it('liste "failed" de numéros → convertis en local', () => {
    const s = numerosEnEchec('{"failed":["+22897589258","90000000"]}');
    expect(s.has('97589258')).toBe(true);
    expect(s.has('90000000')).toBe(true);
  });
  it('results[] avec statut par destinataire', () => {
    const s = numerosEnEchec('{"results":[{"to":"97589258","status":"delivered"},{"to":"90000000","status":"failed"}]}');
    expect(s.has('90000000')).toBe(true);
    expect(s.has('97589258')).toBe(false);
  });
});
