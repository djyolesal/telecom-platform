import ExcelJS from 'exceljs';
import { TASK_BY_KEY, SiteEligibilite } from '../utils/tachesPreventives';

/** Lignes de la fiche (libellés contractuels + clé catalogue + fréquence sur 6 mois). */
const FICHE_ROWS: { numero: number; description: string; key: string; freq6: number }[] = [
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
  prestataireLogo?: FicheLogo | null;
  clientLogo?: FicheLogo | null;
}

export async function buildFicheValidationXlsx(d: FicheValidationData): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'TélécomOps';
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
  sec.value = 'OPERATION DE MAINTENANCE PREVENTIVE';
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
  for (const row of FICHE_ROWS) {
    const t = TASK_BY_KEY[row.key];
    const concernes = t ? d.sites.filter((s) => t.eligible(s)).length : 0;
    const realises = d.realisesParKey[row.key] ?? 0;
    ws.mergeCells(`C${r}:F${r}`);
    const xl = ws.getRow(r);
    xl.getCell(2).value = row.numero;
    xl.getCell(3).value = row.description;
    xl.getCell(7).value = concernes;
    xl.getCell(8).value = realises;
    xl.getCell(9).value = row.freq6;
    xl.getCell(2).alignment = { horizontal: 'center' };
    xl.getCell(3).alignment = { wrapText: true, vertical: 'middle' };
    for (const c of [7, 8, 9]) xl.getCell(c).alignment = { horizontal: 'center', vertical: 'middle' };
    for (const c of [2, 3, 4, 5, 6, 7, 8, 9]) xl.getCell(c).border = border;
    xl.height = 28;
    r++;
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
