/**
 * RÉPARATION des avals détachés à tort par le balayage de reclassement.
 *
 * Avant le délai de grâce (`oss.delaiReclassementAvalMin`), un aval encore
 * coupé au moment où son amont se rétablissait était promu « racine » et
 * DÉTACHÉ, alors qu'il n'avait qu'un retard de réenregistrement de quelques
 * minutes. Sa coupure porte alors un « [RECLASSÉE] … cause locale à qualifier »
 * qui est faux, et l'indisponibilité n'est plus imputée à l'entraînement.
 *
 * Ce script rattache CE SEUL CAS, et refuse tout ce qui n'est pas certain :
 *  - l'amont candidat doit être un amont RÉEL du site dans la topologie de
 *    transmission (jamais un rapprochement par nom : deux sites peuvent être
 *    homonymes) ;
 *  - sa clôture doit tomber à la minute indiquée dans la trace ;
 *  - l'aval doit s'être rétabli PEU APRÈS son amont (fenêtre ci-dessous) :
 *    au-delà, sa panne était probablement bien locale — on n'y touche pas ;
 *  - un seul candidat possible, sinon on signale sans rien écrire.
 *
 * Lecture seule par défaut. Pour écrire : --appliquer
 *   DATABASE_URL=... npx ts-node --transpile-only scripts/reparer-avals-reclasses.ts [--appliquer] [--fenetre=30]
 */
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

// Prisma 7 : connexion par driver adapter (comme src/config/database.ts).
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});
const APPLIQUER = process.argv.includes('--appliquer');
const FENETRE_MIN = Number(
  (process.argv.find((a) => a.startsWith('--fenetre=')) ?? '--fenetre=30').split('=')[1],
);

const MARQUEUR = '[RECLASSÉE]';
// « … est rétabli le 22/09 08:04 ; … » — heure de Lomé (UTC+0, comme le serveur).
const RE_HEURE = /est rétabli le (\d{2})\/(\d{2}) (\d{2}):(\d{2})/;

async function amontsDe(siteId: string, parent: Map<string, string | null>): Promise<string[]> {
  const amonts: string[] = [];
  let curseur = parent.get(siteId) ?? null;
  for (let saut = 0; curseur && saut < 30; saut++) {
    if (amonts.includes(curseur)) break;
    amonts.push(curseur);
    curseur = parent.get(curseur) ?? null;
  }
  return amonts;
}

(async () => {
  const sites = await prisma.site.findMany({ select: { id: true, parentTransmissionId: true } });
  const parent = new Map(sites.map((s) => [s.id, s.parentTransmissionId]));

  const suspectes = await prisma.coupureReseau.findMany({
    where: { origine: 'LOCALE', coupureOrigineId: null, observations: { contains: MARQUEUR } },
    select: { id: true, siteId: true, dateDebut: true, dateFin: true, observations: true,
              site: { select: { nom: true } } },
    orderBy: { dateDebut: 'asc' },
  });

  let repares = 0, ignores = 0;
  for (const c of suspectes) {
    const m = RE_HEURE.exec(c.observations ?? '');
    if (!m) { ignores++; continue; }
    const [, jj, mm, hh, mi] = m;
    // L'année n'est pas dans la trace : on la déduit du début de la coupure.
    const annee = c.dateDebut.getUTCFullYear();
    const minute = new Date(Date.UTC(annee, Number(mm) - 1, Number(jj), Number(hh), Number(mi)));
    const amonts = await amontsDe(c.siteId, parent);
    if (!amonts.length) {
      console.log(`· ${c.site.nom} (${c.id}) : aucun amont dans la topologie — laissé tel quel`);
      ignores++; continue;
    }

    const candidats = await prisma.coupureReseau.findMany({
      where: {
        siteId: { in: amonts },
        dateFin: { gte: minute, lt: new Date(minute.getTime() + 60_000) },
      },
      select: { id: true, dateFin: true, site: { select: { nom: true } } },
    });
    if (candidats.length !== 1) {
      console.log(`· ${c.site.nom} (${c.id}) : ${candidats.length} amont(s) possible(s) — laissé tel quel`);
      ignores++; continue;
    }
    const racine = candidats[0];
    // L'aval s'est-il rétabli dans la foulée de son amont ? Sinon, sa panne
    // était bien la sienne : le reclassement était justifié.
    const ecartMin = c.dateFin
      ? Math.round((c.dateFin.getTime() - racine.dateFin!.getTime()) / 60_000)
      : null;
    if (ecartMin === null || ecartMin < 0 || ecartMin > FENETRE_MIN) {
      console.log(`· ${c.site.nom} (${c.id}) : rétabli ${ecartMin === null ? 'jamais' : `${ecartMin} min`} après l'amont — laissé tel quel`);
      ignores++; continue;
    }
    console.log(`✓ ${c.site.nom} (${c.id}) ← ${racine.site.nom} — rétabli ${ecartMin} min après son amont`);
    if (APPLIQUER) {
      await prisma.coupureReseau.update({
        where: { id: c.id },
        data: {
          origine: 'HERITEE',
          coupureOrigineId: racine.id,
          // La trace « [RECLASSÉE] » est retirée : elle affirmait une cause
          // locale qui n'a jamais existé. Ce qui l'entoure est conservé.
          observations: [
            (c.observations ?? '').replace(/\n?\[RECLASSÉE\][^\n]*/g, '').trim(),
            `[CORRIGÉ] Rattaché à l'amont ${racine.site.nom} : ce site s'est rétabli ${ecartMin} min après lui, `
              + `le reclassement en cause locale était une erreur du balayage (délai de grâce absent).`,
          ].filter(Boolean).join('\n'),
        },
      });
    }
    repares++;
  }

  console.log(`\n${APPLIQUER ? 'RATTACHÉS' : 'À rattacher (essai à blanc)'} : ${repares} · laissés tels quels : ${ignores}`);
  if (!APPLIQUER && repares) console.log('Relancer avec --appliquer pour écrire.');
  await prisma.$disconnect();
})();
