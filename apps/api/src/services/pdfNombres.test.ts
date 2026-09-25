import { nombreFr } from './pdf.service';

describe('nombres du PDF', () => {
  it('sépare les milliers par une espace que la police contient', () => {
    // Régression : toLocaleString('fr-FR') emploie U+202F, absente de
    // Helvetica/WinAnsi - « 12 480 » s'imprimait « 12/480 ».
    expect(nombreFr(12480.5)).toBe('12 480,5');
    expect(nombreFr(448210)).toBe('448 210');
    expect(/[\u202F\u00A0]/.test(nombreFr(1234567))).toBe(false);
  });
});
