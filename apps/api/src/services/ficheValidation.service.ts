import ExcelJS from 'exceljs';
import { TASK_BY_KEY, SiteEligibilite, estDue } from '../utils/tachesPreventives';

/** Lignes de la fiche : libellés contractuels, clé catalogue et fréquence sur 6 mois. */
export const FICHE_ROWS: { numero: number; description: string; key: string; freq6: number }[] = [
  { numero: 1, key: 'entretien_pylone', freq6: 1, description: "Entretien pylône, serrage des systèmes boulons avec rapport sur l'état" },
  { numero: 2, key: 'controle_terre', freq6: 1, description: 'Contrôle valeur de terre et normalisation des réseaux de terre' },
  { numero: 3, key: 'desherbage', freq6: 6, description: 'Sarclage / désherbage du site avec photos horodatées et géolocalisées par site' },
  { numero: 4, key: 'extincteurs', freq6: 1, description: 'Contrôle et entretien extincteur' },
  { numero: 5, key: 'deratisation', freq6: 2, description: "Dératisation, chasse d'abeille et des reptiles sur les pylônes et dans les équipements au sol" },
  { numero: 6, key: 'tgbt_avr_onduleur', freq6: 6, description: 'Entretien TGBT, AVR, ONDULEUR' },
  { numero: 7, key: 'clim', freq6: 2, description: 'Maintenance climatiseur' },
  { numero: 8, key: 'serrures', freq6: 6, description: 'Réparation ou remplacement des serrures et cadenas' },
  { numero: 9, key: 'ge_production', freq6: 6, description: "Entretien et vidange mensuel d'un GE (12 à 22 kVA) non connecté à l'énergie publique (GE en production) avec photos horodatées et géolocalisées" },
  { numero: 10, key: 'ge_secours', freq6: 6, description: "Entretien et vidange mensuel d'un GE (12 à 22 kVA) connecté à l'énergie publique (GE en secours), accessoires fournis, avec photos horodatées et géolocalisées" },
  { numero: 11, key: 'curage_cuve', freq6: 1, description: 'Curage et nettoyage des cuves à gasoil, gestion des déchets de carburant' },
  { numero: 12, key: 'depotage', freq6: 6, description: 'Suivi des livraisons et relevé de niveau de carburant' },
];

/** Fiche du CONTRAT SOLAIRE : les 3 visites contractuelles (mêmes clés que le catalogue). */
export const FICHE_ROWS_SOLAIRE: { numero: number; description: string; key: string; freq6: number }[] = [
  { numero: 1, key: 'solaire_mensuel', freq6: 6, description: "Visite mensuelle solaire : énergie moyenne délivrée par jour, état de marche Auto/Manuel avec le GE, déport des alarmes et backup des configurations" },
  { numero: 2, key: 'solaire_nettoyage', freq6: 2, description: "Nettoyage et dépoussiérage des panneaux solaires à l'eau déminéralisée, avec photos horodatées et géolocalisées" },
  { numero: 3, key: 'solaire_semestriel', freq6: 1, description: "Grande visite semestrielle : panneaux (inspection, câblage, fixations, mises à la terre, mesures Isc/Voc par string), batteries (visuel, aérations, tension et température par élément, nettoyage), régulateur et coffret outdoor (fixation, parafoudres, ventilation, alarmes, nettoyage)" },
];

export interface LigneFiche {
  numero: number;
  description: string;
  /** Sites du périmètre éligibles à la tâche. */
  concernes: number;
  /** Sites distincts traités dans le mois. */
  realises: number;
  freq6: number;
}

/**
 * Lignes chiffrées de la fiche. UN SEUL calcul pour les deux sorties, Excel et
 * PDF : la fiche est un document signé, deux calculs parallèles finiraient par
 * se contredire sans que personne sache lequel fait foi.
 */
export function lignesFiche(d: {
  sites: SiteEligibilite[];
  realisesParKey: Record<string, number>;
  contrat?: 'PASSIF' | 'SOLAIRE';
  /** Mois de la fiche : les exclusions de périmètre s'apprécient à cette date. */
  annee?: number;
  mois?: number;
}): LigneFiche[] {
  // Dernier jour du mois : une exclusion qui prend effet EN COURS de mois
  // retire la tâche de ce mois-là. Le mois est l'unité du document.
  const le = d.annee && d.mois
    ? new Date(Date.UTC(d.annee, d.mois, 0))
    : new Date();
  return (d.contrat === 'SOLAIRE' ? FICHE_ROWS_SOLAIRE : FICHE_ROWS).map((row) => {
    const t = TASK_BY_KEY[row.key];
    return {
      numero: row.numero,
      description: row.description,
      // Périmètre CONTRACTUEL, pas seulement technique : un centre technique
      // dont le GE n'est pas au contrat ne compte pas parmi les concernés.
      concernes: t ? d.sites.filter((s) => estDue(t, s, le)).length : 0,
      realises: d.realisesParKey[row.key] ?? 0,
      freq6: row.freq6,
    };
  });
}

/**
 * « RÉALISÉS DANS LE MOIS », ramenés au périmètre de la fiche.
 *
 * Les deux colonnes de la fiche se lisent l'une par rapport à l'autre : des
 * réalisations comptées hors du périmètre des « concernés » donnaient des
 * lignes où le réalisé dépassait le dû - 13 sur 11 - que personne ne pouvait
 * expliquer au moment de signer. Deux cas le produisaient :
 *   - une intervention sur un site qui n'est plus dans le parc de la fiche
 *     (site désactivé depuis, ou rattaché à un lot d'un autre contrat) ;
 *   - une intervention sur un site dont la tâche a été SORTIE du contrat,
 *     l'exclusion étant appréciée à la fin du mois comme pour les concernés.
 *
 * Le travail fait reste dans l'historique du site et dans les rapports de
 * conformité : c'est la fiche - document contractuel, et seulement elle - qui
 * s'en tient à son périmètre.
 */
export function realisesDansPerimetre(
  interventions: Array<{ siteId: string; tachePreventiveKey: string | null }>,
  sites: Array<SiteEligibilite & { id: string }>,
  le: Date,
): Record<string, number> {
  const parId = new Map(sites.map((s) => [s.id, s]));
  const parKey = new Map<string, Set<string>>();
  for (const m of interventions) {
    const key = m.tachePreventiveKey;
    if (!key) continue;
    const site = parId.get(m.siteId);
    if (!site) continue;
    // Clé inconnue du catalogue : aucune règle de dû à opposer, on garde le
    // comptage - la ligne correspondante n'existe de toute façon pas.
    const t = TASK_BY_KEY[key];
    if (t && !estDue(t, site, le)) continue;
    const vus = parKey.get(key) ?? parKey.set(key, new Set()).get(key)!;
    vus.add(m.siteId);
  }
  return Object.fromEntries([...parKey].map(([k, v]) => [k, v.size]));
}

const MOIS_FR = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

export interface FichePrestataire {
  nom: string;
  adresse?: string | null;
  rccm?: string | null;
  nif?: string | null;
  contactCommercial?: string | null;
  contactTechnique?: string | null;
}

export interface FicheClient {
  nom: string;
  adresse: string[]; // lignes d'adresse
}

export interface FicheLogo {
  buffer: Buffer;
  extension: 'png' | 'jpeg' | 'gif';
}

export interface FicheValidationData {
  prestataire: FichePrestataire;
  client: FicheClient;
  zone: string;
  nbSites: number;
  annee: number;
  mois: number; // 1-12
  sites: SiteEligibilite[];
  // Exécutions du mois : nb de sites distincts réalisés par clé de tâche.
  realisesParKey: Record<string, number>;
  /** PASSIF (défaut) ou SOLAIRE : choisit les lignes contractuelles de la fiche. */
  contrat?: 'PASSIF' | 'SOLAIRE';
  /** Sites inaccessibles pendant le mois : leurs tâches non faites sont justifiées. */
  inaccessibles?: Array<{ site: string; periode: string; motif: string }>;
  prestataireLogo?: FicheLogo | null;
  clientLogo?: FicheLogo | null;
}

export async function buildFicheValidationXlsx(d: FicheValidationData): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'E&M OpS';
  const moisLabel = MOIS_FR[d.mois - 1] ?? '';
  const ws = wb.addWorksheet(`VAL ${moisLabel.slice(0, 3).toUpperCase()} ${d.annee}`);

  ws.columns = [
    { width: 4 }, { width: 6 }, { width: 18 }, { width: 18 }, { width: 18 }, { width: 16 }, { width: 14 }, { width: 16 }, { width: 16 },
  ];
  const lastDay = new Date(d.annee, d.mois, 0).getDate();
  const thin = { style: 'thin' as const };
  const border = { top: thin, left: thin, bottom: thin, right: thin };

  // ── Logos (lignes 1-5 : gauche = prestataire, droite = client) ──
  ws.getRow(1).height = 18; ws.getRow(2).height = 18; ws.getRow(3).height = 18; ws.getRow(4).height = 18; ws.getRow(5).height = 18;
  if (d.prestataireLogo) {
    const imgId = wb.addImage({ buffer: d.prestataireLogo.buffer as unknown as ExcelJS.Buffer, extension: d.prestataireLogo.extension });
    ws.addImage(imgId, { tl: { col: 1, row: 0 }, ext: { width: 150, height: 70 } });
  }
  if (d.clientLogo) {
    const imgId = wb.addImage({ buffer: d.clientLogo.buffer as unknown as ExcelJS.Buffer, extension: d.clientLogo.extension });
    ws.addImage(imgId, { tl: { col: 7, row: 0 }, ext: { width: 150, height: 70 } });
  }

  // ── En-tête prestataire (gauche) ──
  const p = d.prestataire;
  ws.getCell('B7').value = p.nom;
  ws.getCell('B7').font = { bold: true, size: 12 };
  if (p.adresse) ws.getCell('B8').value = p.adresse;
  if (p.rccm) ws.getCell('B9').value = `RCCM : ${p.rccm}`;
  if (p.nif) ws.getCell('B10').value = `NIF : ${p.nif}`;
  if (p.contactCommercial) ws.getCell('B11').value = `Contact Commercial : ${p.contactCommercial}`;
  if (p.contactTechnique) ws.getCell('B12').value = `Contact Technique : ${p.contactTechnique}`;

  // ── Bloc client (droite) ──
  ws.getCell('H7').value = `Lomé, le ${String(lastDay).padStart(2, '0')}/${String(d.mois).padStart(2, '0')}/${d.annee}`;
  ws.getCell('H9').value = `Client : ${d.client.nom}`;
  ws.getCell('H9').font = { bold: true };
  d.client.adresse.slice(0, 3).forEach((line, i) => { ws.getCell(`H${10 + i}`).value = line; });

  // ── Zone / sites / période ──
  ws.getCell('B16').value = `Zone : ${d.zone}`;
  ws.getCell('B16').font = { bold: true };
  ws.getCell('B17').value = `Nombre de sites : ${d.nbSites}`;
  ws.getCell('B18').value = `Période du 01 au ${lastDay}/${String(d.mois).padStart(2, '0')}/${d.annee}`;

  // ── Titre ──
  ws.mergeCells('B20:I20');
  const title = ws.getCell('B20');
  title.value = `TRAVAUX DE MAINTENANCE DES SITES ${d.client.nom.toUpperCase()} : MOIS DE ${moisLabel.toUpperCase()} ${d.annee}`;
  title.font = { bold: true, size: 12, color: { argb: 'FFFFFFFF' } };
  title.alignment = { horizontal: 'center', vertical: 'middle' };
  title.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1B3F6B' } };
  ws.getRow(20).height = 24;
  for (let c = 2; c <= 9; c++) ws.getRow(20).getCell(c).border = border;

  // ── Section ──
  ws.mergeCells('B22:I22');
  const sec = ws.getCell('B22');
  sec.value = d.contrat === 'SOLAIRE'
    ? 'OPERATION DE MAINTENANCE PREVENTIVE - CONTRAT SOLAIRE'
    : 'OPERATION DE MAINTENANCE PREVENTIVE';
  sec.font = { bold: true };
  sec.alignment = { horizontal: 'center' };
  sec.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD6E4F0' } };
  for (let c = 2; c <= 9; c++) ws.getRow(22).getCell(c).border = border;

  // ── En-tête tableau (ligne 23) ──
  const head = ws.getRow(23);
  ws.mergeCells('C23:F23');
  head.getCell(2).value = 'N°';
  head.getCell(3).value = 'Description';
  head.getCell(7).value = 'Nombre de sites concernés';
  head.getCell(8).value = 'Réalisés dans le mois';
  head.getCell(9).value = 'Fréquence / 6 mois';
  for (const c of [2, 3, 7, 8, 9]) {
    const cell = head.getCell(c);
    cell.font = { bold: true };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFEFEF' } };
    cell.border = border;
  }
  head.getCell(4).border = border; head.getCell(5).border = border; head.getCell(6).border = border;
  head.height = 30;

  // ── Lignes des tâches ──
  let r = 24;
  for (const row of lignesFiche(d)) {
    ws.mergeCells(`C${r}:F${r}`);
    const xl = ws.getRow(r);
    xl.getCell(2).value = row.numero;
    xl.getCell(3).value = row.description;
    xl.getCell(7).value = row.concernes;
    xl.getCell(8).value = row.realises;
    xl.getCell(9).value = row.freq6;
    xl.getCell(2).alignment = { horizontal: 'center' };
    xl.getCell(3).alignment = { wrapText: true, vertical: 'middle' };
    for (const c of [7, 8, 9]) xl.getCell(c).alignment = { horizontal: 'center', vertical: 'middle' };
    for (const c of [2, 3, 4, 5, 6, 7, 8, 9]) xl.getCell(c).border = border;
    xl.height = 28;
    r++;
  }

  // ── Sites inaccessibles du mois : les tâches restent dues (tableau
  //    inchangé), la non-réalisation y est JUSTIFIÉE - ni retard ni pénalité.
  if (d.inaccessibles?.length) {
    r += 2;
    ws.getCell(`B${r}`).value = `Sites inaccessibles pendant le mois (${d.inaccessibles.length}) : tâches dues non réalisées justifiées`;
    ws.getCell(`B${r}`).font = { bold: true, color: { argb: 'FFB26A00' } };
    for (const x of d.inaccessibles) {
      r++;
      ws.getCell(`B${r}`).value = x.site;
      ws.getCell(`C${r}`).value = `${x.periode} - ${x.motif}`;
      ws.getCell(`C${r}`).alignment = { wrapText: true, vertical: 'top' };
    }
  }

  // ── Signatures ──
  r += 2;
  ws.getCell(`B${r}`).value = `Pour ${p.nom}`;
  ws.getCell(`B${r}`).font = { bold: true };
  ws.getCell(`H${r}`).value = `Pour ${d.client.nom}`;
  ws.getCell(`H${r}`).font = { bold: true };
  ws.getCell(`B${r + 1}`).value = 'Nom :';
  ws.getCell(`H${r + 1}`).value = 'Nom :';

  const ab = await wb.xlsx.writeBuffer();
  return Buffer.from(ab);
}
