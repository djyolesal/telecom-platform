import PDFDocument from 'pdfkit';
import { L_TYPE_MAINTENANCE, L_STATUT_MAINTENANCE, L_CATEGORIE_EQUIPEMENT, libelle } from '../utils/libelles';
import QRCode from 'qrcode';

const BRAND = '#1B3F6B';
const GRIS_PDF = '#6B7280';
const ACCENT = '#0E7C6B';

function render(
  build: (doc: PDFKit.PDFDocument) => void,
  options: { bufferPages?: boolean } = {},
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    // `bufferPages` garde les pages en mémoire : indispensable pour écrire
    // « page 3 / 47 », qu'on ne connaît qu'une fois le document fini.
    const doc = new PDFDocument({ size: 'A4', margin: 50, bufferPages: options.bufferPages ?? false });
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
/**
 * @param couleurTrait couleur de l'écrou. Blanc par défaut (bandeau foncé) ;
 *   la page de garde co-signée est sur fond BLANC, où un écrou blanc serait
 *   invisible — elle passe donc la couleur de la marque.
 */
export function drawLogo(doc: PDFKit.PDFDocument, x: number, y: number, size: number, couleurTrait = '#FFFFFF') {
  const k = size / 120; // le tracé est défini dans un viewBox 120×120
  doc.save();
  doc.translate(x, y).scale(k);
  doc.path('M104 60 L82 98 L38 98 L16 60 L38 22 L82 22 Z').lineWidth(9).lineJoin('round').stroke(couleurTrait);
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
  doc.moveDown(0.5);
  // Un titre de section ne doit jamais rester orphelin en bas de page.
  if (doc.y > doc.page.height - 110) doc.addPage();
  const x = 50, w = doc.page.width - 100, h = 20, y = doc.y;
  doc.roundedRect(x, y, w, h, 3).fill('#EEF3F8');
  doc.rect(x, y, 3.5, h).fill(ACCENT); // onglet d'accent à gauche
  doc.font('Helvetica-Bold').fontSize(10.5).fillColor(BRAND).text(text, x + 12, y + 5.5, { characterSpacing: 0.3 });
  doc.font('Helvetica').fillColor('black');
  doc.y = y + h + 8;
}

/**
 * Bloc de signatures : jusqu'à deux emplacements côte à côte, dans des cadres.
 * Un saut de page est forcé si le bloc ne tient pas — sans ça les signatures
 * étaient tronquées en bas de page après une grille de photos. Un emplacement
 * sans image reste VISIBLE (« Signature manquante ») pour que l'absence soit
 * explicite au lieu de disparaître.
 */
function signatureSlots(
  doc: PDFKit.PDFDocument,
  slots: Array<{ label: string; nom?: string | null; image: Buffer | null }>,
) {
  const items = slots.slice(0, 3);
  if (!items.length) return;
  const boxH = 78, footer = 34, gap = items.length >= 3 ? 16 : 26;
  // Colonnes adaptées au nombre de signatures (2 ou 3 côte à côte).
  const usable = doc.page.width - 100;
  const boxW = (usable - gap * (items.length - 1)) / items.length;
  if (doc.y + 30 + boxH + footer > doc.page.height - 55) doc.addPage();
  sectionTitle(doc, 'Signatures');
  const y = doc.y;
  const xs = items.map((_, i) => 50 + i * (boxW + gap));
  items.forEach((s, i) => {
    const x = xs[i];
    doc.roundedRect(x, y, boxW, boxH, 4).lineWidth(0.8).strokeColor('#cfd8e3').stroke();
    if (s.image) {
      try {
        doc.image(s.image, x + 8, y + 8, { fit: [boxW - 16, boxH - 16], align: 'center', valign: 'center' });
      } catch {
        doc.fontSize(8).fillColor('#bbb').text('(signature illisible)', x, y + boxH / 2 - 5, { width: boxW, align: 'center' });
      }
    } else {
      doc.moveTo(x + 18, y + boxH - 22).lineTo(x + boxW - 18, y + boxH - 22)
        .lineWidth(0.6).dash(2, { space: 2 }).strokeColor('#cfd8e3').stroke().undash();
      doc.fontSize(7.5).fillColor('#b4b4b4').text('Signature manquante', x, y + boxH - 16, { width: boxW, align: 'center' });
    }
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#333').text(s.label, x + 2, y + boxH + 7, { width: boxW });
    doc.font('Helvetica').fontSize(9).fillColor('#666').text(s.nom || '—', x + 2, y + boxH + 19, { width: boxW });
  });
  doc.font('Helvetica').fillColor('black');
  doc.y = y + boxH + footer + 4;
}

const fmtDate = (d?: Date | string | null) =>
  d ? new Date(d).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : '—';

export interface RelevePdf {
  source: string;
  groupeNumero?: number | null;
  indexHeuresGE?: number | null;
  heuresFonctGE?: number | null;
  volumeGasoilLitres?: number | null;
  gasoilConsommeLitres?: number | null;
  indexCompteur?: number | null;
  consommationKwh?: number | null;
  puissanceKva?: number | null;
}

export interface MaintenancePdfData {
  id: string;
  reference?: string | null;
  type: string;
  categorie: string;
  equipement: string;
  statut: string;
  description?: string | null;
  observations?: string | null;
  analyseEnergie?: string | null;
  datePlanifiee: Date;
  dateDebut?: Date | null;
  dateFin?: Date | null;
  dureeMinutes?: number | null;
  dureeSuspendueMinutes?: number | null;
  nomAgentSecurite?: string | null;
  site?: { nom: string; code: string; region: string } | null;
  technicien?: { nom: string; prenom: string } | null;
  prestataire?: { nom: string } | null;
  pieces?: Array<{ nom: string; reference?: string | null; quantite: number }>;
  releves?: RelevePdf[];
  // Images (buffers MinIO) - facultatives, la fiche reste générable sans.
  photosAvant?: Buffer[];
  photosApres?: Buffer[];
  totalPhotosAvant?: number;
  totalPhotosApres?: number;
  signatureTechnicien?: Buffer | null;
  signatureAgent?: Buffer | null;
  /** Mention affichée quand photos/signatures proviennent de l'incident lié
   *  (curative auto-créée à la résolution : aucune preuve propre). */
  notePreuves?: string | null;
}

const fmtN = (v: number | null | undefined, suffixe = '') =>
  v == null ? '—' : `${Number(v).toLocaleString('fr-FR')}${suffixe}`;

/** Grille de photos 3 par ligne occupant TOUTE la largeur, saut de page auto. */
function grillePhotos(doc: PDFKit.PDFDocument, titre: string, photos: Buffer[], total: number) {
  if (!photos.length) return;
  sectionTitle(doc, `${titre} (${total})`);
  const cols = 3, gap = 10, x0 = 50;
  const usable = doc.page.width - 100;          // pleine largeur utile (~495)
  const cellW = (usable - gap * (cols - 1)) / cols; // ~158 par cellule
  const cellH = 150;                            // cellules plus hautes = meilleure lisibilité
  let col = 0, y = doc.y;
  for (const p of photos) {
    if (col === 0 && y + cellH > doc.page.height - 70) { doc.addPage(); y = 50; }
    const x = x0 + col * (cellW + gap);
    doc.roundedRect(x, y, cellW, cellH, 3).lineWidth(0.5).strokeColor('#d8dee6').stroke();
    try {
      doc.image(p, x + 2, y + 2, { fit: [cellW - 4, cellH - 4], align: 'center', valign: 'center' });
    } catch { /* image illisible : le cadre reste */ }
    col++;
    if (col === cols) { col = 0; y += cellH + gap; }
  }
  doc.y = (col === 0 ? y : y + cellH + gap);
  if (total > photos.length) {
    doc.fontSize(8).fillColor('#888').text(`+ ${total - photos.length} photo(s) supplémentaire(s) consultable(s) dans l'application.`, x0, doc.y);
    doc.moveDown(0.4);
  }
  doc.fillColor('black');
}

/**
 * Dessine UN rapport d'intervention dans un document déjà ouvert.
 *
 * Extrait de `generateMaintenancePdf` pour qu'un recueil de plusieurs
 * interventions (export par période) rende EXACTEMENT la même page que
 * l'export unitaire : un seul dessin, donc aucune divergence possible entre
 * le document qu'un prestataire reçoit pour une intervention et celui que le
 * manager édite pour tout un mois.
 */
export function dessinerRapportMaintenance(doc: PDFKit.PDFDocument, m: MaintenancePdfData): void {

  header(doc, 'Rapport de maintenance', `Réf. ${m.reference ?? m.id.slice(0, 8).toUpperCase()}`);

  sectionTitle(doc, 'Site');
  row(doc, 'Nom', m.site?.nom ?? '—');
  row(doc, 'Code', m.site?.code ?? '—');
  row(doc, 'Région', m.site?.region ?? '—');

  sectionTitle(doc, 'Intervention');
  row(doc, 'Type', libelle(L_TYPE_MAINTENANCE, m.type));
  row(doc, 'Catégorie', libelle(L_CATEGORIE_EQUIPEMENT, m.categorie));
  row(doc, 'Équipement', m.equipement);
  row(doc, 'Statut', libelle(L_STATUT_MAINTENANCE, m.statut));
  row(doc, 'Technicien', m.technicien ? `${m.technicien.prenom} ${m.technicien.nom}` : '—');
  row(doc, 'Prestataire', m.prestataire?.nom ?? 'Interne');
  if (m.nomAgentSecurite) row(doc, 'Agent de sécurité', m.nomAgentSecurite);
  row(doc, 'Planifiée le', fmtDate(m.datePlanifiee));
  row(doc, 'Début', fmtDate(m.dateDebut));
  row(doc, 'Fin', fmtDate(m.dateFin));
  row(doc, 'Durée travaillée', m.dureeMinutes != null
    ? `${m.dureeMinutes} min${m.dureeSuspendueMinutes ? ` (hors ${m.dureeSuspendueMinutes} min de suspension)` : ''}`
    : '—');

  // Relevés énergie : mêmes informations que la fiche web (index SAISIS +
  // deltas depuis le relevé précédent quand ils existent).
  if (m.releves?.length) {
    sectionTitle(doc, 'Relevés énergie');
    const ge = m.releves.filter((r) => r.source === 'GE');
    const gasoil = ge.find((r) => r.gasoilConsommeLitres != null) ?? ge.find((r) => r.volumeGasoilLitres != null);
    if (gasoil) {
      row(doc, 'Gasoil', `${fmtN(gasoil.gasoilConsommeLitres, ' L consommés')} · cuve ${fmtN(gasoil.volumeGasoilLitres, ' L')}`);
    }
    for (const r of ge) {
      row(doc, `GE n°${r.groupeNumero ?? ''}`, `${fmtN(r.heuresFonctGE, ' h de marche')} · index ${fmtN(r.indexHeuresGE, ' h')}`);
    }
    for (const r of m.releves.filter((x) => x.source !== 'GE')) {
      if (r.source === 'CEET') row(doc, 'CEET', `${fmtN(r.consommationKwh, ' kWh')} · index ${fmtN(r.indexCompteur)}`);
      else if (r.source === 'SOLAIRE') row(doc, 'Solaire', fmtN(r.puissanceKva, ' kVA'));
      else row(doc, 'Autre source', '—');
    }
  }

  if (m.description) {
    sectionTitle(doc, 'Description');
    doc.fontSize(10).fillColor('#111').text(m.description, { align: 'justify' });
  }
  if (m.observations) {
    sectionTitle(doc, 'Observations');
    doc.fontSize(10).fillColor('#111').text(m.observations, { align: 'justify' });
  }
  if (m.analyseEnergie) {
    sectionTitle(doc, 'Analyse énergie');
    doc.fontSize(10).fillColor('#111').text(m.analyseEnergie, { align: 'justify' });
  }

  if (m.pieces?.length) {
    sectionTitle(doc, 'Pièces de rechange');
    m.pieces.forEach((p) =>
      row(doc, `${p.quantite}× ${p.nom}`, p.reference ? `Réf. ${p.reference}` : '')
    );
  }

  grillePhotos(doc, 'Photos avant travaux', m.photosAvant ?? [], m.totalPhotosAvant ?? (m.photosAvant?.length ?? 0));
  grillePhotos(doc, 'Photos après travaux', m.photosApres ?? [], m.totalPhotosApres ?? (m.photosApres?.length ?? 0));

  // Signatures : le technicien signe toujours (obligatoire à la clôture) ;
  // l'agent de sécurité n'apparaît que si un agent a été enregistré sur
  // l'intervention. Le bloc gère lui-même le saut de page et rend visible
  // une signature attendue mais manquante.
  signatureSlots(doc, [
    { label: 'Technicien', nom: m.technicien ? `${m.technicien.prenom} ${m.technicien.nom}` : null, image: m.signatureTechnicien ?? null },
    ...(m.nomAgentSecurite || m.signatureAgent
      ? [{ label: 'Agent de sécurité', nom: m.nomAgentSecurite ?? null, image: m.signatureAgent ?? null }]
      : []),
  ]);
  if (m.notePreuves) {
    doc.moveDown(0.5);
    doc.fontSize(8).fillColor('#666').text(m.notePreuves, 50, doc.y, { width: doc.page.width - 100 });
  }

  doc.moveDown(2);
  doc.fontSize(8).fillColor('#999').text(
    `Généré le ${fmtDate(new Date())} - E&M OpS`,
    50,
    doc.page.height - 60,
    { align: 'center', width: doc.page.width - 100 }
  );
}

export async function generateMaintenancePdf(m: MaintenancePdfData): Promise<Buffer> {
  return render((doc) => dessinerRapportMaintenance(doc, m));
}

/**
 * RECUEIL : un rapport complet par intervention, un par page, dans un seul
 * document. Précédé d'une page de garde qui dit ce que le document couvre —
 * sans elle, rien ne distingue un export « septembre, lot 3 » d'un autre.
 */
export interface RecueilSynthese {
  periode: string;
  perimetre: string;
  nb: number;
  preventives: number;
  curatives: number;
  /** Sites distincts couverts par le recueil. */
  sites: number;
  /** Heures travaillées cumulées (durées d'intervention). */
  heures: number;
  /** Qui a édité le document, et pour quel client. */
  editePar: string;
  client: string;
  /** Référence du document, reportée en pied de CHAQUE page. */
  reference: string;
  /** Incidents rattachés aux interventions du recueil. */
  incidents: Array<{ reference: string; site: string; statut: string; clos: boolean; date: string; action: string }>;
  /** Pièces remplacées, agrégées sur tout le recueil. */
  pieces: Array<{ nom: string; reference: string; quantite: number; sites: number }>;
}

/** Ligne de tableau simple : colonnes à largeurs fixes, saut de page géré. */
function ligneTableau(doc: PDFKit.PDFDocument, cellules: string[], largeurs: number[], gras = false) {
  if (doc.y > doc.page.height - 80) doc.addPage();
  const y = doc.y;
  let x = 50;
  doc.fontSize(8.5).fillColor(gras ? '#1B3F6B' : '#111');
  if (gras) doc.font('Helvetica-Bold'); else doc.font('Helvetica');
  cellules.forEach((c, i) => {
    doc.text(c, x, y, { width: largeurs[i] - 4, ellipsis: true, lineBreak: false });
    x += largeurs[i];
  });
  doc.font('Helvetica').fillColor('black');
  doc.y = y + 13;
}

/** Cartouche de chiffre clé de la page de garde. */
function cartouche(doc: PDFKit.PDFDocument, x: number, y: number, w: number, h: number,
                   valeur: string, libelle: string, couleur = BRAND) {
  doc.roundedRect(x, y, w, h, 6).fill('#F4F7FA');
  doc.fillColor(couleur).font('Helvetica-Bold').fontSize(20).text(valeur, x, y + 11, { width: w, align: 'center' });
  doc.fillColor(GRIS_PDF).font('Helvetica').fontSize(7.5).text(libelle, x, y + 37, { width: w, align: 'center' });
  doc.font('Helvetica').fillColor('black');
}

export async function generateMaintenancesRecueilPdf(
  liste: MaintenancePdfData[],
  garde: { titre: string; prestataire?: { nom: string; logo?: Buffer | null } } & RecueilSynthese,
): Promise<Buffer> {
  return render((doc) => {
    // ── En-tête CO-SIGNÉ (variante retenue) : E&M OpS d'un côté, le
    //    prestataire de l'autre. Le document sort de la maison — il est remis
    //    au prestataire, joint à une facturation, produit devant un auditeur —
    //    et doit donc porter les deux marques. Sans prestataire unique dans le
    //    périmètre, la place reste VIDE : afficher l'un des logos laisserait
    //    croire que le recueil ne couvre que celui-là.
    const w = doc.page.width;
    // EXÉCUTANT à gauche, DONNEUR D'ORDRE à droite : c'est la disposition de la
    // fiche de validation mensuelle, que les mêmes lecteurs signent déjà. En
    // changer sur ce document-ci les obligerait à réapprendre où regarder.
    const hautBloc = 30;
    if (garde.prestataire?.logo) {
      try {
        doc.image(garde.prestataire.logo, 60, hautBloc, { fit: [170, 58] });
      } catch {
        doc.font('Helvetica-Bold').fontSize(13).fillColor(BRAND).text(garde.prestataire.nom, 60, hautBloc + 18, { width: 200 });
      }
    } else if (garde.prestataire?.nom) {
      doc.font('Helvetica-Bold').fontSize(13).fillColor(BRAND).text(garde.prestataire.nom, 60, hautBloc + 18, { width: 200 });
    }
    doc.font('Helvetica').fontSize(7.5).fillColor(GRIS_PDF)
      .text(garde.prestataire ? 'Prestataire' : 'Plusieurs prestataires', 60, hautBloc + 64, { width: 200 });

    doc.font('Helvetica-Bold').fontSize(13).fillColor(BRAND)
      .text(garde.client, w - 260, hautBloc + 18, { width: 200, align: 'right' });
    doc.font('Helvetica').fontSize(7.5).fillColor(GRIS_PDF)
      .text('Client', w - 260, hautBloc + 64, { width: 200, align: 'right' });

    doc.rect(0, 112, w, 4).fill(BRAND);
    doc.rect(0, 116, w, 2).fill('#FFB020');

    let y = 150;
    doc.font('Helvetica-Bold').fontSize(19).fillColor('#111').text(garde.titre, 60, y, { width: w - 120, align: 'center' });
    y += 30;
    doc.font('Helvetica').fontSize(11).fillColor(GRIS_PDF).text(garde.periode, 60, y, { width: w - 120, align: 'center' });
    y += 18;
    doc.fontSize(10).fillColor(BRAND).text(garde.perimetre, 60, y, { width: w - 120, align: 'center' });
    y += 36;

    const ouverts = garde.incidents.filter((i) => !i.clos).length;
    const totalPieces = garde.pieces.reduce((t, p) => t + p.quantite, 0);
    const largeurCase = (w - 170) / 4;
    const pose = (i: number) => 60 + i * (largeurCase + 17);
    cartouche(doc, pose(0), y, largeurCase, 58, `${garde.nb}`, `interventions · ${garde.preventives} prév. / ${garde.curatives} cur.`);
    cartouche(doc, pose(1), y, largeurCase, 58, `${garde.sites}`, 'site(s) couvert(s)');
    cartouche(doc, pose(2), y, largeurCase, 58, `${ouverts}`, 'incident(s) encore ouvert(s)', ouverts ? '#C0392B' : ACCENT);
    cartouche(doc, pose(3), y, largeurCase, 58, `${totalPieces}`, 'pièce(s) remplacée(s)', ACCENT);
    y += 70;
    doc.font('Helvetica').fontSize(8).fillColor(GRIS_PDF).text(
      `${garde.heures} h travaillées cumulées · édité par ${garde.editePar} le ${fmtDate(new Date())}`,
      60, y, { width: w - 120, align: 'center' },
    );
    doc.fillColor('black');
    doc.y = y + 24;

    // ── Activité curative : ce que le lecteur cherche d'abord, et qu'aucune
    //    page individuelle ne donne — l'état des incidents à la date d'édition.
    sectionTitle(doc, `Activité curative — incidents (${garde.incidents.length})`);
    if (!garde.incidents.length) {
      doc.fontSize(9).fillColor('#666').text('Aucune intervention curative rattachée à un incident sur la période.', 50, doc.y);
      doc.fillColor('black'); doc.moveDown(0.6);
    } else {
      const clos = garde.incidents.filter((i) => i.clos).length;
      doc.fontSize(9).fillColor('#444').text(
        `${clos} incident(s) clôturé(s) · ${garde.incidents.length - clos} encore ouvert(s) à l'édition.`, 50, doc.y);
      doc.fillColor('black').moveDown(0.4);
      const L = [70, 120, 62, 72, 171];
      ligneTableau(doc, ['Référence', 'Site', 'État', 'Date', 'Action corrective'], L, true);
      garde.incidents.forEach((i) =>
        ligneTableau(doc, [i.reference, i.site, i.clos ? 'Clôturé' : 'OUVERT', i.date, i.action], L));
    }

    // ── Pièces de rechange : le cumul, qu'aucune page individuelle ne donne.
    sectionTitle(doc, `Pièces de rechange remplacées (${garde.pieces.reduce((t, p) => t + p.quantite, 0)})`);
    if (!garde.pieces.length) {
      doc.fontSize(9).fillColor('#666').text('Aucune pièce déclarée sur la période.', 50, doc.y);
      doc.fillColor('black'); doc.moveDown(0.6);
    } else {
      const L = [230, 110, 75, 80];
      ligneTableau(doc, ['Pièce', 'Référence', 'Quantité', 'Sites'], L, true);
      garde.pieces.forEach((p) =>
        ligneTableau(doc, [p.nom, p.reference || '—', String(p.quantite), String(p.sites)], L));
    }

    doc.moveDown(0.8);
    doc.fontSize(8.5).fillColor('#666').text(
      "Les pages suivantes reprennent chaque intervention dans le format exact du rapport unitaire : "
      + "relevés énergie, description, pièces, photos avant et après, signatures.",
      50, doc.y, { width: doc.page.width - 100, align: 'justify' },
    );
    doc.fillColor('black');

    // ── VISA. Un recueil « contractuel » qui ne se signe pas ne vaut pas mieux
    //    qu'un listing : deux cadres, exactement comme la fiche de validation
    //    mensuelle que ces mêmes lecteurs signent déjà.
    if (doc.y > doc.page.height - 160) doc.addPage();
    const yVisa = Math.max(doc.y + 10, doc.page.height - 150);
    const largeurVisa = (doc.page.width - 140) / 2;
    [[garde.prestataire?.nom ?? 'le prestataire', 60],
     [garde.client, 80 + largeurVisa]].forEach(([nom, x]) => {
      doc.roundedRect(x as number, yVisa, largeurVisa, 92, 5).lineWidth(0.7).stroke('#D8DEE6');
      doc.font('Helvetica-Bold').fontSize(9).fillColor(BRAND)
        .text(`Pour ${nom}`, (x as number) + 10, yVisa + 10, { width: largeurVisa - 20 });
      doc.font('Helvetica').fontSize(8).fillColor(GRIS_PDF)
        .text('Nom :', (x as number) + 10, yVisa + 30)
        .text('Date :', (x as number) + 10, yVisa + 46)
        .text('Signature et cachet :', (x as number) + 10, yVisa + 62);
      doc.fillColor('black');
    });

    liste.forEach((m) => {
      doc.addPage();
      dessinerRapportMaintenance(doc, m);
    });

    // ── RÉFÉRENCE ET PAGINATION sur CHAQUE page. Un dossier remis se feuillette,
    //    se photocopie, se scanne : sans numérotation, personne ne peut dire
    //    qu'il est complet, ni citer une page en réunion.
    const total = doc.bufferedPageRange().count;
    for (let i = 0; i < total; i++) {
      doc.switchToPage(i);
      doc.font('Helvetica').fontSize(7.5).fillColor('#9AA5B1');
      doc.text(`${garde.reference} · émis par E&M OpS`, 50, doc.page.height - 32, { width: 250 });
      doc.text(`page ${i + 1} / ${total}`, doc.page.width - 150, doc.page.height - 32, { width: 100, align: 'right' });
      doc.fillColor('black');
    }
  }, { bufferPages: true });
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
  manquants?: { totalLitres: number; nbSites: number; nbCamionsEcart?: number; topSites: Array<{ code: string; nom?: string; manquant: number }> };
}

const MOIS = [
  'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
  'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre',
];

export async function generateMonthlyReportPdf(r: MonthlyReportData): Promise<Buffer> {
  return render((doc) => {
    header(
      doc,
      `Rapport mensuel - ${MOIS[r.mois - 1]} ${r.annee}`,
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
      sectionTitle(doc, r.region ? `Manquants de livraison - ${r.region}` : 'Manquants de livraison');
      row(doc, 'Volume manquant total', `${r.manquants.totalLitres.toLocaleString('fr-FR')} L`);
      row(doc, 'Sites concernés', String(r.manquants.nbSites));
      // Compteur camions : national uniquement (un camion traverse plusieurs régions).
      if (r.manquants.nbCamionsEcart != null) row(doc, 'Camions avec écart', String(r.manquants.nbCamionsEcart));
      if (r.manquants.topSites.length) {
        row(doc, 'Principaux sites', r.manquants.topSites.map((s) => `${s.nom ?? s.code} (${s.manquant.toLocaleString('fr-FR')} L)`).join(', '));
      }
    }

    doc.fontSize(8).fillColor('#999').text(
      `Généré automatiquement le ${fmtDate(new Date())} - E&M OpS`,
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
  numeroClient: string | null;
  volumeChargeLitres: number;
  dateChargement?: Date | null;
  lignes: Array<{ siteCode: string; siteNom: string; region: string; volumePrevuLitres: number; pickup?: boolean }>;
}

export async function generatePlanLivraisonPdf(p: PlanLivraisonPdfData): Promise<Buffer> {
  return render((doc) => {
    header(doc, 'Plan de livraison carburant', `BL ${p.numeroBL} - ${p.moisLabel} ${p.annee}`);

    sectionTitle(doc, 'Chargement');
    row(doc, 'N° bon de livraison', p.numeroBL);
    row(doc, 'Bon de commande', p.bcNumero ?? '—');
    row(doc, 'Transporteur', p.transporteur ?? '—');
    if (p.numeroClient) row(doc, 'N° client', p.numeroClient);
    row(doc, 'Camion', p.immatriculation);
    row(doc, 'Volume chargé', `${Math.round(p.volumeChargeLitres)} L`);
    row(doc, 'Date chargement', fmtDate(p.dateChargement));

    sectionTitle(doc, `Sites à approvisionner (${p.lignes.length})`);

    // Le plan est aussi une FEUILLE D'ÉMARGEMENT : à chaque réception, le
    // technicien du site écrit son nom et signe sa ligne — la preuve papier
    // qui accompagne le camion et sur laquelle s'appuie tout rapprochement.
    // D'où les cases manuscrites (lignes hautes, réglées) et le tableau
    // resserré à gauche pour leur laisser la place.
    const X0 = 50;
    const X1 = doc.page.width - 50;
    const cols = {
      site: { x: X0, w: 126 },
      region: { x: 182, w: 52 },
      acces: { x: 238, w: 36 },
      vol: { x: 276, w: 44 },
      tech: { x: 330, w: 100 },
      sig: { x: 436, w: X1 - 436 },
    };

    // En-tête répété à chaque page : les cases à remplir rehaussent les
    // lignes, un plan de tournée pagine vite.
    const enTeteTableau = () => {
      const y = doc.y;
      doc.fontSize(8).fillColor('#666');
      doc.text('Site', cols.site.x, y, { width: cols.site.w });
      doc.text('Région', cols.region.x, y, { width: cols.region.w });
      doc.text('Accès', cols.acces.x, y, { width: cols.acces.w });
      doc.text('Prévu (L)', cols.vol.x, y, { width: cols.vol.w, align: 'right' });
      doc.text('Nom technicien', cols.tech.x, y, { width: cols.tech.w });
      doc.text('Signature', cols.sig.x, y, { width: cols.sig.w });
      doc.moveTo(X0, y + 12).lineTo(X1, y + 12).strokeColor('#bbbbbb').stroke();
      doc.y = y + 17;
    };
    enTeteTableau();

    let total = 0;
    p.lignes.forEach((l) => {
      total += l.volumePrevuLitres;
      const libelle = `${l.siteCode} - ${l.siteNom}`;
      doc.fontSize(9);
      // Hauteur pilotée par le libellé du site (seule cellule qui replie),
      // avec un plancher : la case de signature doit rester écrivable.
      const h = Math.max(doc.heightOfString(libelle, { width: cols.site.w }) + 8, 26);
      if (doc.y + h > doc.page.height - 70) { doc.addPage(); enTeteTableau(); }
      const y = doc.y;
      doc.fillColor('#111');
      doc.text(libelle, cols.site.x, y, { width: cols.site.w });
      doc.text(l.region, cols.region.x, y, { width: cols.region.w });
      // Accès difficile : le camion citerne ne monte pas jusqu'au site, la
      // livraison se termine en véhicule de transfert (pickup). Signalé au
      // chauffeur AVANT le départ, d'où sa présence sur le plan papier.
      if (l.pickup) doc.fillColor('#b45309').text('Pickup', cols.acces.x, y, { width: cols.acces.w });
      doc.fillColor('#111').text(String(Math.round(l.volumePrevuLitres)), cols.vol.x, y, { width: cols.vol.w, align: 'right' });
      // Réglure de la ligne + séparateurs des deux cases manuscrites.
      doc.strokeColor('#e0e0e0');
      doc.moveTo(X0, y + h - 5).lineTo(X1, y + h - 5).stroke();
      doc.moveTo(cols.tech.x - 6, y - 2).lineTo(cols.tech.x - 6, y + h - 5).stroke();
      doc.moveTo(cols.sig.x - 6, y - 2).lineTo(cols.sig.x - 6, y + h - 5).stroke();
      doc.y = y + h;
    });

    doc.moveDown(0.3);
    const ty = doc.y;
    doc.fontSize(10).fillColor(BRAND);
    doc.text('TOTAL', cols.region.x, ty);
    doc.text(`${Math.round(total)} L`, cols.vol.x - 30, ty, { width: cols.vol.w + 30, align: 'right' });

    const nbPickup = p.lignes.filter((l) => l.pickup).length;
    if (nbPickup > 0) {
      doc.moveDown(0.8);
      doc.fontSize(8).fillColor('#b45309').text(
        `Pickup : ${nbPickup} site(s) inaccessibles au camion citerne — prévoir un véhicule de transfert.`,
        X0, doc.y, { width: X1 - X0 }
      );
    }

    // ── Signatures des deux parties ────────────────────────────────────────
    // Le plan engage le donneur d'ordre ET le transporteur : deux cadres côte
    // à côte, jamais coupés par un saut de page (cadre entier reporté sinon).
    const hCadre = 92;
    if (doc.y + hCadre + 30 > doc.page.height - 60) doc.addPage();
    const ySig = doc.y + 18;
    const wCadre = 226;
    const cadres = [
      { titre: 'Pour Moov Africa', x: X0 },
      { titre: 'Pour le transporteur', x: X1 - wCadre },
    ];
    for (const c of cadres) {
      doc.roundedRect(c.x, ySig, wCadre, hCadre, 6).strokeColor('#cccccc').stroke();
      doc.fontSize(9).fillColor(BRAND).text(c.titre, c.x + 10, ySig + 8, { width: wCadre - 20 });
      doc.fontSize(8).fillColor('#666');
      doc.text('Nom :', c.x + 10, ySig + 26);
      doc.moveTo(c.x + 40, ySig + 34).lineTo(c.x + wCadre - 10, ySig + 34).strokeColor('#dddddd').stroke();
      doc.text('Date :', c.x + 10, ySig + 44);
      doc.moveTo(c.x + 40, ySig + 52).lineTo(c.x + 120, ySig + 52).strokeColor('#dddddd').stroke();
      doc.fontSize(7).fillColor('#999').text('Signature et cachet', c.x + 10, ySig + hCadre - 13);
    }
    doc.y = ySig + hCadre + 8;

    doc.fontSize(8).fillColor('#999').text(
      `Généré le ${fmtDate(new Date())} - E&M OpS`,
      50, doc.page.height - 60, { align: 'center', width: doc.page.width - 100 }
    );
  });
}

export interface DepotagePdfData {
  id: string;
  reference?: string | null;
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
    header(doc, 'Bordereau de dépotage', `Réf. ${d.reference ?? d.id.slice(0, 8).toUpperCase()} - ${fmtDate(d.dateDepotage)}`);

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

    // Validation tripartite : on montre TOUS les emplacements attendus
    // (chauffeur / agent / technicien), signés ou non — un emplacement non
    // signé reste visible au lieu d'être silencieusement retiré.
    if (d.signatures?.length) {
      signatureSlots(doc, d.signatures);
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
      `Généré le ${fmtDate(new Date())} - E&M OpS`,
      50, doc.page.height - 50, { align: 'center', width: doc.page.width - 100 }
    );
  });
}

export interface BonMouvementPdfData {
  id: string;
  nature: string;               // INSTALLATION | DESINSTALLATION | DEPLACEMENT
  dateMouvement?: Date | null;
  actif: {
    type: string;               // GE | BATTERIE | CLIMATISEUR
    designation: string;        // ex. « GE 100 kVA » / « Batterie 200 Ah »
    numeroSerie?: string | null;
    marque?: string | null;
    caracteristique?: string | null;
  };
  siteOrigine?: { nom: string; code: string } | null;   // désinstallation / déplacement (départ)
  siteDestination?: { nom: string; code: string } | null; // installation / déplacement (arrivée)
  technicien?: { nom: string; prenom: string } | null;
  prestataire?: { nom: string } | null;
  observations?: string | null;
  signatures?: Array<{ label: string; nom?: string | null; image: Buffer | null }>;
}

const NATURE_MOUVEMENT: Record<string, string> = {
  INSTALLATION: 'Installation', DESINSTALLATION: 'Désinstallation', DEPLACEMENT: 'Déplacement',
};

/**
 * Bon de mouvement d'actif : document de traçabilité (pose / dépose / déplacement)
 * d'un GE ou équipement, signable par le technicien et le réceptionnaire.
 */
export async function generateBonMouvementPdf(d: BonMouvementPdfData): Promise<Buffer> {
  return render((doc) => {
    header(doc, 'Bon de mouvement d’actif', `Réf. ${d.id.slice(0, 8).toUpperCase()} - ${fmtDate(d.dateMouvement)}`);

    sectionTitle(doc, 'Mouvement');
    row(doc, 'Nature', NATURE_MOUVEMENT[d.nature] ?? d.nature);
    row(doc, 'Date', fmtDate(d.dateMouvement));

    sectionTitle(doc, 'Actif');
    row(doc, 'Type', libelle(L_CATEGORIE_EQUIPEMENT, d.actif.type));
    row(doc, 'Désignation', d.actif.designation);
    row(doc, 'N° de série', d.actif.numeroSerie ?? '—');
    row(doc, 'Marque', d.actif.marque ?? '—');
    if (d.actif.caracteristique) row(doc, 'Caractéristique', d.actif.caracteristique);

    sectionTitle(doc, 'Localisation');
    const dep = d.siteOrigine ? d.siteOrigine.nom : 'Dépôt';
    const arr = d.siteDestination ? d.siteDestination.nom : 'Dépôt';
    if (d.nature === 'INSTALLATION') {
      row(doc, 'Provenance', 'Dépôt');
      row(doc, 'Site d’installation', arr);
    } else if (d.nature === 'DESINSTALLATION') {
      row(doc, 'Site d’origine', dep);
      row(doc, 'Destination', 'Dépôt');
    } else {
      row(doc, 'Site d’origine', dep);
      row(doc, 'Site de destination', arr);
    }

    sectionTitle(doc, 'Intervenants');
    row(doc, 'Technicien', d.technicien ? `${d.technicien.prenom} ${d.technicien.nom}` : '—');
    row(doc, 'Prestataire', d.prestataire?.nom ?? '—');

    if (d.observations) {
      sectionTitle(doc, 'Observations');
      doc.fontSize(10).fillColor('#111').text(d.observations, { align: 'justify' });
    }

    // Deux emplacements TOUJOURS présents (technicien / réceptionnaire), signés
    // ou non — l'emplacement non signé reste visible pour signature manuscrite
    // sur l'impression.
    const sigs = d.signatures ?? [];
    const trouver = (mot: string) => sigs.find((s) => s.label.toLowerCase().includes(mot))?.image ?? null;
    signatureSlots(doc, [
      { label: 'Technicien', nom: d.technicien ? `${d.technicien.prenom} ${d.technicien.nom}` : null, image: trouver('technicien') },
      { label: 'Réceptionnaire / responsable site', nom: null, image: trouver('récept') },
    ]);

    doc.fontSize(8).fillColor('#999').text(
      `Généré le ${fmtDate(new Date())} - E&M OpS`,
      50, doc.page.height - 50, { align: 'center', width: doc.page.width - 100 }
    );
  });
}

export interface EtiquettesQrData {
  site: { id: string; code: string; nom: string; region: string };
  ges: Array<{ id: string; numero: number; puissanceKva: number }>;
}

/** Génère un PNG QR (data-URL → Buffer) encodant un jeton EMOPS. */
async function qrBuffer(payload: string): Promise<Buffer> {
  const dataUrl = await QRCode.toDataURL(payload, { margin: 1, width: 300, errorCorrectionLevel: 'M' });
  return Buffer.from(dataUrl.split(',')[1], 'base64');
}

/**
 * Planche d'étiquettes QR (à imprimer et coller sur site) : un grand QR « site »
 * (armoire) + un QR par GE. Scannés dans l'app, ils identifient directement le
 * site / le GE sans recherche manuelle. Jetons : EMOPS:SITE:<id> / EMOPS:GE:<id>.
 */
export async function generateEtiquettesQrPdf(d: EtiquettesQrData): Promise<Buffer> {
  const siteQr = await qrBuffer(`EMOPS:SITE:${d.site.id}`);
  const geQrs = await Promise.all(d.ges.map((g) => qrBuffer(`EMOPS:GE:${g.id}`)));

  return render((doc) => {
    header(doc, 'Étiquettes QR', `${d.site.nom} (${d.site.code})`);

    // Étiquette SITE (grande, pour l'armoire).
    sectionTitle(doc, 'Site - à coller sur l’armoire');
    const y0 = doc.y;
    try { doc.image(siteQr, 50, y0, { width: 140 }); } catch { /* qr illisible */ }
    doc.fontSize(15).fillColor('#111').font('Helvetica-Bold').text(d.site.nom, 210, y0 + 20, { width: 300 });
    doc.font('Helvetica').fontSize(11).fillColor('#444').text(d.site.code, 210, y0 + 44);
    doc.fontSize(9).fillColor('#888').text(d.site.region, 210, y0 + 62);
    doc.fontSize(8).fillColor('#aaa').text('Scannez ce code dans E&M OpS pour ouvrir le site', 210, y0 + 84, { width: 300 });
    doc.y = y0 + 150;

    // Étiquettes GE (grille 3 colonnes).
    if (d.ges.length) {
      sectionTitle(doc, 'Groupes électrogènes');
      const colW = (doc.page.width - 100) / 3;
      let i = 0;
      for (const g of d.ges) {
        const col = i % 3;
        if (col === 0 && doc.y > doc.page.height - 160) doc.addPage();
        const x = 50 + col * colW;
        const y = doc.y;
        try { doc.image(geQrs[i], x + (colW - 90) / 2, y, { width: 90 }); } catch { /* illisible */ }
        doc.fontSize(9).fillColor('#111').font('Helvetica-Bold').text(`GE n°${g.numero}`, x, y + 94, { width: colW, align: 'center' });
        doc.font('Helvetica').fontSize(8).fillColor('#666').text(`${Math.round(Number(g.puissanceKva))} kVA`, x, y + 106, { width: colW, align: 'center' });
        if (col === 2) doc.y = y + 130;
        i++;
      }
      if (d.ges.length % 3 !== 0) doc.moveDown(11);
    }

    doc.fontSize(8).fillColor('#999').text(
      `Généré le ${fmtDate(new Date())} - E&M OpS`,
      50, doc.page.height - 50, { align: 'center', width: doc.page.width - 100 }
    );
  });
}

export const pdfService = { generateMaintenancePdf, generateMonthlyReportPdf, generatePlanLivraisonPdf, generateDepotagePdf, generateBonMouvementPdf, generateEtiquettesQrPdf };
