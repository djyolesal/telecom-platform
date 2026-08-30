import { Request, Response, NextFunction } from 'express';
import ExcelJS from 'exceljs';
import { Prisma } from '@prisma/client';
import { prisma } from '../config/database';
import { AppError } from '../utils/AppError';
import { reserverReferences, formatReference } from '../services/reference.service';
import { auditLog } from '../services/audit.service';
import { getNum } from '../services/settings.service';
import { GE_PARAMS } from '../utils/calculator';

const TARIF_CEET_FCFA = 105; // FCFA / kWh (indicatif)

// Normalise un en-tête : minuscules, sans accents ni séparateurs.
const norm = (s: string) =>
  s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');

// En-têtes attendus (export du système de tickets historique) → champ interne.
const HEADERS: Record<string, string> = {
  code: 'code',
  sitename: 'siteName',
  type: 'type',
  datedebut: 'dateDebut',
  datefin: 'dateFin',
  description: 'description',
  indexceet: 'indexCEET',
  heurege: 'heureGE',
  heurege2: 'heureGE2',
  qteavant: 'qteAvant',
  qtelivre: 'qteLivre',
  volumegasoil: 'volumeGasoil',
  volumegasoil2: 'volumeGasoil2',
  observation: 'observation',
};

type ReleveRow = Prisma.ReleveEnergieCreateManyInput;
type DepotRow = Prisma.DepotageCreateManyInput;

/**
 * Import de l'historique des relevés énergie (et dépotages) depuis l'export
 * Excel du système de tickets. Chaque ligne devient :
 *  - un relevé CEET (indexCEET),
 *  - un relevé GE par groupe (heureGE/heureGE2 + volume cuve),
 *  - un dépotage si le type est DEPOTAGE* avec une quantité livrée.
 * Les consommations (kWh, heures GE, gasoil) sont recalculées par différence
 * entre lignes consécutives, dépotages intercalés déduits — comme la clôture.
 *
 * Query : ?dryRun=true → rapport de validation sans écriture.
 *         ?purge=true  → REMPLACE l'existant (tous relevés + dépotages supprimés).
 * L'écriture (purge + insertions) est atomique.
 */
export async function importReleves(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.file) throw new AppError('Aucun fichier reçu : sélectionnez un fichier à importer.', 400);
    const dryRun = String(req.query.dryRun ?? '') === 'true';
    const purge = String(req.query.purge ?? '') === 'true';

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(req.file.buffer as unknown as ArrayBuffer, {
      // Les nœuds de présentation (styles, images, mises en forme) représentent
      // l'essentiel de la mémoire d'un .xlsx : 10 Mo de fichier donnaient
      // 300-600 Mo de heap pour un conteneur limité à 1 Go.
      ignoreNodes: ['dataValidations', 'drawing', 'hyperlinks', 'picture', 'styles', 'conditionalFormatting'],
    });
    const ws = wb.worksheets[0];
    if (!ws || ws.rowCount < 2) throw new AppError('Fichier vide ou sans données.', 400);

    const colByField: Record<string, number> = {};
    ws.getRow(1).eachCell((cell, col) => {
      const field = HEADERS[norm(String(cell.value ?? ''))];
      if (field) colByField[field] = col;
    });
    if (colByField.code == null || (colByField.dateFin == null && colByField.dateDebut == null)) {
      throw new AppError('Colonnes « Code » et « Date de début / Date de fin » introuvables dans le fichier.', 422);
    }

    // Sites (code → id + groupes triés par numéro) pour rattacher les lignes.
    const sites = await prisma.site.findMany({
      select: { id: true, code: true, groupes: { where: { isActive: true }, orderBy: { numero: 'asc' }, select: { id: true } } },
    });
    const siteByCode = new Map(sites.map((s) => [norm(s.code), s]));

    const text = (row: ExcelJS.Row, field: string): string => {
      const col = colByField[field];
      return col == null ? '' : String(row.getCell(col).text ?? '').trim();
    };
    const numOrNull = (row: ExcelJS.Row, field: string): number | null => {
      const v = text(row, field).replace(',', '.');
      return v === '' || Number.isNaN(Number(v)) ? null : Number(v);
    };
    const dateOrNull = (row: ExcelJS.Row, field: string): Date | null => {
      const col = colByField[field];
      if (col == null) return null;
      const v = row.getCell(col).value;
      if (v instanceof Date) return v;
      const d = new Date(String(row.getCell(col).text ?? '').trim());
      return Number.isNaN(d.getTime()) ? null : d;
    };

    const releves: ReleveRow[] = [];
    const depotages: DepotRow[] = [];
    const ignorees: { ligne: number; code: string; raison: string }[] = [];
    let lignes = 0;

    for (let r = 2; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const code = text(row, 'code');
      if (!code && !text(row, 'siteName')) continue; // ligne vide
      lignes++;

      const site = siteByCode.get(norm(code));
      if (!site) { ignorees.push({ ligne: r, code, raison: 'site inconnu' }); continue; }
      const date = dateOrNull(row, 'dateFin') ?? dateOrNull(row, 'dateDebut');
      if (!date) { ignorees.push({ ligne: r, code, raison: 'date invalide' }); continue; }

      const type = text(row, 'type').toUpperCase();
      const marque = `Import historique - ${type || 'TICKET'}`;
      // Saisies aberrantes du système historique (ex. index CEET à 665 M,
      // volume cuve à 54 M de litres) : au-delà de la capacité des colonnes
      // Decimal, la valeur est écartée (signalée) sans perdre le reste de la ligne.
      const borne = (field: string, max: number): number | null => {
        const v = numOrNull(row, field);
        if (v == null) return null;
        if (v < 0 || v >= max) {
          ignorees.push({ ligne: r, code, raison: `${field} aberrant (${v}) - valeur écartée` });
          return null;
        }
        return v;
      };
      const indexCEET = borne('indexCEET', 1e8);      // Decimal(10,2)
      const heureGE = borne('heureGE', 1e9);          // Decimal(10,1)
      const heureGE2 = borne('heureGE2', 1e9);
      const volumeGasoil = borne('volumeGasoil', 1e6);   // Decimal(8,2)
      const volumeGasoil2 = borne('volumeGasoil2', 1e6);
      const qteLivre = borne('qteLivre', 1e6);
      const qteAvant = borne('qteAvant', 1e6);
      let produit = false;

      if (indexCEET != null) {
        releves.push({ siteId: site.id, dateReleve: date, source: 'CEET', indexCompteur: indexCEET, observations: marque });
        produit = true;
      }
      if (heureGE != null || volumeGasoil != null) {
        releves.push({
          siteId: site.id, dateReleve: date, source: 'GE', groupeId: site.groupes[0]?.id ?? null,
          indexHeuresGE: heureGE, volumeGasoilLitres: volumeGasoil, observations: marque,
        });
        produit = true;
      }
      if (heureGE2 != null || volumeGasoil2 != null) {
        releves.push({
          siteId: site.id, dateReleve: date, source: 'GE', groupeId: site.groupes[1]?.id ?? null,
          indexHeuresGE: heureGE2, volumeGasoilLitres: volumeGasoil2, observations: marque,
        });
        produit = true;
      }
      if (type.startsWith('DEPOTAGE') && qteLivre != null && qteLivre > 0) {
        depotages.push({
          siteId: site.id, dateDepotage: date, volumeLitres: qteLivre,
          stockAvantLitres: qteAvant,
          stockApresLitres: qteAvant != null ? qteAvant + qteLivre : null,
          observations: [marque, text(row, 'observation')].filter(Boolean).join(' · '),
        });
        produit = true;
      }
      if (!produit) ignorees.push({ ligne: r, code, raison: 'aucune donnée exploitable' });
    }

    // ── Consommations par différence entre lignes consécutives ──
    const prixLitre = getNum('ge.prixLitreFCFA', GE_PARAMS.prixLitreFCFA);
    const byKey = new Map<string, ReleveRow[]>();
    for (const rel of releves) {
      const key = `${rel.siteId}|${rel.source}|${rel.groupeId ?? ''}`;
      (byKey.get(key) ?? byKey.set(key, []).get(key)!).push(rel);
    }
    const depotsBySite = new Map<string, DepotRow[]>();
    for (const d of depotages) {
      (depotsBySite.get(d.siteId) ?? depotsBySite.set(d.siteId, []).get(d.siteId)!).push(d);
    }
    for (const list of byKey.values()) {
      list.sort((a, b) => new Date(a.dateReleve as Date).getTime() - new Date(b.dateReleve as Date).getTime());
      for (let i = 1; i < list.length; i++) {
        const prev = list[i - 1];
        const cur = list[i];
        if (cur.source === 'CEET' && prev.indexCompteur != null && cur.indexCompteur != null) {
          const kwh = Number(cur.indexCompteur) - Number(prev.indexCompteur);
          if (kwh >= 0) { cur.consommationKwh = kwh; cur.coutEstime = Math.round(kwh * TARIF_CEET_FCFA); }
        }
        if (cur.source === 'GE') {
          if (prev.indexHeuresGE != null && cur.indexHeuresGE != null) {
            const h = Number(cur.indexHeuresGE) - Number(prev.indexHeuresGE);
            if (h >= 0) cur.heuresFonctGE = h; // négatif = compteur remplacé → inconnu
          }
          if (prev.volumeGasoilLitres != null && cur.volumeGasoilLitres != null) {
            const t0 = new Date(prev.dateReleve as Date).getTime();
            const t1 = new Date(cur.dateReleve as Date).getTime();
            const ajout = (depotsBySite.get(cur.siteId) ?? [])
              .filter((d) => { const t = new Date(d.dateDepotage as Date).getTime(); return t > t0 && t <= t1; })
              .reduce((s, d) => s + Number(d.volumeLitres), 0);
            const conso = Number(prev.volumeGasoilLitres) + ajout - Number(cur.volumeGasoilLitres);
            if (conso >= 0 && conso < 1e6) { cur.gasoilConsommeLitres = conso; cur.coutEstime = Math.round(conso * prixLitre); }
          }
        }
      }
    }

    const existants = {
      releves: await prisma.releveEnergie.count(),
      depotages: await prisma.depotage.count(),
    };
    const rapport = {
      lignes,
      relevesCEET: releves.filter((x) => x.source === 'CEET').length,
      relevesGE: releves.filter((x) => x.source === 'GE').length,
      depotages: depotages.length,
      ignorees: ignorees.length,
      exemplesIgnorees: ignorees.slice(0, 50),
      purge: purge ? existants : null,
      dryRun,
    };
    if (dryRun) return res.json({ success: true, data: rapport });
    if (!releves.length && !depotages.length) throw new AppError('Aucune ligne exploitable dans le fichier.', 422);

    // ── Écriture ATOMIQUE : purge éventuelle + insertions par lots ──
    const chunk = <T>(arr: T[], size: number): T[][] => {
      const out: T[][] = [];
      for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
      return out;
    };
    // Références lisibles DEP-<année>-<n> : un bloc de numéros est réservé par
    // année métier (compteur atomique), puis attribué dans l'ordre chronologique.
    const parAnnee = new Map<number, DepotRow[]>();
    for (const d of depotages) {
      const annee = new Date(d.dateDepotage as string | Date).getFullYear();
      const arr = parAnnee.get(annee) ?? [];
      arr.push(d);
      parAnnee.set(annee, arr);
    }
    // Tout dans UNE transaction interactive : la réservation des références DEP
    // est atomique avec l'insertion (plus de trous de numérotation sur échec),
    // et `skipDuplicates` rend le ré-import idempotent côté relevés (index
    // d'unicité (site, source, groupe, date)) au lieu de faire échouer tout le
    // lot. En mode `purge`, les tables sont vidées d'abord (remplacement propre).
    await prisma.$transaction(async (tx) => {
      if (purge) {
        await tx.photo.deleteMany({ where: { entityType: 'depotage' } });
        await tx.depotage.deleteMany({}); // heures GE liées : cascade
        await tx.releveEnergie.deleteMany({});
      }
      for (const [annee, rows] of parAnnee) {
        rows.sort((a, b) => new Date(a.dateDepotage as string | Date).getTime() - new Date(b.dateDepotage as string | Date).getTime());
        const premier = await reserverReferences('DEP', annee, rows.length, tx);
        rows.forEach((r, i) => { r.reference = formatReference('DEP', annee, premier + i); });
      }
      for (const c of chunk(depotages, 5000)) await tx.depotage.createMany({ data: c, skipDuplicates: true });
      for (const c of chunk(releves, 5000)) await tx.releveEnergie.createMany({ data: c, skipDuplicates: true });
    }, { timeout: 120_000 });

    await auditLog(req.user!.id, 'CREATE', 'releves_energie', 'bulk-import',
      { fichier: req.file.originalname, ...rapport, purge }, req);
    res.json({ success: true, data: rapport });
  } catch (err) { next(err); }
}
