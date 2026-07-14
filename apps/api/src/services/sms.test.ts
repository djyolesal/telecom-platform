import { normaliserTelephone } from './sms.service';

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
