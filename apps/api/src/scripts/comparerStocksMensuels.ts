import { prisma } from '../config/database';
import { bilanMensuelSerie, chargerSeries } from '../services/stocksMensuels.service';

/**
 * COMPARAISON ancienne / nouvelle conso mensuelle, par site, pour la validation
 * de la méthode par l'exploitant. LECTURE SEULE : rien n'est écrit en base.
 *
 *   node dist/scripts/comparerStocksMensuels.js 2026-06 2026-10 > comparaison.csv
 *
 * Le CSV (séparateur « ; », ouvrable dans Excel) sort sur stdout, le résumé par
 * mois sur stderr. « Conso ancienne » est la conso au rythme de la fenêtre H1,
 * telle que publiée jusqu'ici.
 */
const MOIS_ARG = /^(\d{4})-(0[1-9]|1[0-2])$/;

function listeMois(de: string, a: string): Array<{ annee: number; mois: number }> {
  const d = MOIS_ARG.exec(de);
  const f = MOIS_ARG.exec(a);
  if (!d || !f) throw new Error('Usage : comparerStocksMensuels AAAA-MM AAAA-MM');
  const out: Array<{ annee: number; mois: number }> = [];
  const fin = Number(f[1]) * 12 + Number(f[2]);
  for (let n = Number(d[1]) * 12 + Number(d[2]); n <= fin; n++) {
    out.push({ annee: Math.floor((n - 1) / 12), mois: ((n - 1) % 12) + 1 });
  }
  if (!out.length) throw new Error('Le mois de fin précède le mois de début.');
  return out;
}

const cellule = (v: string | number | null) => {
  const t = v == null ? '' : String(v);
  return /[";\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
};

async function main() {
  const mois = listeMois(process.argv[2] ?? '', process.argv[3] ?? '');
  const sites = await prisma.site.findMany({
    where: { isActive: true },
    select: { id: true, nom: true, region: true },
    orderBy: { nom: 'asc' },
  });
  const series = await chargerSeries(sites.map((s) => s.id));

  const lignes = [[
    'Mois', 'Site', 'Région', 'Stock début (L)', 'Stock fin (L)', 'Livraisons (L)', 'Transferts/purges (L)',
    'Conso ancienne (L)', 'Conso nouvelle (L)', 'Écart (L)', 'Écart (%)', 'Provisoire', 'Observations',
  ].join(';')];

  for (const { annee, mois: m } of mois) {
    const etiquette = `${annee}-${String(m).padStart(2, '0')}`;
    let nbSites = 0, ancienne = 0, nouvelle = 0, comparees = 0, ecartAbsolu = 0, incalculables = 0;
    for (const s of sites) {
      const b = bilanMensuelSerie(series.get(s.id), annee, m);
      if (!b) continue;
      nbSites++;
      if (b.conso == null) incalculables++;
      const ecart = b.conso != null && b.consoFenetre != null ? b.conso - b.consoFenetre : null;
      if (ecart != null) {
        comparees++;
        ancienne += b.consoFenetre!;
        nouvelle += b.conso!;
        ecartAbsolu += Math.abs(ecart);
      }
      const pct = ecart != null && b.consoFenetre ? ((ecart / b.consoFenetre) * 100).toFixed(1).replace('.', ',') : null;
      lignes.push([
        etiquette, s.nom, s.region, b.stockDebut, b.stockFin, b.livraisons, b.mouvements,
        b.consoFenetre, b.conso, ecart, pct, b.provisoire ? 'oui' : 'non', b.drapeaux.join(' · '),
      ].map(cellule).join(';'));
    }
    console.error(
      `${etiquette} : ${nbSites} sites · ${comparees} comparés · conso ancienne ${ancienne} L · nouvelle ${nouvelle} L · `
      + `écart absolu moyen ${comparees ? Math.round(ecartAbsolu / comparees) : 0} L · ${incalculables} incalculable(s)`,
    );
  }
  // BOM : sans lui, Excel lit les accents de travers.
  process.stdout.write(`﻿${lignes.join('\n')}\n`);
}

main()
  .catch((e) => { console.error(e instanceof Error ? e.message : e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
