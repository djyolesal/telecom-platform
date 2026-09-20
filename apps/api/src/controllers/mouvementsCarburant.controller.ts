import { Request, Response, NextFunction } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../config/database';
import { AppError } from '../utils/AppError';
import { auditLog } from '../services/audit.service';
import { paginate } from '../utils/paginator';
import { clearMemo } from '../utils/memo';
import { dateBornee } from '../utils/dates';
import { genererReference } from '../services/reference.service';
import { cleMinioValide, publicFileUrl } from '../services/storage.service';
import { assertSiteInPerimetre, sitePerimetre, isRestreint } from '../utils/perimetre';
import { verrouSiteCarburant } from '../services/verrou.service';
import { getNum } from '../services/settings.service';
import { notificationService } from '../services/notifications.service';
import { logger } from '../utils/logger';

const n = (v: unknown): number => (v == null ? 0 : Number(v));
const MOTIF_MIN = 10;

/**
 * JUSTIFICATIF OBLIGATOIRE (transfert et purge).
 *
 * Ces deux écritures RETIRENT du gasoil du stock attendu — c'est-à-dire de
 * l'écart qui déclenche les alertes de vol. Déclarées au bureau avec un motif
 * libre et sans pièce, elles étaient l'opération la moins prouvée de toute la
 * chaîne carburant, alors qu'un dépotage exige GPS, six photos et deux
 * signatures. Une pièce ne prouve pas que le gasoil a bougé, mais elle engage
 * celui qui la produit : la fraude devient documentée au lieu d'être invisible.
 *
 * L'AVOIR FOURNISSEUR en est exempté par défaut : il ne touche aucune cuve,
 * c'est une écriture comptable sur un bon de commande.
 *
 * Réglage `carburant.justificatifMouvementObligatoire` (1 par défaut) : une
 * purge urgente un samedi ne doit pas rester bloquée faute de scanner.
 */
function assertJustificatif(doc: string | null, quoi: string): void {
  if (getNum('carburant.justificatifMouvementObligatoire', 1) !== 1) return;
  if (!doc) {
    throw new AppError(
      `Pièce justificative requise pour ${quoi} (bon de transfert, PV de purge, photo ou PDF).`,
      422,
    );
  }
}

/**
 * Tout mouvement est signalé à l'administrateur. Ces écritures sont rares et
 * personne ne les regarde : sans alerte, une purge passe inaperçue jusqu'au
 * bilan mensuel — trop tard pour aller vérifier la cuve.
 * Jamais bloquant : un push en échec ne doit pas faire échouer l'écriture.
 */
async function notifierMouvement(titre: string, corps: string, data: Record<string, unknown>): Promise<void> {
  try {
    await notificationService.sendToRole('ADMIN', { title: titre, body: corps, type: 'mouvement_carburant', data });
  } catch (e) {
    logger.warn('[mouvement] notification administrateur échouée:', e);
  }
}

const L = (v: number) => `${Math.round(v).toLocaleString('fr-FR')} L`;

/**
 * MOUVEMENTS DE CARBURANT hors chaîne BC → BL → dépotage.
 *
 * Ils existent parce que le terrain les faisait déjà, sans pouvoir les écrire :
 * un transfert entre sites obligeait à inventer un faux dépotage — qui
 * déclenchait une fausse alerte de vol sur le site donneur, dont la cuve baisse
 * sans consommation ; une purge de cuve était comptée comme une
 * surconsommation ; un avoir fournisseur était impossible, les volumes négatifs
 * étant refusés partout.
 *
 * Tous exigent un MOTIF : ce sont des écritures qui font disparaître ou
 * apparaître du carburant sans pièce de livraison, donc les plus exposées à
 * l'usage abusif. Le motif est la seule chose qui les rende contestables.
 */

export async function getMouvements(req: Request, res: Response, next: NextFunction) {
  try {
    const where: Prisma.MouvementCarburantWhereInput = {};
    // PÉRIMÈTRE PAR DÉFAUT. Le filtre n'était appliqué que si `site_id` était
    // fourni : un superviseur rattaché à un prestataire listait donc TOUS les
    // mouvements du parc — sites, volumes et motifs compris — en omettant
    // simplement le paramètre.
    const perimetre = await sitePerimetre(req.user!.id);
    if (isRestreint(perimetre)) {
      where.OR = [
        { site: perimetre as Prisma.SiteWhereInput },
        { contrepartie: perimetre as Prisma.SiteWhereInput },
      ];
    }
    if (req.query.site_id) {
      const siteId = String(req.query.site_id);
      await assertSiteInPerimetre(req.user!.id, siteId);
      // Les deux jambes concernent le site : celle qui part comme celle qui arrive.
      where.AND = [{ OR: [{ siteId }, { contrepartieId: siteId }] }];
    }
    if (req.query.type) where.type = String(req.query.type) as Prisma.EnumTypeMouvementCarburantFilter['equals'];
    if (req.query.bon_commande_id) where.bonCommandeId = String(req.query.bon_commande_id);

    const { data, meta } = await paginate(
      prisma.mouvementCarburant,
      {
        where,
        orderBy: { dateMouvement: 'desc' },
        include: {
          site: { select: { id: true, code: true, nom: true } },
          contrepartie: { select: { id: true, code: true, nom: true } },
          bonCommande: { select: { id: true, numero: true } },
          auteur: { select: { id: true, nom: true } },
        },
      },
      { page: parseInt(String(req.query.page ?? '1')), limit: parseInt(String(req.query.limit ?? '50')) }
    );

    const avecUrl = (data as Array<{ documentPath: string | null }>).map((m) => ({
      ...m, documentUrl: m.documentPath ? publicFileUrl(m.documentPath) : null,
    }));
    res.json({ success: true, data: avecUrl, meta });
  } catch (err) { next(err); }
}

/**
 * TRANSFERT entre deux sites : écrit en DEUX jambes partageant `groupeId`, dans
 * une seule transaction. Neutre au bilan du parc, mais visible et motivé des
 * deux côtés — et surtout, il n'apparaît plus comme une disparition de gasoil
 * chez le donneur.
 */
export async function createTransfert(req: Request, res: Response, next: NextFunction) {
  try {
    const { siteSourceId, siteDestinationId, volumeLitres, dateMouvement, motif, documentPath } = req.body;
    if (!siteSourceId || !siteDestinationId) throw new AppError('Site source et site destination requis', 400);
    if (siteSourceId === siteDestinationId) throw new AppError('Un site ne peut pas se transférer du carburant à lui-même.', 400);
    const volume = n(volumeLitres);
    if (!(volume > 0)) throw new AppError('Volume transféré doit être > 0', 400);
    const raison = String(motif ?? '').trim();
    if (raison.length < MOTIF_MIN) throw new AppError(`Motif du transfert requis (${MOTIF_MIN} caractères minimum).`, 400);

    await assertSiteInPerimetre(req.user!.id, siteSourceId);
    await assertSiteInPerimetre(req.user!.id, siteDestinationId);

    const sites = await prisma.site.findMany({
      where: { id: { in: [siteSourceId, siteDestinationId] } },
      select: { id: true, code: true },
    });
    if (sites.length !== 2) throw new AppError('Site introuvable', 404);

    const date = dateBornee(dateMouvement);
    const doc = cleMinioValide(documentPath);
    assertJustificatif(doc, 'un transfert entre sites');

    const cree = await prisma.$transaction(async (tx) => {
      // Même verrou que les dépotages : la réconciliation du site lit ces
      // mouvements, deux écritures concurrentes ne doivent pas s'entrelacer.
      await verrouSiteCarburant(tx, siteSourceId);
      await verrouSiteCarburant(tx, siteDestinationId);

      const groupeId = (await tx.$queryRaw<{ id: string }[]>`SELECT gen_random_uuid()::text AS id`)[0].id;
      const commun = { groupeId, volumeLitres: volume, dateMouvement: date, motif: raison, documentPath: doc, auteurId: req.user!.id };

      const sortie = await tx.mouvementCarburant.create({
        data: {
          ...commun,
          type: 'TRANSFERT_SORTIE',
          siteId: siteSourceId,
          contrepartieId: siteDestinationId,
          reference: await genererReference(tx, 'MVT', date),
          latitude: req.body.latitude != null ? Number(req.body.latitude) : null,
          longitude: req.body.longitude != null ? Number(req.body.longitude) : null,
        },
      });
      const entree = await tx.mouvementCarburant.create({
        data: {
          ...commun,
          type: 'TRANSFERT_ENTREE',
          siteId: siteDestinationId,
          contrepartieId: siteSourceId,
          reference: await genererReference(tx, 'MVT', date),
        },
      });
      return { sortie, entree, groupeId };
    });

    await auditLog(req.user!.id, 'CREATE', 'mouvements_carburant', cree.groupeId, { transfert: { siteSourceId, siteDestinationId, volume, justificatif: !!doc } }, req);
    clearMemo();
    const codeSrc = sites.find((x) => x.id === siteSourceId)?.code ?? 'source';
    const codeDst = sites.find((x) => x.id === siteDestinationId)?.code ?? 'destination';
    void notifierMouvement(
      `⛽ Transfert de carburant — ${L(volume)}`,
      `${codeSrc} → ${codeDst} · ${raison}`,
      { groupeId: cree.groupeId, volumeLitres: volume },
    );
    res.status(201).json({ success: true, data: cree, message: 'Transfert enregistré' });
  } catch (err) { next(err); }
}

/**
 * PURGE / VIDANGE de cuve : du carburant sort sans être brûlé par le GE. Sans
 * cette écriture, la baisse partait en surconsommation, c'est-à-dire en signal
 * de vol sur le site.
 */
export async function createPurge(req: Request, res: Response, next: NextFunction) {
  try {
    const { siteId, volumeLitres, dateMouvement, motif, documentPath } = req.body;
    if (!siteId) throw new AppError('Site requis', 400);
    const volume = n(volumeLitres);
    if (!(volume > 0)) throw new AppError('Volume purgé doit être > 0', 400);
    const raison = String(motif ?? '').trim();
    if (raison.length < MOTIF_MIN) throw new AppError(`Motif de la purge requis (${MOTIF_MIN} caractères minimum).`, 400);
    await assertSiteInPerimetre(req.user!.id, siteId);

    const date = dateBornee(dateMouvement);
    const docPurge = cleMinioValide(documentPath);
    assertJustificatif(docPurge, 'une purge de cuve');
    const mvt = await prisma.$transaction(async (tx) => {
      await verrouSiteCarburant(tx, siteId);
      return tx.mouvementCarburant.create({
        data: {
          type: 'PURGE',
          siteId,
          volumeLitres: volume,
          dateMouvement: date,
          motif: raison,
          documentPath: docPurge,
          auteurId: req.user!.id,
          reference: await genererReference(tx, 'MVT', date),
          latitude: req.body.latitude != null ? Number(req.body.latitude) : null,
          longitude: req.body.longitude != null ? Number(req.body.longitude) : null,
        },
      });
    });

    await auditLog(req.user!.id, 'CREATE', 'mouvements_carburant', mvt.id, { purge: { siteId, volume, justificatif: !!docPurge } }, req);
    clearMemo();
    const siteP = await prisma.site.findUnique({ where: { id: siteId }, select: { code: true, nom: true } });
    void notifierMouvement(
      `⛽ Purge de cuve — ${L(volume)}`,
      `${siteP?.code ?? ''} ${siteP?.nom ?? ''} · ${raison}`.trim(),
      { mouvementId: mvt.id, volumeLitres: volume },
    );
    res.status(201).json({ success: true, data: mvt, message: 'Purge enregistrée' });
  } catch (err) { next(err); }
}

/**
 * AVOIR FOURNISSEUR : volume repris sur un bon de commande. Il ne touche aucune
 * cuve — il corrige ce que la commande a réellement coûté, et vient donc en
 * déduction du « chargé » dans le rapprochement trimestriel.
 */
export async function createAvoir(req: Request, res: Response, next: NextFunction) {
  try {
    const { bonCommandeId, volumeLitres, dateMouvement, motif, documentPath } = req.body;
    if (!bonCommandeId) throw new AppError('Bon de commande requis', 400);
    const volume = n(volumeLitres);
    if (!(volume > 0)) throw new AppError("Volume de l'avoir doit être > 0", 400);
    const raison = String(motif ?? '').trim();
    if (raison.length < MOTIF_MIN) throw new AppError(`Motif de l'avoir requis (${MOTIF_MIN} caractères minimum).`, 400);

    const bc = await prisma.bonCommande.findUnique({ where: { id: bonCommandeId }, select: { id: true, numero: true, statut: true } });
    if (!bc) throw new AppError('Bon de commande introuvable', 404);
    if (bc.statut === 'ANNULE') throw new AppError(`Le bon de commande ${bc.numero} est annulé.`, 409);

    const date = dateBornee(dateMouvement);
    const mvt = await prisma.mouvementCarburant.create({
      data: {
        type: 'AVOIR_FOURNISSEUR',
        bonCommandeId,
        volumeLitres: volume,
        dateMouvement: date,
        motif: raison,
        documentPath: cleMinioValide(documentPath),
        auteurId: req.user!.id,
        reference: await genererReference(prisma, 'MVT', date),
      },
    });

    await auditLog(req.user!.id, 'CREATE', 'mouvements_carburant', mvt.id, { avoir: { bonCommandeId, volume } }, req);
    clearMemo();
    void notifierMouvement(
      `⛽ Avoir fournisseur — ${L(volume)}`,
      `Bon de commande ${bc.numero} · ${raison}`,
      { mouvementId: mvt.id, bonCommandeId },
    );
    res.status(201).json({ success: true, data: mvt, message: 'Avoir enregistré' });
  } catch (err) { next(err); }
}

/**
 * Suppression : ADMIN seul, et un transfert part avec ses DEUX jambes — n'en
 * retirer qu'une laisserait du carburant créé ou détruit dans le bilan du parc.
 */
export async function deleteMouvement(req: Request, res: Response, next: NextFunction) {
  try {
    const mvt = await prisma.mouvementCarburant.findUnique({ where: { id: req.params.id } });
    if (!mvt) throw new AppError('Mouvement introuvable', 404);

    const supprimes = mvt.groupeId
      ? await prisma.mouvementCarburant.deleteMany({ where: { groupeId: mvt.groupeId } })
      : await prisma.mouvementCarburant.deleteMany({ where: { id: mvt.id } });

    await auditLog(req.user!.id, 'DELETE', 'mouvements_carburant', mvt.id, { jambes: supprimes.count }, req);
    clearMemo();
    res.json({ success: true, message: `Mouvement supprimé (${supprimes.count} écriture(s))` });
  } catch (err) { next(err); }
}
