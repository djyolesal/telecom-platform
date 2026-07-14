import { normaliserTelephone, envoyerSmsManuel } from './sms.service';
import { prisma } from '../config/database';
import { env } from '../config/env';

jest.mock('../config/database', () => ({
  prisma: { smsLog: { create: jest.fn().mockResolvedValue({}) } },
}));
jest.mock('../config/env', () => ({
  env: { SMS_API_URL: undefined, SMS_USERNAME: 'user', SMS_PASSWORD: 'pass', SMS_SMSC: undefined, SMS_SENDER: 'EMOPS' },
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

  it('avec passerelle : statut ENVOYE et URL au format Kannel (GET cgi-bin/sendsms)', async () => {
    (env as { SMS_API_URL?: string }).SMS_API_URL = 'http://10.0.0.1:13013/cgi-bin/sendsms';
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true } as Response);
    const { simule, resultats } = await envoyerSmsManuel([{ telephone: '97589258' }], 'Test é');
    expect(simule).toBe(false);
    expect(resultats[0].statut).toBe('ENVOYE');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const url = fetchSpy.mock.calls[0][0] as URL;
    expect(url.pathname).toBe('/cgi-bin/sendsms');
    expect(url.searchParams.get('username')).toBe('user');
    expect(url.searchParams.get('password')).toBe('pass');
    expect(url.searchParams.get('from')).toBe('EMOPS');
    expect(url.searchParams.get('to')).toBe('+22897589258');
    expect(url.searchParams.get('text')).toBe('Test é');
    expect(url.searchParams.get('charset')).toBe('UTF-8');
    expect(url.searchParams.has('smsc')).toBe(false); // absent si non configuré
    fetchSpy.mockRestore();
  });

  it('avec passerelle : statut ECHEC et erreur journalisée quand la requête échoue', async () => {
    (env as { SMS_API_URL?: string }).SMS_API_URL = 'https://sms.example/send';
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 500,
      text: () => Promise.resolve('boom'),
    } as unknown as Response);
    const { resultats } = await envoyerSmsManuel([{ telephone: '97589258' }], 'Test');
    expect(resultats[0].statut).toBe('ECHEC');
    expect(resultats[0].erreur).toContain('HTTP 500');
    expect(logCreate.mock.calls[0][0].data).toMatchObject({ statut: 'ECHEC' });
    fetchSpy.mockRestore();
  });
});
