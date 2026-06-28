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

function header(doc: PDFKit.PDFDocument, title: string, subtitle?: string) {
  doc.rect(0, 0, doc.page.width, 90).fill(BRAND);
  doc.fillColor('white').fontSize(20).text('📡 TélécomOps', 50, 30);
  doc.fontSize(13).text(title, 50, 56);
  if (subtitle) doc.fontSize(9).fillColor('#cdd9e8').text(subtitle, 50, 73);
  doc.fillColor('black').moveDown(2);
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
      `Généré le ${fmtDate(new Date())} — TélécomOps`,
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

    doc.fontSize(8).fillColor('#999').text(
      `Généré automatiquement le ${fmtDate(new Date())} — TélécomOps`,
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
      `Généré le ${fmtDate(new Date())} — TélécomOps`,
      50, doc.page.height - 60, { align: 'center', width: doc.page.width - 100 }
    );
  });
}

export const pdfService = { generateMaintenancePdf, generateMonthlyReportPdf, generatePlanLivraisonPdf };
