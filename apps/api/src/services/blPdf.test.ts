import { extraireChampsBL } from './blPdf.service';

/** Texte OCR réel (tesseract) du BL TotalEnergies 3030729534 — page 1 du lot. */
const OCR_BL = `
: : ' ET EXEMPLAIRE TRANSPORTEUR 2
TotalEr:ergies Marketing Togo S.A. ù
SA. | y capital de 1 291 280 000 FCFA mé) Référence /Date: 3030729534 / 07.08.2025
Te D O8 Be 0 ax (200) pus He Commande client / Date : 2230674460 / 07.08.2025
E-Mail: total@totalenergies.tg TotalEnergies Votre N° Client: 116129
RGCMEE: 1976 B 666 / NIF : 1000166221 Réf. cde. Client / Date : BC N°PO250300014 /
04.08.2025
DONNEUR D'ORDRE :
MOOV AFRICA TOGO S.A. BON DE LIVRAISON
Poste | Code Produit Description Quantité Unité
10 21635 GASOIL 15.000,000 Ê
GASOIL
TG 0688 AH
`;

describe('extraireChampsBL', () => {
  it('extrait tous les champs du BL réel (OCR)', () => {
    const r = extraireChampsBL(OCR_BL, 1);
    expect(r.numeroBL).toBe('3030729534');
    expect(r.numeroClient).toBe('116129');
    expect(r.bcNumero).toBe('PO250300014');
    expect(r.dateBL).toBe('07/08/2025');
    expect(r.immatriculation).toBe('TG 0688 AH');
    expect(r.volumeChargeLitres).toBe(15000);
    expect(r.avertissements).toEqual([]);
  });

  it('lit un volume de 19 000 L et une plaque collée (TG5088AN)', () => {
    const r = extraireChampsBL(`
Référence / Date : 3030729533 / 07.08.2025
Votre N° Client : 116129
Réf. cde. Client / Date : BC N°PO250300014 /
GASOIL 19.000,000 L
TG5088AN
`, 3);
    expect(r.volumeChargeLitres).toBe(19000);
    expect(r.immatriculation).toBe('TG 5088 AN');
  });

  it('BC en « P0 » (zéro OCR) → normalisé PO', () => {
    const r = extraireChampsBL('Réf. cde. Client / Date : BC N°P0250300014 /', 1);
    expect(r.bcNumero).toBe('PO250300014');
  });

  it('un volume hors gabarit camion est rejeté avec avertissement', () => {
    const r = extraireChampsBL(`
Référence / Date : 3030729534 / 07.08.2025
GASOIL 150.000,000 L
`, 1);
    expect(r.volumeChargeLitres).toBeNull();
    expect(r.avertissements.some((a) => a.includes('Volume'))).toBe(true);
  });

  it('page sans rien de lisible → tous champs nuls et avertissements', () => {
    const r = extraireChampsBL('page blanche', 2);
    expect(r.numeroBL).toBeNull();
    expect(r.volumeChargeLitres).toBeNull();
    expect(r.avertissements.length).toBeGreaterThanOrEqual(3);
  });
});
