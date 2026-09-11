import { bilanMensuelSite, ReleveStockLite, LivraisonLite } from './stocksMensuels.service';

const d = (iso: string) => new Date(iso);
const rel = (date: string, volume: number | null, index: number | null = null): ReleveStockLite =>
  ({ date: d(date), volume, index, groupeId: null });
const liv = (date: string, litres: number): LivraisonLite => ({ date: d(date), litres });

describe('bilanMensuelSite - méthode validée 07/09/2026', () => {
  it('bilan matière simple : conso = début + livraisons - fin, pro rata calendaire', () => {
    // 30/06 : 1000 L · 30/07 : 700 L, 500 L livrés le 15/07 → conso fenêtre 800 L / 30 j
    const b = bilanMensuelSite({
      releves: [rel('2026-06-30T12:00:00Z', 1000), rel('2026-07-30T12:00:00Z', 700)],
      livraisons: [liv('2026-07-15T10:00:00Z', 500)],
      annee: 2026, mois: 7,
    })!;
    expect(b.consoJour).toBeCloseTo(800 / 30, 1);
    expect(b.conso).toBe(Math.round((800 / 30) * 31));
    expect(b.livraisons).toBe(500);
    // stock au 1er : 1000 - conso/j × 0,5 j (relevé le 30/06 midi)
    expect(b.stockDebut).toBe(Math.round(1000 - (800 / 30) * 0.5));
    // stock fin : 700 - conso/j × 1,5 j jusqu'au 1er août
    expect(b.stockFin).toBe(Math.round(700 - (800 / 30) * 1.5));
    expect(b.drapeaux).toEqual([]);
  });

  it('fenêtre courte élargie vers le relevé antérieur', () => {
    // relevé antérieur du 30/07 → dernier relevé d'août le 05/08 : 6 j < 10
    // → élargissement vers le 01/07, fenêtre 35 j.
    const b = bilanMensuelSite({
      releves: [rel('2026-07-01T00:00:00Z', 2000), rel('2026-07-30T00:00:00Z', 1900), rel('2026-08-05T00:00:00Z', 1800)],
      livraisons: [],
      annee: 2026, mois: 8,
    })!;
    expect(b.drapeaux).toContain('fenêtre élargie');
    expect(b.fenetreJours).toBe(35); // 01/07 → 05/08
    // Frontières interpolées depuis les bornes de la fenêtre : le bilan publié
    // BOUCLE (début + livraisons − fin = conso du mois, aux arrondis près).
    const consoJour = 200 / 35;
    expect(b.stockDebut).toBe(Math.round(2000 - consoJour * 31)); // 01/07 → 01/08
    expect(b.stockDebut + b.livraisons - b.stockFin).toBeCloseTo(b.conso!, -1);
  });

  it('conso négative : drapeau, frontières en report brut', () => {
    const b = bilanMensuelSite({
      releves: [rel('2026-06-30T00:00:00Z', 500), rel('2026-07-28T00:00:00Z', 900)],
      livraisons: [], // le niveau monte sans livraison → incohérent
      annee: 2026, mois: 7,
    })!;
    expect(b.conso).toBeNull();
    expect(b.drapeaux.join()).toContain('conso négative');
    expect(b.stockDebut).toBe(500); // report brut
  });

  it("index bloqué : L/h hors plage → pas de débit publié, drapeau", () => {
    // 300 L partis, index avancé de 2 h → 150 L/h impossible
    const b = bilanMensuelSite({
      releves: [rel('2026-06-30T00:00:00Z', 1000, 100), rel('2026-07-30T00:00:00Z', 700, 102)],
      livraisons: [],
      annee: 2026, mois: 7,
    })!;
    expect(b.debitLh).toBeNull();
    expect(b.drapeaux.join()).toContain('index incohérent');
  });

  it('gasoil non expliqué : conso mesurée >> heures × débit lissé', () => {
    // Historique : débit stable 2 L/h (3 fenêtres valides), puis un mois où
    // 1000 L partent pour 50 h de marche (attendu ~100 L).
    const releves = [
      rel('2026-04-01T00:00:00Z', 2000, 0),
      rel('2026-04-30T00:00:00Z', 1900, 50),   // 100 L / 50 h = 2 L/h
      rel('2026-05-30T00:00:00Z', 1800, 100),  // 2 L/h
      rel('2026-06-29T00:00:00Z', 1700, 150),  // 2 L/h
      rel('2026-07-30T00:00:00Z', 700, 200),   // 1000 L / 50 h = 20 L/h (plausible mais 10× le lissé)
    ];
    const b = bilanMensuelSite({ releves, livraisons: [], annee: 2026, mois: 7 })!;
    expect(b.gasoilInexplique).toBeGreaterThan(200);
    expect(b.drapeaux.join()).toContain('gasoil non expliqué');
  });

  it('site sans relevé dans le mois : pas de ligne', () => {
    expect(bilanMensuelSite({
      releves: [rel('2026-06-15T00:00:00Z', 1000)],
      livraisons: [], annee: 2026, mois: 7,
    })).toBeNull();
  });
});
