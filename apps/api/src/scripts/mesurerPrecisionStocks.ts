import { prisma } from '../config/database';
import { bilanMensuelSerie, chargerSeries } from '../services/stocksMensuels.service';
import { Essai, essaisDuSite, Methode, METHODES, resumer } from '../services/precisionStocks.service';

/**
 * PRÉCISION des stocks mensuels sur les données réelles, et effet des jauges de
 * dépotage sur les mois publiés. LECTURE SEULE : rien n'est écrit en base.
 *
 *   node dist/scripts/mesurerPrecisionStocks.js 2026-06 2026-11 > precision.csv
 *
 * Le détail par jauge cachée (CSV « ; ») sort sur stdout, le résumé sur stderr.
 */
const MOIS_ARG = /^(\d{4})-(0[1-9]|1[0-2])$/;
const LIBELLE: Record<Methode, string> = {
  PROLONGER: 'Prolonger (mois provisoire)',
  PROLONGER_JAUGES: 'Prolonger + jauges dépotage',
  ENCADRER: 'Encadrer (mois définitif)',
  ENCADRER_JAUGES: 'Encadrer + jauges dépotage',
};
const TRANCHES: Array<[string, number, number]> = [
  ['3 j ou moins', 0, 3], ['3 à 7 j', 3, 7], ['7 à 15 j', 7, 15], ['15 à 30 j', 15, 30], ['plus de 30 j', 30, Infinity],
];

function tableau(titre: string, essais: Essai[]) {
  console.error(`\n${titre} (${essais.length} jauges cachées)`);
  if (!essais.length) return;
  console.error('  méthode                        erreur médiane | moyenne | 9 sur 10 sous | biais | à 50 L près');
  for (const m of METHODES) {
    const r = resumer(essais, m)!;
    console.error(`  ${LIBELLE[m].padEnd(30)} ${String(r.mediane).padStart(10)} L | ${String(r.moyenne).padStart(5)} L | ${String(r.p90).padStart(9)} L | ${String(r.biais).padStart(4)} L | ${r.sous50} %`);
  }
}

const cellule = (v: string | number) => {
  const t = typeof v === 'number' ? String(Math.round(v * 10) / 10).replace('.', ',') : v;
  return /[";\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
};

async function main() {
  const d = MOIS_ARG.exec(process.argv[2] ?? '');
  const f = MOIS_ARG.exec(process.argv[3] ?? '');
  if (!d || !f) throw new Error('Usage : mesurerPrecisionStocks AAAA-MM AAAA-MM');
  const depuis = new Date(Date.UTC(Number(d[1]), Number(d[2]) - 1, 1));
  const jusqua = new Date(Date.UTC(Number(f[1]), Number(f[2]), 1));
  if (jusqua <= depuis) throw new Error('Le mois de fin précède le mois de début.');

  const sites = await prisma.site.findMany({ where: { isActive: true }, select: { id: true, nom: true }, orderBy: { nom: 'asc' } });
  const series = await chargerSeries(sites.map((s) => s.id));

  const tous: Essai[] = [];
  const lignes = [['Site', 'Date', 'Jauge réelle (L)', ...METHODES.map((m) => LIBELLE[m]), 'Jours au relevé le plus proche', 'Jours avec jauges dépotage', 'Cohérent'].join(';')];
  for (const s of sites) {
    const serie = series.get(s.id);
    if (!serie) continue;
    for (const e of essaisDuSite(serie, depuis, jusqua)) {
      tous.push(e);
      lignes.push([s.nom, e.date.toISOString().slice(0, 10), e.vrai, ...METHODES.map((m) => e.estime[m]),
        e.distanceReleves, e.distanceJauges, e.coherent ? 'oui' : 'non'].map(cellule).join(';'));
    }
  }

  const coherents = tous.filter((e) => e.coherent);
  tableau('TOUTES LES JAUGES', tous);
  tableau('SANS LIVRAISON MANQUANTE APPARENTE', coherents);
  tableau('dont celles où une jauge de dépotage change l’estimation', coherents.filter((e) => Math.abs(e.estime.ENCADRER_JAUGES - e.estime.ENCADRER) > 0.5));
  for (const [nom, min, max] of TRANCHES) {
    tableau(`Relevé le plus proche à ${nom}`, coherents.filter((e) => e.distanceReleves > min && e.distanceReleves <= max));
  }

  console.error('\nEFFET DES JAUGES DE DÉPOTAGE SUR LES MOIS');
  for (let t = new Date(depuis); t < jusqua; t.setUTCMonth(t.getUTCMonth() + 1)) {
    const a = t.getUTCFullYear(), m = t.getUTCMonth() + 1;
    let n = 0, bouge = 0, consoSans = 0, consoAvec = 0, compares = 0, provSans = 0, provAvec = 0, nulSans = 0, nulAvec = 0;
    for (const s of sites) {
      const serie = series.get(s.id);
      if (!serie) continue;
      const avec = bilanMensuelSerie(serie, a, m);
      const sans = bilanMensuelSerie({ ...serie, jauges: [] }, a, m);
      if (!avec || !sans) continue;
      n++;
      if (Math.abs(avec.stockFin - sans.stockFin) > 1 || Math.abs(avec.stockDebut - sans.stockDebut) > 1) bouge++;
      if (avec.provisoire) provAvec++;
      if (sans.provisoire) provSans++;
      if (avec.conso == null) nulAvec++;
      if (sans.conso == null) nulSans++;
      if (avec.conso != null && sans.conso != null) { compares++; consoSans += sans.conso; consoAvec += avec.conso; }
    }
    console.error(`  ${a}-${String(m).padStart(2, '0')} : ${n} sites, ${bouge} modifiés | conso sans ${consoSans} L, avec ${consoAvec} L (${compares} comparés) | incalculables ${nulSans} -> ${nulAvec} | provisoires ${provSans} -> ${provAvec}`);
  }
  process.stdout.write(`﻿${lignes.join('\n')}\n`);
}

main()
  .catch((e) => { console.error(e instanceof Error ? e.message : e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
