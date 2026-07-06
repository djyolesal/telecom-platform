import PDFDocument from 'pdfkit';

const BRAND = '#1B3F6B';
const ACCENT = '#0E7C6B';

function render(build: (doc: PDFKit.PDFDocument) => void): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks: Buffer[] = [];
    doc.on('data', (c) => chunks.push(c as Buffer));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    try {
      build(doc);
      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

/** Logo « Écrou-signal » E&M OpS, vectoriel (écrou hexagonal + signal). */
export function drawLogo(doc: PDFKit.PDFDocument, x: number, y: number, size: number) {
  const k = size / 120; // le tracé est défini dans un viewBox 120×120
  doc.save();
  doc.translate(x, y).scale(k);
  doc.path('M104 60 L82 98 L38 98 L16 60 L38 22 L82 22 Z').lineWidth(9).lineJoin('round').stroke('#FFFFFF');
  doc.circle(60, 64, 7).fill('#FFB020');
  doc.path('M46 52 A18 18 0 0 1 74 52').lineWidth(6.5).lineCap('round').stroke('#3BC9AF');
  doc.path('M40 45 A25 25 0 0 1 80 45').lineWidth(6.5).lineCap('round').stroke('#3BC9AF');
  doc.restore();
}

function header(doc: PDFKit.PDFDocument, title: string, subtitle?: string) {
  const w = doc.page.width;
  doc.rect(0, 0, w, 90).fill(BRAND);
  drawLogo(doc, 46, 16, 46);
  // Nom : « E&M » blanc, « OpS » teal.
  doc.font('Helvetica-Bold').fontSize(17).fillColor('white').text('E&M ', 102, 22, { continued: true });
  doc.fillColor('#3BC9AF').text('OpS');
  doc.font('Helvetica').fontSize(12).fillColor('white').text(title, 102, 44);
  if (subtitle) doc.fontSize(8.5).fillColor('#cdd9e8').text(subtitle, 102, 61);
  // « Ligne de vie » : battement de supervision terminé par un point de géolocalisation.
  doc.path(`M46 80 H${w - 190} l6 -9 l8 16 l6 -7 H${w - 70}`).lineWidth(1.4).lineJoin('round').lineCap('round').stroke('#FFB020');
  doc.circle(w - 62, 80, 2.8).fill('#3BC9AF');
  doc.fillColor('black');
  doc.y = 110;
}

function row(doc: PDFKit.PDFDocument, label: string, value: string) {
  const y = doc.y;
  doc.fontSize(10).fillColor('#666').text(label, 50, y, { width: 170 });
  doc.fillColor('#111').text(value || '—', 220, y, { width: 320 });
  doc.moveDown(0.6);
}

function sectionTitle(doc: PDFKit.PDFDocument, text: string) {
  doc.moveDown(0.6);
  doc.fontSize(12).fillColor(ACCENT).text(text);
  doc.moveTo(50, doc.y + 2).lineTo(doc.page.width - 50, doc.y + 2).strokeColor('#e0e0e0').stroke();
  doc.moveDown(0.6).fillColor('black');
}

const fmtDate = (d?: Date | string | null) =>
  d ? new Date(d).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : '—';

export interface MaintenancePdfData {
  id: string;
  type: string;
  categorie: string;
  equipement: string;
  statut: string;
  description?: string | null;
  observations?: string | null;
  datePlanifiee: Date;
  dateDebut?: Date | null;
  dateFin?: Date | null;
  dureeMinutes?: number | null;
  site?: { nom: string; code: string; region: string } | null;
  technicien?: { nom: string; prenom: string } | null;
  pieces?: Array<{ nom: string; reference?: string | null; quantite: number }>;
}

export async function generateMaintenancePdf(m: MaintenancePdfData): Promise<Buffer> {
  return render((doc) => {
    header(doc, 'Rapport de maintenance', `Réf. ${m.id.slice(0, 8).toUpperCase()}`);

    sectionTitle(doc, 'Site');
    row(doc, 'Nom', m.site?.nom ?? '—');
    row(doc, 'Code', m.site?.code ?? '—');
    row(doc, 'Région', m.site?.region ?? '—');

    sectionTitle(doc, 'Intervention');
    row(doc, 'Type', m.type);
    row(doc, 'Catégorie', m.categorie);
    row(doc, 'Équipement', m.equipement);
    row(doc, 'Statut', m.statut);
    row(doc, 'Technicien', m.technicien ? `${m.technicien.prenom} ${m.technicien.nom}` : '—');
    row(doc, 'Planifiée le', fmtDate(m.datePlanifiee));
    row(doc, 'Début', fmtDate(m.dateDebut));
    row(doc, 'Fin', fmtDate(m.dateFin));
    row(doc, 'Durée', m.dureeMinutes != null ? `${m.dureeMinutes} min` : '—');

    if (m.description) {
      sectionTitle(doc, 'Description');
      doc.fontSize(10).fillColor('#111').text(m.description, { align: 'justify' });
    }
    if (m.observations) {
      sectionTitle(doc, 'Observations');
      doc.fontSize(10).fillColor('#111').text(m.observations, { align: 'justify' });
    }

    if (m.pieces?.length) {
      sectionTitle(doc, 'Pièces de rechange');
      m.pieces.forEach((p) =>
        row(doc, `${p.quantite}× ${p.nom}`, p.reference ? `Réf. ${p.reference}` : '')
      );
    }

    doc.moveDown(2);
    doc.fontSize(8).fillColor('#999').text(
      `Généré le ${fmtDate(new Date())} — E&M OpS`,
      50,
      doc.page.height - 60,
      { align: 'center', width: doc.page.width - 100 }
    );
  });
}

export interface MonthlyReportData {
  annee: number;
  mois: number;
  region?: string;
  sitesActifs: number;
  incidents: { total: number; resolus: number; mttrMinutes: number; mttiMinutes: number };
  maintenances: { total: number; preventives: number; curatives: number };
  carburant: { volumeDepoteLitres: number; coutTotalFCFA: number; nbDepotages: number };
  energie: { consoTotaleKwh: number; coutEstimeFCFA: number };
  manquants?: { totalLitres: number; nbSites: number; nbCamionsEcart?: number; topSites: Array<{ code: string; manquant: number }> };
}

const MOIS = [
  'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
  'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre',
];

export async function generateMonthlyReportPdf(r: MonthlyReportData): Promise<Buffer> {
  return render((doc) => {
    header(
      doc,
      `Rapport mensuel — ${MOIS[r.mois - 1]} ${r.annee}`,
      r.region ? `Région : ${r.region}` : 'Toutes régions'
    );

    sectionTitle(doc, 'Parc');
    row(doc, 'Sites actifs', String(r.sitesActifs));

    sectionTitle(doc, 'Incidents');
    row(doc, 'Total', String(r.incidents.total));
    row(doc, 'Résolus', String(r.incidents.resolus));
    row(doc, 'MTTR moyen', `${r.incidents.mttrMinutes} min`);
    row(doc, 'MTTI moyen', `${r.incidents.mttiMinutes} min`);

    sectionTitle(doc, 'Maintenances');
    row(doc, 'Total', String(r.maintenances.total));
    row(doc, 'Préventives', String(r.maintenances.preventives));
    row(doc, 'Curatives', String(r.maintenances.curatives));

    sectionTitle(doc, 'Carburant');
    row(doc, 'Volume dépoté', `${r.carburant.volumeDepoteLitres.toLocaleString('fr-FR')} L`);
    row(doc, 'Nombre de dépotages', String(r.carburant.nbDepotages));
    row(doc, 'Coût total', `${r.carburant.coutTotalFCFA.toLocaleString('fr-FR')} FCFA`);

    sectionTitle(doc, 'Énergie');
    row(doc, 'Consommation totale', `${r.energie.consoTotaleKwh.toLocaleString('fr-FR')} kWh`);
    row(doc, 'Coût estimé', `${r.energie.coutEstimeFCFA.toLocaleString('fr-FR')} FCFA`);

    if (r.manquants) {
      sectionTitle(doc, r.region ? `Manquants de livraison — ${r.region}` : 'Manquants de livraison');
      row(doc, 'Volume manquant total', `${r.manquants.totalLitres.toLocaleString('fr-FR')} L`);
      row(doc, 'Sites concernés', String(r.manquants.nbSites));
      // Compteur camions : national uniquement (un camion traverse plusieurs régions).
      if (r.manquants.nbCamionsEcart != null) row(doc, 'Camions avec écart', String(r.manquants.nbCamionsEcart));
      if (r.manquants.topSites.length) {
        row(doc, 'Principaux sites', r.manquants.topSites.map((s) => `${s.code} (${s.manquant.toLocaleString('fr-FR')} L)`).join(', '));
      }
    }

    doc.fontSize(8).fillColor('#999').text(
      `Généré automatiquement le ${fmtDate(new Date())} — E&M OpS`,
      50,
      doc.page.height - 60,
      { align: 'center', width: doc.page.width - 100 }
    );
  });
}

export interface PlanLivraisonPdfData {
  numeroBL: string;
  bcNumero?: string | null;
  moisLabel: string;
  annee: number;
  immatriculation: string;
  transporteur?: string | null;
  numeroClient: string;
  volumeChargeLitres: number;
  dateChargement?: Date | null;
  lignes: Array<{ siteCode: string; siteNom: string; region: string; volumePrevuLitres: number }>;
}

export async function generatePlanLivraisonPdf(p: PlanLivraisonPdfData): Promise<Buffer> {
  return render((doc) => {
    header(doc, 'Plan de livraison carburant', `BL ${p.numeroBL} — ${p.moisLabel} ${p.annee}`);

    sectionTitle(doc, 'Chargement');
    row(doc, 'N° bon de livraison', p.numeroBL);
    row(doc, 'Bon de commande', p.bcNumero ?? '—');
    row(doc, 'Transporteur', p.transporteur ?? '—');
    row(doc, 'N° client', p.numeroClient);
    row(doc, 'Camion', p.immatriculation);
    row(doc, 'Volume chargé', `${Math.round(p.volumeChargeLitres)} L`);
    row(doc, 'Date chargement', fmtDate(p.dateChargement));

    sectionTitle(doc, `Sites à approvisionner (${p.lignes.length})`);

    // En-tête du tableau
    const cols = { site: 50, region: 250, vol: 460 };
    const headerY = doc.y;
    doc.fontSize(9).fillColor('#666');
    doc.text('Site', cols.site, headerY);
    doc.text('Région', cols.region, headerY);
    doc.text('Prévu (L)', cols.vol, headerY, { width: 90, align: 'right' });
    doc.moveTo(50, doc.y + 2).lineTo(doc.page.width - 50, doc.y + 2).strokeColor('#e0e0e0').stroke();
    doc.moveDown(0.5);

    let total = 0;
    p.lignes.forEach((l) => {
      total += l.volumePrevuLitres;
      const y = doc.y;
      doc.fontSize(9).fillColor('#111');
      doc.text(`${l.siteCode} — ${l.siteNom}`, cols.site, y, { width: 190 });
      doc.text(l.region, cols.region, y, { width: 190 });
      doc.text(String(Math.round(l.volumePrevuLitres)), cols.vol, y, { width: 90, align: 'right' });
      doc.moveDown(0.5);
      if (doc.y > doc.page.height - 80) doc.addPage();
    });

    doc.moveTo(50, doc.y + 2).lineTo(doc.page.width - 50, doc.y + 2).strokeColor('#e0e0e0').stroke();
    doc.moveDown(0.5);
    const ty = doc.y;
    doc.fontSize(10).fillColor(BRAND);
    doc.text('TOTAL', cols.region, ty);
    doc.text(`${Math.round(total)} L`, cols.vol, ty, { width: 90, align: 'right' });

    doc.fontSize(8).fillColor('#999').text(
      `Généré le ${fmtDate(new Date())} — E&M OpS`,
      50, doc.page.height - 60, { align: 'center', width: doc.page.width - 100 }
    );
  });
}

export interface DepotagePdfData {
  id: string;
  dateDepotage: Date;
  site?: { code: string; nom: string; region: string } | null;
  technicien?: { nom: string; prenom: string } | null;
  volumeLitres: number;
  stockAvantLitres?: number | null;
  stockApresLitres?: number | null;
  volumeAnnonceLitres?: number | null;
  ecartLivraisonLitres?: number | null;
  gasoilAttenduLitres?: number | null;
  ecartConsoLitres?: number | null;
  analyseDepotage?: string | null;
  fournisseur?: string | null;
  numeroBonLivraison?: string | null;
  observations?: string | null;
  heuresGE?: Array<{ numero?: number | null; puissanceKva?: number | null; statut?: string | null; indexHeuresGE: number }>;
  signatures?: Array<{ label: string; nom?: string | null; image: Buffer | null }>;
  photos?: Buffer[];
}

const L = (n?: number | null) => (n == null ? '—' : `${Math.round(Number(n)).toLocaleString('fr-FR')} L`);
const SIGNED = (n?: number | null) => (n == null ? '—' : `${Number(n) > 0 ? '+' : ''}${Math.round(Number(n)).toLocaleString('fr-FR')} L`);

export async function generateDepotagePdf(d: DepotagePdfData): Promise<Buffer> {
  return render((doc) => {
    header(doc, 'Bordereau de dépotage', `Réf. ${d.id.slice(0, 8).toUpperCase()} — ${fmtDate(d.dateDepotage)}`);

    sectionTitle(doc, 'Site');
    row(doc, 'Nom', d.site?.nom ?? '—');
    row(doc, 'Code', d.site?.code ?? '—');
    row(doc, 'Région', d.site?.region ?? '—');

    sectionTitle(doc, 'Livraison');
    row(doc, 'Volume livré (jauge)', L(d.volumeLitres));
    row(doc, 'Stock avant', L(d.stockAvantLitres));
    row(doc, 'Stock après', L(d.stockApresLitres));
    row(doc, 'Volume annoncé (BL)', L(d.volumeAnnonceLitres));
    row(doc, 'Fournisseur', d.fournisseur ?? '—');
    row(doc, 'Bon de livraison', d.numeroBonLivraison ?? '—');
    row(doc, 'Technicien', d.technicien ? `${d.technicien.prenom} ${d.technicien.nom}` : '—');

    if (d.volumeAnnonceLitres != null || d.ecartLivraisonLitres != null || d.ecartConsoLitres != null || d.analyseDepotage) {
      sectionTitle(doc, 'Réconciliation');
      row(doc, 'Écart livraison', SIGNED(d.ecartLivraisonLitres));
      row(doc, 'Gasoil attendu', L(d.gasoilAttenduLitres));
      row(doc, 'Écart conso', SIGNED(d.ecartConsoLitres));
      if (d.analyseDepotage) {
        doc.moveDown(0.3).fontSize(9).fillColor('#444').text(d.analyseDepotage, 50, doc.y, { width: doc.page.width - 100, align: 'justify' });
        doc.moveDown(0.4).fillColor('black');
      }
    }

    if (d.heuresGE?.length) {
      sectionTitle(doc, 'Heures groupes électrogènes');
      d.heuresGE.forEach((h) =>
        row(
          doc,
          h.numero != null ? `GE n°${h.numero} · ${Math.round(Number(h.puissanceKva ?? 0))} kVA · ${h.statut === 'GE_PERMANENT' ? 'permanent' : 'secours'}` : 'GE',
          `${Math.round(h.indexHeuresGE)} h`
        )
      );
    }

    if (d.observations) {
      sectionTitle(doc, 'Observations');
      doc.fontSize(10).fillColor('#111').text(d.observations, { align: 'justify' });
    }

    const sigs = (d.signatures ?? []).filter((s) => s.image);
    if (sigs.length) {
      sectionTitle(doc, 'Signatures');
      if (doc.y > doc.page.height - 160) doc.addPage();
      const startY = doc.y;
      const colW = (doc.page.width - 100) / 3;
      sigs.slice(0, 3).forEach((s, i) => {
        const x = 50 + i * colW;
        try {
          doc.image(s.image as Buffer, x, startY, { fit: [colW - 10, 60], align: 'center' });
        } catch {
          /* signature illisible → on saute l'image */
        }
        doc.fontSize(8).fillColor('#666').text(`${s.label}${s.nom ? ` — ${s.nom}` : ''}`, x, startY + 64, { width: colW - 10 });
      });
      doc.y = startY + 90;
    }

    const photos = d.photos ?? [];
    if (photos.length) {
      sectionTitle(doc, `Photos du dépotage (${photos.length})`);
      const colW = (doc.page.width - 100 - 20) / 3; // 3 colonnes, 10px de gouttière
      let i = 0;
      for (const buf of photos) {
        const col = i % 3;
        if (col === 0 && doc.y > doc.page.height - (colW + 40)) doc.addPage();
        const x = 50 + col * (colW + 10);
        const y = doc.y;
        try {
          doc.image(buf, x, y, { fit: [colW, colW], align: 'center' });
        } catch {
          /* photo illisible → on saute */
        }
        if (col === 2) doc.y = y + colW + 10;
        i++;
      }
      if (photos.length % 3 !== 0) doc.moveDown(colW / 12);
    }

    doc.fontSize(8).fillColor('#999').text(
      `Généré le ${fmtDate(new Date())} — E&M OpS`,
      50, doc.page.height - 50, { align: 'center', width: doc.page.width - 100 }
    );
  });
}

export const pdfService = { generateMaintenancePdf, generateMonthlyReportPdf, generatePlanLivraisonPdf, generateDepotagePdf };
