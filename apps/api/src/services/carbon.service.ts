import { startOfMonth, subMonths, format } from 'date-fns';
import { prisma } from '../config/database';
import { carboneFactors } from './settings.service';
import { memo } from '../utils/memo';

/**
 * Empreinte carbone du parc, DÉRIVÉE des relevés d'énergie déjà collectés
 * (aucune saisie terrain supplémentaire) :
 *   • Scope 1 — GE : litres de gasoil consommés × facteur gasoil (kgCO₂/L)
 *   • Scope 2 — réseau CEET : kWh consommés × facteur réseau (kgCO₂/kWh)
 *   • Solaire : émissions nulles ; on chiffre les émissions ÉVITÉES = kWh solaire
 *     × facteur réseau (ce que le réseau aurait émis pour la même énergie).
 */

export interface CarboneFactors {
  gasoilKgCO2L: number;
  reseauKgCO2Kwh: number;
}

/** kgCO₂ d'un relevé GE à partir des litres de gasoil brûlés. */
export function co2GasoilKg(litres: number, f: CarboneFactors): number {
  return (litres > 0 ? litres : 0) * f.gasoilKgCO2L;
}
/** kgCO₂ d'un relevé réseau CEET à partir des kWh consommés. */
export function co2ReseauKg(kwh: number, f: CarboneFactors): number {
  return (kwh > 0 ? kwh : 0) * f.reseauKgCO2Kwh;
}

export interface ReleveCarbone {
  dateReleve: Date;
  source: string; // 'GE' | 'CEET' | 'SOLAIRE'
  gasoilConsommeLitres: number | null;
  consommationKwh: number | null;
  siteId: string | null;
  siteCode: string | null;
  siteNom: string | null;
  region: string | null;
}

export interface EmpreinteResult {
  periodeMois: number;
  facteurs: CarboneFactors;
  totaux: {
    co2GasoilKg: number;
    co2CeetKg: number;
    co2TotalKg: number;
    co2TotalTonnes: number;
    co2EviteKg: number;
    co2EviteTonnes: number;
    gasoilLitres: number;
    ceetKwh: number;
    solaireKwh: number;
    partGePct: number;
  };
  serieMensuelle: { mois: string; co2Gasoil: number; co2Ceet: number; co2Total: number }[];
  parRegion: { region: string; co2TotalKg: number; co2GasoilKg: number; co2CeetKg: number }[];
  topSites: { code: string; nom: string; region: string; co2TotalKg: number }[];
}

const r0 = (n: number) => Math.round(n);
const r1 = (n: number) => Math.round(n * 10) / 10;

/** Cœur de calcul PUR (sans BDD) — agrège des relevés en émissions CO₂. */
export function aggregateCarbone(
  releves: ReleveCarbone[],
  f: CarboneFactors,
  mois: number,
): EmpreinteResult {
  const moisKeys: string[] = [];
  for (let i = mois - 1; i >= 0; i--) moisKeys.push(format(subMonths(new Date(), i), 'MMM yy'));
  const serie = new Map(moisKeys.map((k) => [k, { mois: k, co2Gasoil: 0, co2Ceet: 0, co2Total: 0 }]));
  const parRegion = new Map<string, { region: string; co2TotalKg: number; co2GasoilKg: number; co2CeetKg: number }>();
  const parSite = new Map<string, { code: string; nom: string; region: string; co2TotalKg: number }>();

  let geKg = 0, ceetKg = 0, eviteKg = 0;
  let gasoilLitres = 0, ceetKwh = 0, solaireKwh = 0;

  for (const rv of releves) {
    const litres = rv.gasoilConsommeLitres ?? 0;
    const kwh = rv.consommationKwh ?? 0;
    let co2 = 0;
    if (rv.source === 'GE') {
      co2 = co2GasoilKg(litres, f);
      geKg += co2; gasoilLitres += litres;
    } else if (rv.source === 'CEET') {
      co2 = co2ReseauKg(kwh, f);
      ceetKg += co2; ceetKwh += kwh;
    } else if (rv.source === 'SOLAIRE') {
      solaireKwh += kwh;
      eviteKg += co2ReseauKg(kwh, f); // émissions évitées vs réseau
    }

    if (co2 > 0) {
      const key = format(rv.dateReleve, 'MMM yy');
      const b = serie.get(key);
      if (b) {
        if (rv.source === 'GE') b.co2Gasoil += co2; else if (rv.source === 'CEET') b.co2Ceet += co2;
        b.co2Total += co2;
      }
      const reg = rv.region ?? '—';
      const pr = parRegion.get(reg) ?? { region: reg, co2TotalKg: 0, co2GasoilKg: 0, co2CeetKg: 0 };
      pr.co2TotalKg += co2;
      if (rv.source === 'GE') pr.co2GasoilKg += co2; else if (rv.source === 'CEET') pr.co2CeetKg += co2;
      parRegion.set(reg, pr);

      if (rv.siteId) {
        const ps = parSite.get(rv.siteId) ?? { code: rv.siteCode ?? '', nom: rv.siteNom ?? '', region: rv.region ?? '—', co2TotalKg: 0 };
        ps.co2TotalKg += co2; parSite.set(rv.siteId, ps);
      }
    }
  }

  const co2TotalKg = geKg + ceetKg;
  return {
    periodeMois: mois,
    facteurs: f,
    totaux: {
      co2GasoilKg: r0(geKg),
      co2CeetKg: r0(ceetKg),
      co2TotalKg: r0(co2TotalKg),
      co2TotalTonnes: r1(co2TotalKg / 1000),
      co2EviteKg: r0(eviteKg),
      co2EviteTonnes: r1(eviteKg / 1000),
      gasoilLitres: r0(gasoilLitres),
      ceetKwh: r0(ceetKwh),
      solaireKwh: r0(solaireKwh),
      partGePct: co2TotalKg > 0 ? Math.round((geKg / co2TotalKg) * 100) : 0,
    },
    serieMensuelle: Array.from(serie.values()).map((s) => ({
      mois: s.mois, co2Gasoil: r0(s.co2Gasoil), co2Ceet: r0(s.co2Ceet), co2Total: r0(s.co2Total),
    })),
    parRegion: Array.from(parRegion.values())
      .map((p) => ({ region: p.region, co2TotalKg: r0(p.co2TotalKg), co2GasoilKg: r0(p.co2GasoilKg), co2CeetKg: r0(p.co2CeetKg) }))
      .sort((a, b) => b.co2TotalKg - a.co2TotalKg),
    topSites: Array.from(parSite.values())
      .map((s) => ({ ...s, co2TotalKg: r0(s.co2TotalKg) }))
      .sort((a, b) => b.co2TotalKg - a.co2TotalKg)
      .slice(0, 10),
  };
}

/** Empreinte carbone du parc sur une fenêtre de N mois (lecture BDD + agrégation). */
export async function computeEmpreinteCarbone({ mois = 6 }: { mois?: number } = {}): Promise<EmpreinteResult> {
  return memo(`carbone:${mois}`, 5 * 60_000, async () => {
    const depuis = startOfMonth(subMonths(new Date(), mois - 1));
    const releves = await prisma.releveEnergie.findMany({
      where: { dateReleve: { gte: depuis } },
      select: {
        dateReleve: true, source: true, gasoilConsommeLitres: true, consommationKwh: true,
        site: { select: { id: true, code: true, nom: true, region: true } },
      },
    });
    const mapped: ReleveCarbone[] = releves.map((r) => ({
      dateReleve: r.dateReleve,
      source: r.source,
      gasoilConsommeLitres: r.gasoilConsommeLitres != null ? Number(r.gasoilConsommeLitres) : null,
      consommationKwh: r.consommationKwh != null ? Number(r.consommationKwh) : null,
      siteId: r.site?.id ?? null,
      siteCode: r.site?.code ?? null,
      siteNom: r.site?.nom ?? null,
      region: r.site?.region ?? null,
    }));
    return aggregateCarbone(mapped, carboneFactors(), mois);
  });
}
