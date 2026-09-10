import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { drawLogo } from './pdf.service';

/**
 * Export DESSINÉ du rapport de conformité des maintenances passives, sur le
 * SEUL mois sélectionné :
 *  - en tête, le résumé par prestataire avec les mêmes repères visuels que la
 *    page (bande d'évolution 6 mois colorée, barre de conformité) ;
 *  - en bas, la matrice sites × tâches contractuelles : OK / NOK / N/A.
 * Le PDF reprend la même matière avec de vrais graphes (barres) dessinés.
 */

const NAVY = 'FF1B3F6B', TEAL = 'FF0E7C6B', AMBER = 'FFE67E22', RED = 'FFC0392B',
      ZEBRA = 'FFF7F9FB', GRIS = 'FF6B7280',
      ROUGE_PALE = 'FFFDECEA', VERT_PALE = 'FFE8F6F3', GRIS_PALE = 'FFF1F2F4';

export interface EvolutionMois { mois: string; label: string; dues: number; realisees: number; taux: number | null }
export interface PrestataireConformite {
  prestataireNom: string;
  dues: number;
  realisees: number;
  tauxContractuel: number | null;
  sitesAvecDu: number;
  sitesConformes: number;
  invalidees: number;
  evolution: EvolutionMois[];
}
export interface TacheColonne { numero: number; key: string; libelle: string }
export interface LigneSiteMatrice {
  site: string; region: string; prestataireId: string;
  statuts: Record<string, 'OK' | 'NOK' | 'NA'>;
  conforme: boolean;
}
export interface DonneesConformite {
  labelMois: string;
  region?: string;
  parPrestataire: PrestataireConformite[];
  taches: TacheColonne[];
  sites: LigneSiteMatrice[];
  nomsPrestataires: Map<string, string>;
}

const couleurTaux = (t: number) => (t >= 90 ? TEAL : t >= 70 ? AMBER : RED);
const fmtDh = (d: Date) =>
  d.toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Lome' });

/* ════════════════════════════ XLSX ════════════════════════════ */

export async function buildConformiteXlsx(d: DonneesConformite): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'E&M OpS';
  wb.created = new Date();

  /* ── Feuille unique : résumé en haut, matrice en bas ── */
  const nbColTaches = d.taches.length;
  const nbCol = 3 + nbColTaches + 1; // Site | Région | Prestataire | tâches... | Site conforme
  const ws = wb.addWorksheet('Conformité', { views: [{ showGridLines: false }] });
  ws.columns = [
    { width: 26 }, { width: 13 }, { width: 22 },
    ...d.taches.map(() => ({ width: 6.5 })),
    { width: 12 },
  ];

  ws.mergeCells(1, 1, 1, nbCol);
  const titre = ws.getCell(1, 1);
  titre.value = `E&M OpS - Conformité des maintenances passives · ${d.labelMois}`;
  titre.font = { size: 16, bold: true, color: { argb: 'FFFFFFFF' } };
  titre.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
  titre.alignment = { vertical: 'middle', indent: 1 };
  ws.getRow(1).height = 30;
  ws.mergeCells(2, 1, 2, nbCol);
  const sous = ws.getCell(2, 1);
  sous.value = `Dû contractuel du mois (catalogue × sites)${d.region ? ` · ${d.region}` : ''} · généré le ${fmtDh(new Date())} (heure de Lomé)`;
  sous.font = { size: 9, color: { argb: GRIS } };

  /* ── Résumé par prestataire, bande d'évolution + barre comme sur la page ── */
  let r = 4;
  const nbMoisEvo = d.parPrestataire[0]?.evolution.length ?? 6;
  const entetes = ['Prestataire', 'Tâches dues', 'Réalisées', 'Sites conformes', 'Invalidées',
    ...Array.from({ length: nbMoisEvo }, (_, i) => d.parPrestataire[0]?.evolution[i]?.label ?? ''), 'Conformité'];
  entetes.forEach((h, i) => {
    const c = ws.getRow(r).getCell(1 + i);
    c.value = h;
    c.font = { size: 9, bold: true, color: { argb: 'FFFFFFFF' } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
    c.alignment = { horizontal: i === 0 ? 'left' : 'center', vertical: 'middle', indent: i === 0 ? 1 : 0 };
  });
  ws.getRow(r).height = 18;
  r++;
  for (const p of d.parPrestataire) {
    const row = ws.getRow(r);
    row.height = 18;
    row.getCell(1).value = p.prestataireNom;
    row.getCell(1).font = { size: 10, bold: true };
    row.getCell(2).value = p.dues;
    row.getCell(3).value = p.realisees;
    row.getCell(3).font = { size: 10, color: { argb: p.realisees < p.dues ? RED : TEAL } };
    row.getCell(4).value = p.sitesAvecDu ? `${p.sitesConformes}/${p.sitesAvecDu}` : '—';
    row.getCell(4).font = { size: 10, color: { argb: p.sitesConformes < p.sitesAvecDu ? RED : TEAL } };
    row.getCell(5).value = p.invalidees || '';
    row.getCell(5).font = { size: 10, bold: true, color: { argb: RED } };
    // Bande d'évolution : une cellule par mois, colorée par le taux du dû.
    p.evolution.forEach((e, i) => {
      const c = row.getCell(6 + i);
      if (e.dues === 0) {
        c.value = '·';
        c.font = { size: 9, color: { argb: GRIS } };
      } else {
        c.value = e.taux! / 100;
        c.numFmt = '0%';
        c.font = { size: 9, bold: true, color: { argb: 'FFFFFFFF' } };
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: couleurTaux(e.taux!) } };
      }
      c.alignment = { horizontal: 'center', vertical: 'middle' };
    });
    const cTaux = row.getCell(6 + nbMoisEvo);
    if (p.tauxContractuel == null) {
      cTaux.value = 'aucun dû';
      cTaux.font = { size: 9, color: { argb: GRIS } };
    } else {
      cTaux.value = p.tauxContractuel / 100;
      cTaux.numFmt = '0%';
      cTaux.font = { size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
      cTaux.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: couleurTaux(p.tauxContractuel) } };
    }
    cTaux.alignment = { horizontal: 'center', vertical: 'middle' };
    r++;
  }

  /* ── Matrice sites × tâches ── */
  r += 2;
  ws.mergeCells(r, 1, r, nbCol);
  const t2 = ws.getCell(r, 1);
  t2.value = 'État par site - chaque colonne est une tâche contractuelle (OK à jour · NOK due non réalisée · N/A non applicable)';
  t2.font = { size: 11, bold: true, color: { argb: NAVY } };
  r++;
  const he = ws.getRow(r);
  he.height = 86;
  ['Site', 'Région', 'Prestataire'].forEach((h, i) => {
    const c = he.getCell(1 + i);
    c.value = h;
    c.font = { size: 9, bold: true, color: { argb: 'FFFFFFFF' } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
    c.alignment = { horizontal: 'left', vertical: 'bottom', indent: 1 };
  });
  d.taches.forEach((t, i) => {
    const c = he.getCell(4 + i);
    c.value = `${t.numero}. ${t.libelle}`;
    c.font = { size: 8, bold: true, color: { argb: 'FFFFFFFF' } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
    c.alignment = { textRotation: 75, vertical: 'bottom', horizontal: 'center', wrapText: true };
  });
  const cConf = he.getCell(4 + nbColTaches);
  cConf.value = 'Site conforme';
  cConf.font = { size: 8, bold: true, color: { argb: 'FFFFFFFF' } };
  cConf.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
  cConf.alignment = { textRotation: 75, vertical: 'bottom', horizontal: 'center' };
  ws.views = [{ state: 'frozen', ySplit: r, xSplit: 1, showGridLines: false }];
  ws.autoFilter = { from: { row: r, column: 1 }, to: { row: r, column: 3 } };
  r++;
  let zeb = false;
  for (const site of d.sites) {
    const row = ws.getRow(r);
    row.height = 15;
    row.getCell(1).value = site.site;
    row.getCell(2).value = site.region;
    row.getCell(3).value = d.nomsPrestataires.get(site.prestataireId) ?? '';
    [1, 2, 3].forEach((i) => {
      row.getCell(i).font = { size: 9 };
      if (zeb) row.getCell(i).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ZEBRA } };
    });
    d.taches.forEach((t, i) => {
      const c = row.getCell(4 + i);
      const st = site.statuts[t.key];
      c.value = st === 'NA' ? '–' : st;
      c.alignment = { horizontal: 'center', vertical: 'middle' };
      c.font = { size: 8, bold: st === 'NOK', color: { argb: st === 'OK' ? TEAL : st === 'NOK' ? RED : GRIS } };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: st === 'OK' ? VERT_PALE : st === 'NOK' ? ROUGE_PALE : GRIS_PALE } };
    });
    const cc = row.getCell(4 + nbColTaches);
    cc.value = site.conforme ? 'OK' : 'NOK';
    cc.alignment = { horizontal: 'center', vertical: 'middle' };
    cc.font = { size: 9, bold: true, color: { argb: site.conforme ? TEAL : RED } };
    cc.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: site.conforme ? VERT_PALE : ROUGE_PALE } };
    zeb = !zeb;
    r++;
  }

  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

/* ════════════════════════════ PDF ════════════════════════════ */

const P_NAVY = '#1B3F6B', P_TEAL = '#0E7C6B', P_AMBER = '#E67E22', P_RED = '#C0392B',
      P_GRIS = '#6B7280', P_FOND = '#F7F9FB', P_VERT_PALE = '#E8F6F3', P_ROUGE_PALE = '#FDECEA', P_GRIS_PALE = '#F1F2F4';
const pCouleur = (t: number) => (t >= 90 ? P_TEAL : t >= 70 ? P_AMBER : P_RED);

export async function buildConformitePdf(d: DonneesConformite): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 36, bufferPages: true });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const fini = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));
  const W = doc.page.width, M = 36, INNER = W - 2 * M;

  /* ── En-tête bandeau ── */
  const bandeau = () => {
    doc.rect(0, 0, W, 64).fill(P_NAVY);
    drawLogo(doc, M, 12, 40);
    doc.fill('#FFFFFF').font('Helvetica-Bold').fontSize(16)
      .text('Conformité des maintenances passives', M + 52, 15, { lineBreak: false });
    doc.font('Helvetica').fontSize(10).fillOpacity(0.85)
      .text(`${d.labelMois}${d.region ? ` · ${d.region}` : ''} · dû contractuel par site`, M + 52, 38, { lineBreak: false });
    doc.fillOpacity(1);
  };
  bandeau();

  /* ── Cartes KPI ── */
  const dues = d.parPrestataire.reduce((s, p) => s + p.dues, 0);
  const realisees = d.parPrestataire.reduce((s, p) => s + p.realisees, 0);
  const sitesAvecDu = d.parPrestataire.reduce((s, p) => s + p.sitesAvecDu, 0);
  const sitesConformes = d.parPrestataire.reduce((s, p) => s + p.sitesConformes, 0);
  const taux = dues ? Math.round((realisees / dues) * 100) : null;
  const kpis: Array<[string, string, string]> = [
    ['Tâches dues', String(dues), P_NAVY],
    ['Réalisées', String(realisees), P_TEAL],
    ['Non réalisées', String(dues - realisees), dues - realisees > 0 ? P_RED : P_GRIS],
    ['Conformité', taux != null ? `${taux}%` : '—', taux != null ? pCouleur(taux) : P_GRIS],
    ['Sites conformes', sitesAvecDu ? `${sitesConformes}/${sitesAvecDu}` : '—', sitesConformes < sitesAvecDu ? P_RED : P_TEAL],
  ];
  let y = 80;
  const kw = (INNER - 4 * 10) / 5;
  kpis.forEach(([label, val, coul], i) => {
    const x = M + i * (kw + 10);
    doc.roundedRect(x, y, kw, 52, 6).fill(P_FOND);
    doc.fill(coul).font('Helvetica-Bold').fontSize(20).text(val, x, y + 8, { width: kw, align: 'center' });
    doc.fill(P_GRIS).font('Helvetica').fontSize(8).text(label.toUpperCase(), x, y + 36, { width: kw, align: 'center' });
  });
  y += 68;

  /* ── Résumé par prestataire : barre de conformité + mini-graphe 6 mois ── */
  doc.fill(P_NAVY).font('Helvetica-Bold').fontSize(11).text('Par prestataire', M, y);
  y += 18;
  for (const p of d.parPrestataire) {
    if (y > doc.page.height - 96) { doc.addPage(); bandeau(); y = 80; }
    doc.roundedRect(M, y, INNER, 46, 6).fill(P_FOND);
    doc.fill('#111827').font('Helvetica-Bold').fontSize(10).text(p.prestataireNom, M + 12, y + 8, { width: 200, lineBreak: false });
    doc.fill(P_GRIS).font('Helvetica').fontSize(8)
      .text(`${p.realisees}/${p.dues} tâches dues réalisées · ${p.sitesAvecDu ? `${p.sitesConformes}/${p.sitesAvecDu} sites conformes` : 'aucun dû'}${p.invalidees ? ` · ${p.invalidees} invalidée(s)` : ''}`,
        M + 12, y + 26, { width: 250, lineBreak: false });
    // Barre de conformité (comme la page).
    const bx = M + 280, bw = 170, by = y + 20;
    doc.roundedRect(bx, by, bw, 7, 3.5).fill('#E5E7EB');
    if (p.tauxContractuel != null && p.tauxContractuel > 0) {
      doc.roundedRect(bx, by, Math.max(8, (bw * p.tauxContractuel) / 100), 7, 3.5).fill(pCouleur(p.tauxContractuel));
    }
    doc.fill(p.tauxContractuel != null ? pCouleur(p.tauxContractuel) : P_GRIS).font('Helvetica-Bold').fontSize(12)
      .text(p.tauxContractuel != null ? `${p.tauxContractuel}%` : '—', bx + bw + 8, by - 3, { lineBreak: false });
    // Mini-graphe : 6 barres mensuelles, hauteur et couleur = % du dû.
    const gx = bx + bw + 60, barW = 14, gap = 6, gBottom = y + 38, gH = 26;
    p.evolution.forEach((e, i) => {
      const x = gx + i * (barW + gap);
      if (e.dues === 0) {
        doc.rect(x, gBottom - 2, barW, 2).fill('#D1D5DB');
      } else {
        const h = Math.max(3, (gH * e.taux!) / 100);
        doc.rect(x, gBottom - h, barW, h).fill(pCouleur(e.taux!));
      }
      doc.fill(P_GRIS).font('Helvetica').fontSize(5.5).text(e.label, x - 2, gBottom + 2, { width: barW + 4, align: 'center', lineBreak: false });
    });
    y += 54;
  }

  /* ── Matrice sites × tâches ── */
  doc.addPage();
  bandeau();
  y = 76;
  doc.fill(P_NAVY).font('Helvetica-Bold').fontSize(11).text('État par site', M, y, { lineBreak: false });
  doc.fill(P_GRIS).font('Helvetica').fontSize(8)
    .text('OK à jour · NOK due non réalisée · – non applicable. Les numéros renvoient aux tâches du catalogue contractuel ci-dessous.', M + 90, y + 2, { lineBreak: false });
  y += 16;
  // Légende du catalogue (2 colonnes).
  const demiw = INNER / 2;
  const moitie = Math.ceil(d.taches.length / 2);
  d.taches.forEach((t, i) => {
    const col = i < moitie ? 0 : 1;
    const ly = y + (i % moitie) * 10;
    doc.fill(P_GRIS).font('Helvetica').fontSize(7)
      .text(`${t.numero}. ${t.libelle}`, M + col * demiw, ly, { width: demiw - 12, lineBreak: false, ellipsis: true });
  });
  y += moitie * 10 + 10;

  const colSite = 150, colRegion = 62, colPresta = 100, colConf = 40;
  const colT = (INNER - colSite - colRegion - colPresta - colConf) / d.taches.length;
  const enTeteMatrice = () => {
    doc.rect(M, y, INNER, 16).fill(P_NAVY);
    doc.fill('#FFFFFF').font('Helvetica-Bold').fontSize(7.5);
    doc.text('Site', M + 4, y + 4.5, { lineBreak: false });
    doc.text('Région', M + colSite + 2, y + 4.5, { lineBreak: false });
    doc.text('Prestataire', M + colSite + colRegion + 2, y + 4.5, { lineBreak: false });
    d.taches.forEach((t, i) => {
      doc.text(String(t.numero), M + colSite + colRegion + colPresta + i * colT, y + 4.5, { width: colT, align: 'center', lineBreak: false });
    });
    doc.text('Conf.', M + INNER - colConf, y + 4.5, { width: colConf, align: 'center', lineBreak: false });
    y += 16;
  };
  enTeteMatrice();
  let zebre = false;
  for (const site of d.sites) {
    if (y > doc.page.height - 60) { doc.addPage(); bandeau(); y = 76; enTeteMatrice(); zebre = false; }
    if (zebre) doc.rect(M, y, INNER, 12).fill(P_FOND);
    doc.fill('#111827').font('Helvetica').fontSize(7.5);
    doc.text(site.site, M + 4, y + 2.5, { width: colSite - 8, lineBreak: false, ellipsis: true });
    doc.fill(P_GRIS).text(site.region, M + colSite + 2, y + 2.5, { width: colRegion - 4, lineBreak: false, ellipsis: true });
    doc.text(d.nomsPrestataires.get(site.prestataireId) ?? '', M + colSite + colRegion + 2, y + 2.5, { width: colPresta - 4, lineBreak: false, ellipsis: true });
    d.taches.forEach((t, i) => {
      const st = site.statuts[t.key];
      const x = M + colSite + colRegion + colPresta + i * colT + colT / 2;
      if (st === 'NA') {
        doc.fill('#D1D5DB').font('Helvetica').fontSize(7).text('–', x - 2, y + 2.5, { lineBreak: false });
      } else {
        doc.circle(x, y + 6, 3.4).fill(st === 'OK' ? P_TEAL : P_RED);
      }
    });
    const cx = M + INNER - colConf;
    doc.roundedRect(cx + 6, y + 1.5, colConf - 12, 9.5, 3).fill(site.conforme ? P_VERT_PALE : P_ROUGE_PALE);
    doc.fill(site.conforme ? P_TEAL : P_RED).font('Helvetica-Bold').fontSize(6.5)
      .text(site.conforme ? 'OK' : 'NOK', cx + 6, y + 3.5, { width: colConf - 12, align: 'center', lineBreak: false });
    zebre = !zebre;
    y += 12;
  }

  /* ── Pieds de page ── */
  const pages = doc.bufferedPageRange();
  for (let i = 0; i < pages.count; i++) {
    doc.switchToPage(i);
    // Écrire sous la marge basse déclenche une page automatique : on la
    // neutralise le temps du pied de page.
    const margeBasse = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.fill(P_GRIS).font('Helvetica').fontSize(7)
      .text(`E&M OpS · généré le ${fmtDh(new Date())} (heure de Lomé) · page ${i + 1}/${pages.count}`,
        M, doc.page.height - 24, { width: INNER, align: 'center', lineBreak: false });
    doc.page.margins.bottom = margeBasse;
  }
  doc.end();
  return fini;
}
