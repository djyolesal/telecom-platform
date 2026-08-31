import ExcelJS from 'exceljs';

/**
 * Classeur Excel « designé » de l'export des coupures réseau : une feuille
 * Synthèse (KPIs colorés + downtime par alarme, technologie, région, top sites)
 * et une feuille Détail (en-tête figé, filtres auto, EN COURS en rouge,
 * catégorie ACTIF/PASSIF en pastilles, héritées grisées avec leur origine).
 * Charte E&M OpS — remplace le tableau brut pour le format xlsx.
 */

const NAVY = 'FF1B3F6B', TEAL = 'FF0E7C6B', AMBER = 'FFE67E22', RED = 'FFC0392B',
      PURPLE = 'FF7D3C98', ZEBRA = 'FFF7F9FB', GRIS = 'FF6B7280',
      ROUGE_PALE = 'FFFDECEA', VIOLET_PALE = 'FFF4ECF7', VERT_PALE = 'FFE8F6F3';

// Référentiel NOC des types d'alarme (libellés donnés par l'exploitant).
export const LIBELLES_ALARME: Record<string, string> = {
  AE: 'AE - atelier d\'énergie', GE: 'GE - groupe électrogène', EN: 'EN - environnement',
  TX: 'TX - transmission', FO: 'FO - fibre optique', RA: 'RA - radio',
  MI: 'MI - maintenance', MD: 'MD - mise hors service sur demande', NA: 'NA - non attribué',
};

export interface LigneCoupureExport {
  siteNom: string;
  region: string;
  technologie: string;
  dateDebut: Date;
  dateFin: Date | null;
  downtimeMinutes: number | null;
  typeAlarme: string | null;
  causeCategorie: string | null;
  origine: string;
  origineSiteNom: string | null; // site racine si héritée
  source: string; // MANUEL | OSS
  priseEnChargePar: string | null; // détection AUTO adoptée par le NOC
  incidentRef: string | null;
  cause: string | null;
  actions: string | null;
  intervenants: string | null;
}

export const COLONNES_DETAIL = [
  { key: 'site', header: 'Site', width: 20 },
  { key: 'region', header: 'Région', width: 15 },
  { key: 'technologie', header: 'Technologie', width: 12 },
  { key: 'debut', header: 'Début', width: 17 },
  { key: 'fin', header: 'Fin', width: 17 },
  { key: 'downtime', header: 'Downtime (min)', width: 14 },
  { key: 'alarme', header: 'Alarme', width: 8 },
  { key: 'categorie', header: 'Catégorie', width: 10 },
  { key: 'origine', header: 'Origine', width: 16 },
  { key: 'source', header: 'Source', width: 24 },
  { key: 'incident', header: 'Incident', width: 15 },
  { key: 'cause', header: 'Cause', width: 36 },
  { key: 'actions', header: 'Actions', width: 32 },
  { key: 'intervenants', header: 'Intervenant(s)', width: 22 },
] as const;

/** Durée lisible pour un document destiné à être LU (PDF) : « 2 h 30 », « 3 j 4 h ».
 *  Le classeur xlsx, lui, garde des minutes brutes pour rester calculable. */
export const fmtDuree = (min: number | null) => {
  if (min == null) return '—';
  if (min < 60) return `${min} min`;
  if (min < 60 * 48) return `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')}`;
  return `${Math.floor(min / 1440)} j ${Math.floor((min % 1440) / 60)} h`;
};

const fmtDh = (d: Date) =>
  d.toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Lome' });

export function construireClasseurCoupures(opts: {
  lignes: LigneCoupureExport[];
  periodeTexte: string;
  perimetreTexte: string;
  colonnes?: Set<string> | null; // sous-ensemble des clés de COLONNES_DETAIL
}): ExcelJS.Workbook {
  const { lignes, periodeTexte, perimetreTexte } = opts;
  const maintenant = new Date();

  // Downtime effectif : colonne calculée, ou borne « jusqu'à maintenant » si ouverte.
  const dtMin = (l: LigneCoupureExport) =>
    l.downtimeMinutes ?? Math.max(0, Math.round((maintenant.getTime() - l.dateDebut.getTime()) / 60000));

  const wb = new ExcelJS.Workbook();
  wb.creator = 'E&M OpS';

  /* ── Synthèse ─────────────────────────────────────────────── */
  const sy = wb.addWorksheet('Synthèse', { views: [{ showGridLines: false }] });
  sy.columns = [{ width: 3 }, { width: 26 }, { width: 15 }, { width: 15 }, { width: 15 }, { width: 15 }, { width: 15 }, { width: 3 }];

  sy.mergeCells('B2:G2');
  const titre = sy.getCell('B2');
  titre.value = 'E&M OpS - Rapport des coupures réseau';
  titre.font = { name: 'Calibri', size: 18, bold: true, color: { argb: 'FFFFFFFF' } };
  titre.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
  titre.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  sy.getRow(2).height = 34;

  sy.mergeCells('B3:G3');
  const sous = sy.getCell('B3');
  sous.value = `${periodeTexte} · généré le ${fmtDh(maintenant)} (heure de Lomé) · périmètre : ${perimetreTexte}`;
  sous.font = { size: 10, color: { argb: GRIS } };
  sy.getRow(3).height = 18;

  const total = lignes.length;
  const enCours = lignes.filter((l) => !l.dateFin).length;
  const downtimeTotal = lignes.reduce((s, l) => s + dtMin(l), 0);
  // Énergie STRICTE (atelier d'énergie + groupe électrogène) ; l'environnement
  // (EN) est une cause passive distincte, mesurée à part.
  const ENERGIE = new Set(['AE', 'GE']);
  const ENVIRONNEMENT = new Set(['EN']);
  const dtEnergie = lignes.filter((l) => l.typeAlarme && ENERGIE.has(l.typeAlarme)).reduce((s, l) => s + dtMin(l), 0);
  const dtEnvironnement = lignes.filter((l) => l.typeAlarme && ENVIRONNEMENT.has(l.typeAlarme)).reduce((s, l) => s + dtMin(l), 0);
  const dtPassif = lignes.filter((l) => l.causeCategorie === 'PASSIF').reduce((s, l) => s + dtMin(l), 0);
  const pct = (v: number) => (downtimeTotal > 0 ? `${Math.round((v / downtimeTotal) * 100)} %` : '0 %');

  const kpis: Array<[string, string | number, string]> = [
    ['Coupures', total, NAVY],
    ['En cours', enCours, RED],
    ['Downtime (h)', Math.round(downtimeTotal / 60), AMBER],
    ['Part énergie', pct(dtEnergie), TEAL],
    ['Part environnement', pct(dtEnvironnement), TEAL],
    ['Part passif', pct(dtPassif), PURPLE],
  ];
  kpis.forEach(([label, val, coul], i) => {
    const col = String.fromCharCode(66 + i); // B..F
    const cv = sy.getCell(`${col}5`), cl = sy.getCell(`${col}6`);
    cv.value = val;
    cv.font = { size: 20, bold: true, color: { argb: coul } };
    cv.alignment = { horizontal: 'center' };
    cl.value = label;
    cl.font = { size: 9, color: { argb: GRIS } };
    cl.alignment = { horizontal: 'center' };
  });
  sy.getRow(5).height = 28;

  let ligneCourante = 8;
  const tableau = (titreT: string, entetes: string[], corps: Array<Array<string | number>>) => {
    sy.mergeCells(`B${ligneCourante}:F${ligneCourante}`);
    const t = sy.getCell(`B${ligneCourante}`);
    t.value = titreT;
    t.font = { size: 11, bold: true, color: { argb: NAVY } };
    const he = sy.getRow(ligneCourante + 1);
    entetes.forEach((h, i) => {
      const c = he.getCell(2 + i);
      c.value = h;
      c.font = { size: 9, bold: true, color: { argb: 'FFFFFFFF' } };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
      c.alignment = { horizontal: i === 0 ? 'left' : 'right', indent: 1 };
    });
    corps.forEach((lg, r) => {
      const row = sy.getRow(ligneCourante + 2 + r);
      lg.forEach((v, i) => {
        const c = row.getCell(2 + i);
        c.value = v;
        c.font = { size: 10 };
        c.alignment = { horizontal: i === 0 ? 'left' : 'right', indent: 1 };
        if (r % 2 === 1) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ZEBRA } };
      });
    });
    ligneCourante += corps.length + 3;
  };

  const agrege = <K extends string>(cle: (l: LigneCoupureExport) => K) => {
    const m = new Map<K, { coupures: number; dt: number; enCours: number }>();
    for (const l of lignes) {
      const k = cle(l);
      const a = m.get(k) ?? { coupures: 0, dt: 0, enCours: 0 };
      a.coupures += 1; a.dt += dtMin(l); if (!l.dateFin) a.enCours += 1;
      m.set(k, a);
    }
    return [...m.entries()].sort((x, y) => y[1].dt - x[1].dt);
  };

  tableau('Downtime par type d’alarme', ['Alarme', 'Coupures', 'Downtime (h)', 'Part'],
    agrege((l) => l.typeAlarme ?? '—').map(([k, a]) => [LIBELLES_ALARME[k] ?? k, a.coupures, Math.round(a.dt / 60), pct(a.dt)]));

  tableau('Répartition par technologie', ['Technologie', 'Coupures', 'Downtime (h)', 'En cours'],
    agrege((l) => l.technologie).map(([k, a]) => [k === 'SITE' ? 'Site entier' : k, a.coupures, Math.round(a.dt / 60), a.enCours]));

  tableau('Répartition par région', ['Région', 'Coupures', 'Downtime (h)', 'En cours'],
    agrege((l) => l.region).map(([k, a]) => [k, a.coupures, Math.round(a.dt / 60), a.enCours]));

  tableau('Top 10 sites par downtime', ['Site', 'Région', 'Coupures', 'Downtime (h)'],
    agrege((l) => `${l.siteNom}|${l.region}`).slice(0, 10)
      .map(([k, a]) => { const [nom, region] = k.split('|'); return [nom, region, a.coupures, Math.round(a.dt / 60)]; }));

  /* ── Détail ───────────────────────────────────────────────── */
  const visibles = COLONNES_DETAIL.filter((c) => !opts.colonnes || opts.colonnes.has(c.key) || opts.colonnes.has(c.header));
  const dt = wb.addWorksheet('Détail', { views: [{ state: 'frozen', ySplit: 1, showGridLines: false }] });
  dt.columns = visibles.map((c) => ({ header: c.header, key: c.key, width: c.width }));
  const head = dt.getRow(1);
  head.height = 22;
  head.eachCell((c) => {
    c.font = { size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
    c.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  });
  dt.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: visibles.length } };

  const idx = new Map<string, number>(visibles.map((c, i) => [c.key, i + 1]));
  lignes.forEach((l, i) => {
    const heritee = l.origine === 'HERITEE';
    const valeurs: Record<string, string | number | null> = {
      // Héritée : indentée sous sa racine (l'export regroupe déjà les lignes).
      site: heritee ? `    ↳ ${l.siteNom}` : l.siteNom,
      region: l.region,
      technologie: l.technologie === 'SITE' ? 'Site entier' : l.technologie,
      debut: fmtDh(l.dateDebut),
      fin: l.dateFin ? fmtDh(l.dateFin) : 'EN COURS',
      // NOMBRE brut de minutes (pas « 2 h 30 ») : la colonne doit rester
      // sommable/filtrable dans Excel. Coupure en cours → cellule VIDE plutôt
      // qu'un tiret, qui polluerait une colonne numérique (la colonne « Fin »
      // porte déjà « EN COURS »).
      downtime: l.dateFin ? (l.downtimeMinutes ?? 0) : null,
      alarme: l.typeAlarme ? (LIBELLES_ALARME[l.typeAlarme] ?? l.typeAlarme) : '',
      categorie: l.causeCategorie ?? '',
      origine: heritee ? `← ${l.origineSiteNom ?? 'amont'}` : 'Locale',
      source: l.source === 'OSS'
        ? (l.priseEnChargePar ? `AUTO · ${l.priseEnChargePar}` : 'AUTO (non prise en charge)')
        : 'Manuelle',
      incident: l.incidentRef ?? '',
      cause: l.cause ?? '',
      actions: l.actions ?? '',
      intervenants: l.intervenants ?? '',
    };
    const row = dt.addRow(visibles.map((c) => valeurs[c.key]));
    row.height = 18;
    const colDowntime = idx.get('downtime');
    row.eachCell((c, colNum) => {
      c.font = { size: 10, color: { argb: heritee ? GRIS : 'FF2C3E50' } };
      const estDowntime = colNum === colDowntime;
      c.alignment = { vertical: 'middle', horizontal: estDowntime ? 'right' : 'left', indent: 1 };
      if (estDowntime) c.numFmt = '0';
      if (i % 2 === 1) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ZEBRA } };
      c.border = { bottom: { style: 'hair', color: { argb: 'FFE5E8EB' } } };
    });
    const cellule = (cle: string) => { const n = idx.get(cle); return n ? row.getCell(n) : null; };
    const fin = cellule('fin');
    if (fin && fin.value === 'EN COURS') {
      fin.font = { size: 10, bold: true, color: { argb: RED } };
      fin.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ROUGE_PALE } };
    }
    const cat = cellule('categorie');
    if (cat && cat.value === 'PASSIF') {
      cat.font = { size: 10, bold: true, color: { argb: PURPLE } };
      cat.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: VIOLET_PALE } };
    } else if (cat && cat.value === 'ACTIF') {
      cat.font = { size: 10, bold: true, color: { argb: TEAL } };
      cat.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: VERT_PALE } };
    }
    const ori = cellule('origine');
    if (ori && heritee) ori.font = { size: 10, bold: true, color: { argb: PURPLE } };
    const src = cellule('source');
    if (src && l.source === 'OSS') {
      // AUTO adoptée = teal ; AUTO brute (hors rapport officiel) = ambre.
      src.font = { size: 10, bold: true, color: { argb: l.priseEnChargePar ? TEAL : AMBER } };
    }
    const inc = cellule('incident');
    if (inc && inc.value) inc.font = { size: 10, bold: true, color: { argb: NAVY } };
  });

  return wb;
}
