import { extraireChampsBC } from './bcPdf.service';

/**
 * Textes calqués sur le BC réel Moov Africa (PO250100005, scan OCRisé) : les
 * règles d'extraction sont testées sur ce que tesseract/pdftotext produisent,
 * fautes de frappe du document comprises (« Comande »).
 */
const OCR_T1 = `
Moov Africa
Bon de Commande
N° PO250100005 du 06/01/2025
Centre de Coût: 500473070 DRS/Envmt techniq(Clim, energ
Fournisseur TOTAL
Achat de carburant de 485 000 litres de gasoil pour les sites de Moov Africa Togo (pour les mois de janvier, février et
mars 2025)
Article Désignation QTE Prix unitaire Montant HT TVA Montant TTC
105001 Comande de Gasoil pour le mois de Janvier 2025 164 000 670,0000 109 880 000 109 880 000
105001 Comande de Gasoil pour le mois de Février 2025 161 000 670,0000 107 870 000 107 870 000
105001 Comande de Gasoil pour le mois de Mars 2025 160 000 670,0000 107 200 000 107 200 000
Total lignes HT 324 950 000,000000 XOF
`;

describe('extraireChampsBC', () => {
  it('extrait tous les champs du BC T1 réel (scan OCR)', () => {
    const r = extraireChampsBC(OCR_T1, true);
    expect(r.numero).toBe('PO250100005');
    expect(r.dateEmission).toBe('06/01/2025');
    expect(r.annee).toBe(2025);
    expect(r.trimestre).toBe(1);
    expect(r.volumesMensuels).toEqual([
      { mois: 1, volumePrevuLitres: 164000 },
      { mois: 2, volumePrevuLitres: 161000 },
      { mois: 3, volumePrevuLitres: 160000 },
    ]);
    expect(r.totalLitres).toBe(485000);
    expect(r.totalAnnonceLitres).toBe(485000);
    expect(r.avertissements).toEqual([]);
  });

  it('déduit le trimestre des MOIS, pas de la date d\'émission (BC T2 émis en mars)', () => {
    const r = extraireChampsBC(`
N° PO250300014 du 20/03/2025
Achat de carburant de 473 000 litres de gasoil
Comande de Gasoil pour le mois de Avril 2025 158 000 670,0000
Comande de Gasoil pour le mois de Mai 2025 155 000 670,0000
Comande de Gasoil pour le mois de Juin 2025 160 000 670,0000
`, true);
    expect(r.numero).toBe('PO250300014');
    expect(r.trimestre).toBe(2);
    expect(r.totalLitres).toBe(473000);
    expect(r.avertissements).toEqual([]);
  });

  it('signale une incohérence entre le total annoncé et la somme des mois', () => {
    const r = extraireChampsBC(`
N° PO250300014 du 20/03/2025
Achat de carburant de 473 000 litres
Comande de Gasoil pour le mois de Avril 2025 15 800 670,0000
Comande de Gasoil pour le mois de Mai 2025 155 000 670,0000
Comande de Gasoil pour le mois de Juin 2025 160 000 670,0000
`, true);
    expect(r.totalLitres).toBe(330800);
    expect(r.avertissements.some((a) => a.includes('Incohérence'))).toBe(true);
  });

  it('tolère un O lu à la place du 0 dans le numéro (PO en « P0 »)', () => {
    const r = extraireChampsBC('N° P0250100005 du 06/01/2025', true);
    expect(r.numero).toBe('PO250100005');
  });

  it('avertit quand rien n\'est lisible au lieu d\'inventer', () => {
    const r = extraireChampsBC('page blanche', true);
    expect(r.numero).toBeNull();
    expect(r.volumesMensuels).toEqual([]);
    expect(r.trimestre).toBeNull();
    expect(r.avertissements.length).toBeGreaterThanOrEqual(2);
  });

  it('chevauchement de deux trimestres → avertissement, pas de trimestre choisi', () => {
    const r = extraireChampsBC(`
Comande de Gasoil pour le mois de Mars 2025 160 000
Comande de Gasoil pour le mois de Avril 2025 158 000
`, true);
    expect(r.trimestre).toBeNull();
    expect(r.avertissements.some((a) => a.includes('trimestres'))).toBe(true);
  });
});
