import { Prisma } from '@prisma/client';
import { prisma } from '../config/database';
import { AppError } from '../utils/AppError';
import { SaisieHorsApp } from '../utils/saisieHorsApp';
import { sourcesForConfig } from '../utils/energy';
import { consoKwh, heuresMarche, consoGasoil } from '../utils/derivesReleves';
import { GE_PARAMS } from '../utils/calculator';
import { clearMemo } from '../utils/memo';
import { configCuveDuSite, litresPourHauteur } from './cuve.service';
import { verifierClotureEnergie, enregistrerAnomalies, AvertissementSaisie } from './vraisemblance.service';
import { getNum } from './settings.service';

/**
 * ENREGISTREMENT D'UN RELEVÉ PRIS HORS APPLICATION (administrateur).
 *
 * Fiche papier, message d'un technicien, rattrapage d'une période d'avant le
 * déploiement : la mesure existe, l'application ne l'a pas vue. Ce service la
 * fait entrer SANS en faire une donnée de seconde zone - elle alimente les
 * mêmes rapports que celles du mobile, et pour cela doit se comporter comme
 * elles.
 *
 * Trois exigences que la saisie « au fil de l'eau » n'avait jamais :
 *
 *  1. LA DATE EST CELLE DE LA MESURE, pas celle d'aujourd'hui. Le contrôle de
 *     vraisemblance compare donc la valeur à ce qui la précède ET à ce qui la
 *     suit (sinon, comparée au dernier relevé connu, une saisie correcte
 *     déclencherait un faux « l'index recule »).
 *
 *  2. LE RELEVÉ S'INSÈRE DANS UNE CHAÎNE. Les consommations sont stockées sur
 *     les relevés, par différence avec le précédent, et les rapports les
 *     additionnent. Insérer un relevé entre deux autres sans recalculer le
 *     suivant ferait compter deux fois la période qu'ils couvrent. On écrit
 *     donc les valeurs dérivées du nouveau relevé ET on recalcule celles de
 *     son successeur - si celui-ci en portait.
 *
 *  3. LA PROVENANCE SE LIT. `origine = 'HORS_APP'` et `saisiParId` distinguent
 *     ce qui a été reconstitué de ce que l'application a capté, et qui l'a
 *     écrit - un chiffre saisi à la main doit pouvoir être retrouvé.
 */

const LIBELLE_SOURCE: Record<string, string> = {
  CEET: 'compteur CEET',
  GE: 'groupe électrogène',
  SOLAIRE: 'production solaire',
};

export type ResultatHorsApp =
  | { statut: 'ENREGISTRE'; releves: Array<{ id: string; source: string; groupeId: string | null }>; avertissements: AvertissementSaisie[] }
  | { statut: 'CONFIRMATION_REQUISE'; avertissements: AvertissementSaisie[] };

const num = (v: Prisma.Decimal | number | null | undefined): number | null => (v == null ? null : Number(v));

export async function enregistrerReleveHorsApp(
  saisie: SaisieHorsApp,
  auteurId: string,
  confirme: boolean,
): Promise<ResultatHorsApp> {
  // ── Le site et ce qu'il porte ──
  const site = await prisma.site.findUnique({
    where: { id: saisie.siteId },
    select: {
      id: true, nom: true, isActive: true, powerConfig: true, cuveVolumeLitres: true,
      groupes: { where: { isActive: true }, orderBy: { numero: 'asc' }, select: { id: true, numero: true } },
    },
  });
  if (!site) throw new AppError('Site introuvable.', 404);
  if (!site.isActive) throw new AppError('Ce site est désactivé : on n\'y enregistre pas de relevé.', 422);

  if (saisie.technicienId) {
    const t = await prisma.user.findUnique({ where: { id: saisie.technicienId }, select: { id: true } });
    if (!t) throw new AppError('Technicien introuvable.', 422);
  }

  // Une mesure sur une source que le site n'a pas est presque sûrement une
  // erreur de site ou de saisie : mieux vaut le dire que l'enregistrer.
  const permises = sourcesForConfig(site.powerConfig) as string[];
  const demandees = [saisie.ceet && 'CEET', saisie.ge && 'GE', saisie.solaire && 'SOLAIRE'].filter(Boolean) as string[];
  for (const s of demandees) {
    if (!permises.includes(s)) {
      throw new AppError(
        `Ce site n'a pas de ${LIBELLE_SOURCE[s]} (configuration d'énergie : ${site.powerConfig}). Corrigez la fiche du site si elle est fausse.`,
        422,
      );
    }
  }

  // ── Groupes électrogènes : chaque index se rattache à un GE du site ──
  const groupesSaisis = (saisie.ge?.groupes ?? []).map((g) => {
    if (site.groupes.length === 0) {
      if (g.groupeId) throw new AppError('Ce site n\'a pas de groupe électrogène déclaré : retirez le groupe.', 422);
      return { groupeId: null as string | null, indexHeuresGE: g.indexHeuresGE };
    }
    // Un seul GE sur le site : inutile de le faire désigner.
    const id = g.groupeId ?? (site.groupes.length === 1 ? site.groupes[0].id : null);
    if (!id) throw new AppError('Précisez le groupe électrogène de chaque index horaire.', 422);
    if (!site.groupes.some((x) => x.id === id)) throw new AppError('Groupe électrogène inconnu sur ce site.', 422);
    return { groupeId: id as string | null, indexHeuresGE: g.indexHeuresGE };
  });
  if (new Set(groupesSaisis.map((g) => g.groupeId ?? '_')).size !== groupesSaisis.length) {
    throw new AppError('Un même groupe électrogène est saisi deux fois.', 422);
  }

  // ── Niveau de la cuve : le serveur fait foi pour la conversion hauteur → litres ──
  let jaugeLitres = saisie.ge?.volumeGasoilLitres ?? null;
  const hauteurCuveCm = saisie.ge?.hauteurCuveCm ?? null;
  if (hauteurCuveCm != null) {
    const calcule = litresPourHauteur(await configCuveDuSite(site.id), hauteurCuveCm);
    if (calcule != null) jaugeLitres = calcule;
    else if (jaugeLitres == null) {
      throw new AppError('La cuve de ce site n\'a pas de barème exploitable : saisissez le volume en litres.', 422);
    }
  }

  // ── Contrôle de vraisemblance, À LA DATE de la mesure ──
  const e: Record<string, unknown> = {
    volumeGasoilLitres: jaugeLitres,
    indexCompteur: saisie.ceet?.indexCompteur ?? null,
    geHours: Object.fromEntries(groupesSaisis.filter((g) => g.groupeId).map((g) => [g.groupeId!, g.indexHeuresGE])),
    indexHeuresGE: groupesSaisis.find((g) => !g.groupeId)?.indexHeuresGE ?? null,
  };
  const sourcesControlees = demandees.filter((s) => s !== 'SOLAIRE');
  const avertissements = sourcesControlees.length
    ? await verifierClotureEnergie(
        { id: site.id, cuveVolumeLitres: site.cuveVolumeLitres, groupes: site.groupes },
        e, sourcesControlees, {}, saisie.dateReleve,
      )
    : [];
  // Un chiffre recopié à la main se trompe plus qu'un chiffre lu à l'écran : on
  // refuse d'écrire tant que l'administrateur n'a pas confirmé en connaissance
  // de cause - comme à la clôture d'une intervention.
  if (avertissements.length && !confirme) return { statut: 'CONFIRMATION_REQUISE', avertissements };

  const prixKwh = getNum('energie.prixKwhFCFA', 105);
  const t = saisie.dateReleve;

  // ── Écriture atomique : le relevé ET le recalcul de ses successeurs ──
  const crees = await prisma.$transaction(async (tx) => {
    // Une saisie à la fois par site : deux administrateurs (ou un administrateur
    // et une clôture) ne recalculent pas la même chaîne en même temps.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'rel:' + site.id})::bigint)`;

    const commun = {
      siteId: site.id, dateReleve: t,
      technicienId: saisie.technicienId,
      observations: saisie.observations,
      origine: 'HORS_APP', saisiParId: auteurId,
    } as const;

    const avant = (where: Prisma.ReleveEnergieWhereInput) =>
      tx.releveEnergie.findFirst({ where: { ...where, dateReleve: { lt: t } }, orderBy: { dateReleve: 'desc' } });
    const apres = (where: Prisma.ReleveEnergieWhereInput) =>
      tx.releveEnergie.findFirst({ where: { ...where, dateReleve: { gt: t } }, orderBy: { dateReleve: 'asc' } });
    const dejaLa = async (source: 'CEET' | 'GE' | 'SOLAIRE', groupeId: string | null, libelle: string) => {
      const x = await tx.releveEnergie.findFirst({ where: { siteId: site.id, source, dateReleve: t, groupeId }, select: { id: true } });
      if (x) throw new AppError(`Un relevé ${libelle} existe déjà pour ce site à cette date et cette heure.`, 409);
    };
    const livre = async (de: Date, a: Date) => {
      const r = await tx.depotage.aggregate({
        where: { siteId: site.id, dateDepotage: { gt: de, lte: a } },
        _sum: { volumeLitres: true },
      });
      return Number(r._sum.volumeLitres ?? 0);
    };

    const crees: Array<{ id: string; source: string; groupeId: string | null }> = [];
    const noter = (r: { id: string; source: string; groupeId: string | null }) =>
      crees.push({ id: r.id, source: r.source, groupeId: r.groupeId });

    // ── CEET : index cumulé ──
    if (saisie.ceet) {
      const index = saisie.ceet.indexCompteur;
      await dejaLa('CEET', null, 'CEET');
      const chaine = { siteId: site.id, source: 'CEET' as const, indexCompteur: { not: null } };
      const prec = await avant(chaine);
      const suiv = await apres(chaine);
      const kwh = consoKwh(num(prec?.indexCompteur), index);
      noter(await tx.releveEnergie.create({
        data: {
          ...commun, source: 'CEET', indexCompteur: index,
          consommationKwh: kwh, coutEstime: kwh != null ? Math.round(kwh * prixKwh) : null,
        },
      }));
      // Le successeur ne comptait QUE depuis le précédent : il compte maintenant depuis ce relevé.
      if (suiv && suiv.consommationKwh != null) {
        const kwh2 = consoKwh(index, num(suiv.indexCompteur));
        await tx.releveEnergie.update({
          where: { id: suiv.id },
          data: { consommationKwh: kwh2, coutEstime: kwh2 != null ? Math.round(kwh2 * prixKwh) : suiv.coutEstime },
        });
      }
    }

    // ── Groupe électrogène : index horaires par GE, jauge sur la première ligne ──
    if (saisie.ge) {
      // Une jauge seule se pose sur le premier GE du site, comme à la clôture
      // d'une intervention (la jauge voyage avec la première ligne).
      const lignes: Array<{ groupeId: string | null; index: number | null }> = groupesSaisis.length
        ? groupesSaisis.map((g) => ({ groupeId: g.groupeId, index: g.indexHeuresGE }))
        : [{ groupeId: site.groupes[0]?.id ?? null, index: null }];

      let porteJauge = jaugeLitres != null;
      for (const ligne of lignes) {
        await dejaLa('GE', ligne.groupeId, ligne.groupeId ? 'de ce groupe électrogène' : 'du groupe électrogène');
        const donnees: Prisma.ReleveEnergieUncheckedCreateInput = {
          ...commun, source: 'GE', groupeId: ligne.groupeId, indexHeuresGE: ligne.index,
        };

        // Heures de marche : chaîne PROPRE à ce groupe.
        if (ligne.index != null) {
          const chaineH = { siteId: site.id, source: 'GE' as const, indexHeuresGE: { not: null }, ...(ligne.groupeId ? { groupeId: ligne.groupeId } : {}) };
          const prec = await avant(chaineH);
          const suiv = await apres(chaineH);
          donnees.heuresFonctGE = heuresMarche(num(prec?.indexHeuresGE), ligne.index);
          if (suiv && suiv.heuresFonctGE != null) {
            await tx.releveEnergie.update({
              where: { id: suiv.id },
              data: { heuresFonctGE: heuresMarche(ligne.index, num(suiv.indexHeuresGE)) },
            });
          }
        }

        // Gasoil : chaîne des jauges du SITE, tous groupes confondus.
        if (porteJauge) {
          porteJauge = false;
          const chaineT = { siteId: site.id, source: 'GE' as const, volumeGasoilLitres: { not: null } };
          const prec = await avant(chaineT);
          const suiv = await apres(chaineT);
          const conso = prec ? consoGasoil(num(prec.volumeGasoilLitres), await livre(prec.dateReleve, t), jaugeLitres) : null;
          donnees.volumeGasoilLitres = jaugeLitres;
          donnees.hauteurCuveCm = hauteurCuveCm;
          donnees.gasoilConsommeLitres = conso;
          donnees.coutEstime = conso != null ? Math.round(conso * GE_PARAMS.prixLitreFCFA) : null;
          if (suiv && suiv.gasoilConsommeLitres != null) {
            const conso2 = consoGasoil(jaugeLitres, await livre(t, suiv.dateReleve), num(suiv.volumeGasoilLitres));
            await tx.releveEnergie.update({
              where: { id: suiv.id },
              data: {
                gasoilConsommeLitres: conso2,
                coutEstime: conso2 != null ? Math.round(conso2 * GE_PARAMS.prixLitreFCFA) : suiv.coutEstime,
              },
            });
          }
        }
        noter(await tx.releveEnergie.create({ data: donnees }));
      }
    }

    // ── Solaire ──
    if (saisie.solaire) {
      await dejaLa('SOLAIRE', null, 'solaire');
      noter(await tx.releveEnergie.create({
        data: { ...commun, source: 'SOLAIRE', puissanceKva: saisie.solaire.puissanceKva },
      }));
    }

    return crees;
  });

  // Les agrégats en cache (stock courant, bilans) ne connaissent pas ce relevé.
  clearMemo();

  if (avertissements.length) {
    await enregistrerAnomalies(avertissements, {
      source: 'RELEVE', siteId: site.id, releveId: crees[0]?.id ?? null, technicienId: auteurId, confirmee: true,
    });
  }
  return { statut: 'ENREGISTRE', releves: crees, avertissements };
}
