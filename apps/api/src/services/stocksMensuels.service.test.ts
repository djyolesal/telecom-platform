import { bilanMensuelSite, ReleveStockLite, LivraisonLite, MouvementLite, debitLisse } from './stocksMensuels.service';

const d = (iso: string) => new Date(iso);
const rel = (date: string, volume: number | null, index: number | null = null): ReleveStockLite =>
  ({ date: d(date), volume, index, groupeId: null });
const liv = (date: string, litres: number): LivraisonLite => ({ date: d(date), litres });
/** Mouvement DÉJÀ signé : négatif pour une purge ou un transfert sortant. */
const mvt = (date: string, litres: number): MouvementLite => ({ date: d(date), litres });

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
    // Le début vient des deux relevés qui encadrent le 01/08 (30/07 → 05/08),
    // au rythme mesuré entre eux, pas de la fenêtre élargie.
    expect(b.stockDebut).toBe(Math.round(1900 - (100 / 6) * 2));
    // Pas de relevé après août : fin estimée au rythme de la fenêtre.
    expect(b.provisoire).toBe(true);
    expect(b.stockFin).toBe(Math.round(1800 - (200 / 35) * 27));
    expect(b.stockDebut + b.livraisons - b.stockFin).toBe(b.conso);
  });

  it('conso négative : drapeau, frontière en report brut', () => {
    const b = bilanMensuelSite({
      releves: [rel('2026-06-30T00:00:00Z', 500), rel('2026-07-28T00:00:00Z', 900)],
      livraisons: [], // le niveau monte sans livraison → incohérent
      annee: 2026, mois: 7,
    })!;
    expect(b.conso).toBeNull();
    expect(b.drapeaux.join()).toContain('conso négative');
    expect(b.drapeaux.join()).toContain('report brut');
    expect(b.stockDebut).toBe(500);
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

  it('une purge n\'est pas de la consommation', () => {
    // Même cuve, même chute de 300 L, mais 200 L ont été PURGÉS : le moteur
    // n'a brûlé que 100 L. Sans les mouvements, le rapport publiait 300 L de
    // conso et accusait le site d'une surconsommation qu'il n'a pas eue.
    const releves = [rel('2026-06-30T00:00:00Z', 1000), rel('2026-07-30T00:00:00Z', 700)];
    const sans = bilanMensuelSite({ releves, livraisons: [], annee: 2026, mois: 7 })!;
    const avec = bilanMensuelSite({
      releves, livraisons: [], mouvements: [mvt('2026-07-10T00:00:00Z', -200)], annee: 2026, mois: 7,
    })!;
    expect(sans.consoJour).toBeCloseTo(300 / 30, 1);
    expect(avec.consoJour).toBeCloseTo(100 / 30, 1);
    expect(avec.mouvements).toBe(-200);
    // Le bilan publié BOUCLE toujours : début + livraisons + mouvements − fin = conso.
    expect(avec.stockDebut + avec.livraisons + avec.mouvements - avec.stockFin).toBeCloseTo(avec.conso!, -1);
  });

  it('un transfert entrant ne se lit pas comme une livraison manquante', () => {
    // La cuve monte de 1000 à 1200 sans livraison : sans les mouvements, la
    // conso ressort négative et le mois est déclaré incalculable.
    const releves = [rel('2026-06-30T00:00:00Z', 1000), rel('2026-07-30T00:00:00Z', 1200)];
    const sans = bilanMensuelSite({ releves, livraisons: [], annee: 2026, mois: 7 })!;
    expect(sans.conso).toBeNull();
    expect(sans.drapeaux.join()).toContain('conso négative');

    const avec = bilanMensuelSite({
      releves, livraisons: [], mouvements: [mvt('2026-07-05T00:00:00Z', 300)], annee: 2026, mois: 7,
    })!;
    expect(avec.consoJour).toBeCloseTo(100 / 30, 1);
    expect(avec.drapeaux).toEqual([]);
  });

  it('site sans relevé dans le mois : pas de ligne', () => {
    expect(bilanMensuelSite({
      releves: [rel('2026-06-15T00:00:00Z', 1000)],
      livraisons: [], annee: 2026, mois: 7,
    })).toBeNull();
  });
});

describe('frontières de mois : une seule valeur par changement de mois', () => {
  // Rythmes très différents d'un mois à l'autre, relevés loin des fins de mois :
  // c'est le cas où l'ancien calcul donnait deux stocks pour le même instant.
  const releves = [
    rel('2026-06-05T08:00:00Z', 3000),
    rel('2026-07-06T08:00:00Z', 2970),   // ~1 L/j
    rel('2026-08-05T08:00:00Z', 2940),   // ~1 L/j
    rel('2026-09-03T08:00:00Z', 840),    // ~72 L/j, avec 0 livraison
    rel('2026-10-04T08:00:00Z', 2500),   // 2500 L livrés, ~27 L/j
    rel('2026-11-03T08:00:00Z', 1900),   // 20 L/j
  ];
  const livraisons = [liv('2026-09-20T10:00:00Z', 2500)];
  const mouvements = [mvt('2026-07-20T10:00:00Z', -100)];
  const mois = (m: number) => bilanMensuelSite({ releves, livraisons, mouvements, annee: 2026, mois: m })!;

  it('la fin de chaque mois est EXACTEMENT le début du suivant', () => {
    for (const m of [7, 8, 9]) expect(mois(m).stockFin).toBe(mois(m + 1).stockDebut);
  });

  it('chaque mois boucle au litre : début + livraisons + mouvements - fin = conso', () => {
    for (const m of [7, 8, 9, 10]) {
      const b = mois(m);
      expect(b.stockDebut + b.livraisons + b.mouvements - b.stockFin).toBe(b.conso);
    }
  });

  it('les mois s\'additionnent : la conso cumulée se retrouve depuis les stocks de la période', () => {
    const b = [7, 8, 9, 10].map(mois);
    const cumul = b.reduce((s, x) => s + x.conso!, 0);
    const flux = b.reduce((s, x) => s + x.livraisons + x.mouvements, 0);
    expect(cumul).toBe(b[0].stockDebut + flux - b[3].stockFin);
  });

  it('le stock au changement de mois suit le rythme mesuré entre les deux relevés qui l\'encadrent', () => {
    // 05/08 8h : 2940 L → 03/09 8h : 840 L, soit 2100 L en 29 j.
    const j = (Date.UTC(2026, 8, 1) - Date.parse('2026-08-05T08:00:00Z')) / 86_400_000;
    expect(mois(8).stockFin).toBe(Math.round(2940 - (2100 / 29) * j));
  });

  it('une livraison entre deux relevés compte du bon côté du changement de mois', () => {
    // Livrés le 20/09, donc AVANT le 01/10 : le stock du 01/10 les contient.
    const j = (Date.UTC(2026, 9, 1) - Date.parse('2026-09-03T08:00:00Z')) / 86_400_000;
    const conso = 840 + 2500 - 2500; // 03/09 → 04/10
    expect(mois(9).stockFin).toBe(Math.round(840 + 2500 - (conso / 31) * j));
    expect(mois(9).livraisons).toBe(2500);
    expect(mois(10).livraisons).toBe(0);
  });

  it('un relevé pile au changement de mois fait foi pour les deux mois', () => {
    const r = [rel('2026-06-15T00:00:00Z', 1500), rel('2026-07-01T00:00:00Z', 1234), rel('2026-07-20T00:00:00Z', 900), rel('2026-08-10T00:00:00Z', 500)];
    const juin = bilanMensuelSite({ releves: r, livraisons: [], annee: 2026, mois: 6 });
    const juil = bilanMensuelSite({ releves: r, livraisons: [], annee: 2026, mois: 7 })!;
    expect(juil.stockDebut).toBe(1234);
    expect(juin).toBeNull(); // un seul relevé en juin, sans antériorité : pas de bilan
  });

  it('provisoire tant qu\'aucun relevé ne suit la fin du mois, définitif ensuite', () => {
    const r = [rel('2026-06-20T00:00:00Z', 1000), rel('2026-07-20T00:00:00Z', 700)];
    const avant = bilanMensuelSite({ releves: r, livraisons: [], annee: 2026, mois: 7 })!;
    expect(avant.provisoire).toBe(true);
    expect(avant.stockFin).toBe(Math.round(700 - 10 * 12)); // estimée à 10 L/j

    // Le relevé d'août révèle un rythme de 20 L/j : la fin de juillet est corrigée.
    const apres = bilanMensuelSite({ releves: [...r, rel('2026-08-04T00:00:00Z', 400)], livraisons: [], annee: 2026, mois: 7 })!;
    expect(apres.provisoire).toBe(false);
    expect(apres.stockFin).toBe(Math.round(700 - 20 * 12));
  });

  it('un mois passé ne bouge pas tant que rien ne change autour de sa fin', () => {
    const base = [...releves.slice(0, 4)];
    const sept = mois(9);
    expect(bilanMensuelSite({ releves, livraisons, mouvements, annee: 2026, mois: 8 })!.stockFin)
      .toBe(bilanMensuelSite({ releves: [...base, releves[4]], livraisons, mouvements, annee: 2026, mois: 8 })!.stockFin);
    // Un relevé bien plus tard laisse septembre intact : il n'encadre aucune de ses frontières.
    const plusTard = bilanMensuelSite({
      releves: [...releves, rel('2026-12-01T00:00:00Z', 1000)], livraisons, mouvements, annee: 2026, mois: 9,
    })!;
    expect(plusTard).toEqual(sept);
  });

  it('un niveau aberrant (> 5 000 L) ne sert pas de borne au changement de mois', () => {
    const r = [rel('2026-06-20T00:00:00Z', 1000), rel('2026-07-20T00:00:00Z', 700), rel('2026-08-02T00:00:00Z', 90000), rel('2026-08-20T00:00:00Z', 100)];
    const b = bilanMensuelSite({ releves: r, livraisons: [], annee: 2026, mois: 7 })!;
    // Encadré par 20/07 et 20/08 (600 L en 31 j), le relevé de 90 000 L est ignoré.
    expect(b.stockFin).toBe(Math.round(700 - (600 / 31) * 12));
  });

  describe('jauge qui remonte sans livraison enregistrée après le dernier relevé du mois', () => {
    // Cas réel (ADOGBENOU) : ~5 L/j, puis la cuve remonte entre deux relevés
    // sans dépotage saisi. La conso du mois ne doit pas s'arrêter au relevé.
    const r = [
      rel('2026-05-20T00:00:00Z', 490),
      rel('2026-06-19T00:00:00Z', 340),
      rel('2026-07-20T00:00:00Z', 1120),
      rel('2026-08-19T00:00:00Z', 1000),
    ];
    const juin = bilanMensuelSite({ releves: r, livraisons: [], annee: 2026, mois: 6 })!;
    const juil = bilanMensuelSite({ releves: r, livraisons: [], annee: 2026, mois: 7 })!;

    it('le mois continue de consommer au rythme mesuré avant la hausse', () => {
      expect(juin.consoJour).toBeCloseTo(5, 1);
      expect(juin.stockFin).toBe(Math.round(340 - 5 * 12));
    });

    it('le changement de mois reste une valeur unique, et le mois qui porte la hausse reste signalé', () => {
      expect(juin.stockFin).toBe(juil.stockDebut);
      expect(juil.conso).toBeNull();
      expect(juin.drapeaux.join()).toContain('hausse sans livraison');
      expect(juin.drapeaux.join()).not.toContain('report brut');
    });
  });

  it('jauge qui remonte sans aucun rythme connu avant : report brut signalé, pas d\'invention', () => {
    const r = [rel('2026-07-15T00:00:00Z', 800), rel('2026-07-25T00:00:00Z', 780), rel('2026-08-15T00:00:00Z', 1200)];
    const avecRythme = bilanMensuelSite({ releves: r, livraisons: [], annee: 2026, mois: 7 })!;
    expect(avecRythme.stockFin).toBe(Math.round(780 - 2 * 7));

    const sansRythme = [rel('2026-06-01T00:00:00Z', 900), rel('2026-06-10T00:00:00Z', 950), rel('2026-07-25T00:00:00Z', 1000), rel('2026-08-15T00:00:00Z', 1200)];
    const b = bilanMensuelSite({ releves: sansRythme, livraisons: [], annee: 2026, mois: 7 })!;
    expect(b.stockFin).toBe(1000);
    expect(b.drapeaux.join()).toContain('report brut');
  });

  it('site nouveau, sans antériorité : le stock du 1er est estimé pour que le mois boucle', () => {
    const r = [rel('2026-07-10T00:00:00Z', 1000), rel('2026-07-20T00:00:00Z', 800)];
    const b = bilanMensuelSite({ releves: r, livraisons: [], annee: 2026, mois: 7 })!;
    expect(b.drapeaux).toContain('fenêtre intra-mois');
    expect(b.stockDebut).toBe(1000 + 20 * 9);
    expect(b.stockDebut + b.livraisons - b.stockFin).toBe(b.conso);
  });
});

describe('non-régression : mêmes chiffres que la méthode H1 quand les données sont propres', () => {
  it('conso constante, relevés irréguliers, livraisons : la théorie, H1 et le nouveau calcul coïncident', () => {
    const J = 86_400_000;
    const t0 = Date.UTC(2026, 0, 3, 9);
    const consoJour = 48;
    const livraisons = [20, 55, 90, 130, 170, 210, 250, 290].map((j) => ({ date: new Date(t0 + j * J + 5 * 3_600_000), litres: 1800 }));
    const volume = (j: number) => 2500 - consoJour * j
      + livraisons.filter((l) => l.date.getTime() <= t0 + j * J).reduce((s, l) => s + l.litres, 0);
    const pas = [17, 26, 31, 12, 38, 22, 29, 9, 33, 27, 19, 35];
    const releves: ReleveStockLite[] = [];
    for (let j = 0, k = 0; j < 320; j += pas[k++ % pas.length]) {
      releves.push({ date: new Date(t0 + j * J), volume: volume(j), index: null, groupeId: null });
    }
    for (const mois of [3, 5, 7, 9]) {
      const b = bilanMensuelSite({ releves, livraisons, annee: 2026, mois })!;
      const theorique = consoJour * new Date(Date.UTC(2026, mois, 0)).getUTCDate();
      expect(b.provisoire).toBe(false);
      expect(b.consoFenetre).toBe(theorique);
      expect(Math.abs(b.conso! - theorique)).toBeLessThanOrEqual(1);
    }
  });
});

describe('contre-épreuve : indépendante de ce qui suit le mois', () => {
  const avant = [
    rel('2026-04-01T00:00:00Z', 2000, 0),
    rel('2026-04-30T00:00:00Z', 1900, 50),
    rel('2026-05-30T00:00:00Z', 1800, 100),
    rel('2026-06-29T00:00:00Z', 1700, 150),
    rel('2026-07-30T00:00:00Z', 700, 200),
  ];

  it('le gasoil non expliqué et le débit d\'un mois passé ne bougent pas avec les relevés suivants', () => {
    const seul = bilanMensuelSite({ releves: avant, livraisons: [], annee: 2026, mois: 7 })!;
    const suite = [rel('2026-08-29T00:00:00Z', 200, 210), rel('2026-09-28T00:00:00Z', 100, 215), rel('2026-10-28T00:00:00Z', 50, 217)];
    const avecSuite = bilanMensuelSite({ releves: [...avant, ...suite], livraisons: [], annee: 2026, mois: 7 })!;
    expect(debitLisse([...avant, ...suite], [])).not.toBe(debitLisse(avant, []));
    expect(avecSuite.gasoilInexplique).toBe(seul.gasoilInexplique);
    expect(avecSuite.debitLh).toBe(seul.debitLh);
    expect(avecSuite.consoFenetre).toBe(seul.consoFenetre);
  });
});
