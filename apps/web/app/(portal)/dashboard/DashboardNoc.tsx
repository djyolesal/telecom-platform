'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { WifiOff, MapPin, Network, BarChart3, ClipboardList, ArrowRight } from 'lucide-react';
import { api } from '@/lib/api';
import { fmtDateTime } from '@/lib/utils';
import { useSupervisionSocket } from '@/lib/hooks/useSupervisionSocket';

/**
 * Tableau de bord du NOC : l'état des coupures, rien d'autre.
 * Le tableau de bord interne est centré logistique (stock carburant) - hors
 * périmètre NOC. Ici : situation en direct (mêmes stats que la page Coupures,
 * poll 60 s), la file des coupures actives les plus graves, et les accès
 * rapides de la vacation.
 */

interface Stats {
  enCours: number; enCoursSiteEntier: number; enCoursHeritees: number;
  nouvellesDerniereHeure: number; aQualifier: number; enCoursAuto: number;
  plusAncienne?: { dateDebut: string; site?: { nom: string } } | null;
}
interface CoupureRow {
  id: string; technologie: string; source?: string; priseEnChargePar?: string | null;
  dateDebut: string; site?: { nom: string; region: string }; _count?: { heritees: number };
  heritees?: { dateFin?: string | null; site?: { nom: string } }[];
}

/** Sites impactés DISTINCTS (un site peut porter plusieurs lignes héritées). */
const nbImpactes = (c: CoupureRow) =>
  new Set((c.heritees ?? []).map((h) => h.site?.nom).filter(Boolean)).size || (c._count?.heritees ?? 0);

const duree = (debut: string) => {
  const min = Math.max(0, Math.round((Date.now() - new Date(debut).getTime()) / 60000));
  if (min < 60) return `${min} min`;
  if (min < 2880) return `${Math.floor(min / 60)} h ${min % 60 ? `${min % 60} min` : ''}`.trim();
  return `${Math.floor(min / 1440)} j ${Math.floor((min % 1440) / 60)} h`;
};

function Tuile({ titre, valeur, detail, accent }: { titre: string; valeur: string | number; detail?: string; accent?: string }) {
  return (
    <div className="rounded-xl border border-gray-100 bg-white px-4 py-3">
      <p className="text-xs text-gray-500">{titre}</p>
      <p className={`mt-0.5 text-2xl font-bold ${accent ?? 'text-gray-800'}`}>{valeur}</p>
      {detail && <p className="text-xs text-gray-400">{detail}</p>}
    </div>
  );
}

interface Pouls {
  points: { heure: string; incidents: number; coupures: number }[];
  agitation: 'CALME' | 'ACTIF' | 'CRITIQUE';
}

const AGITATION_STYLE: Record<Pouls['agitation'], { trace: string; libelle: string; badge: string }> = {
  CALME:    { trace: '#F59E0B', libelle: 'Parc calme',        badge: 'bg-amber-50 text-amber-700' },
  ACTIF:    { trace: '#E67E22', libelle: 'Activité en cours', badge: 'bg-orange-50 text-orange-700' },
  CRITIQUE: { trace: '#C0392B', libelle: 'Situation critique', badge: 'bg-red-50 text-red-700' },
};

/** Tracé ECG des 24 seaux horaires : ligne de base plate, un battement par
 *  heure active, d'amplitude proportionnelle au nombre d'événements. */
function LigneDeVie24h({ pouls }: { pouls: Pouls }) {
  const W = 960, H = 56, BASE = 38, AMP = 26;
  const totaux = pouls.points.map((p) => p.incidents + p.coupures);
  const max = Math.max(1, ...totaux);
  const pas = W / totaux.length;
  let d = `M 0 ${BASE}`;
  totaux.forEach((t, i) => {
    const x = Math.round(i * pas + pas / 2);
    if (t > 0) {
      const h = (t / max) * AMP;
      d += ` L ${x - 7} ${BASE} L ${x - 2} ${BASE - h} L ${x + 3} ${BASE + Math.min(8, h * 0.4)} L ${x + 7} ${BASE}`;
    }
  });
  d += ` L ${W - 12} ${BASE}`;
  const style = AGITATION_STYLE[pouls.agitation];
  const totalInc = pouls.points.reduce((s, p) => s + p.incidents, 0);
  const totalCoup = pouls.points.reduce((s, p) => s + p.coupures, 0);
  return (
    <div className="mb-6 rounded-xl border border-gray-100 bg-white px-5 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-gray-700">Ligne de vie — 24 dernières heures</h3>
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-500">{totalCoup} coupure(s) · {totalInc} incident(s)</span>
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${style.badge}`}>{style.libelle}</span>
        </div>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="mt-1 block h-14 w-full" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d={d} stroke={style.trace} strokeWidth="2.4" strokeLinejoin="round" strokeLinecap="round" fill="none"
          style={{ filter: `drop-shadow(0 0 5px ${style.trace}66)` }} />
        <circle cx={W - 8} cy={BASE} r="4" fill="#0E7C6B" />
      </svg>
      <div className="flex justify-between text-[10px] font-medium text-gray-400">
        <span>il y a 24 h</span>
        <span>maintenant</span>
      </div>
    </div>
  );
}

const ACCES = [
  { href: '/supervision/coupures', icon: WifiOff, label: 'Coupures réseau' },
  { href: '/supervision/carte', icon: MapPin, label: 'Carte réseau' },
  { href: '/supervision/topologie', icon: Network, label: 'Topologie' },
  { href: '/rapports/disponibilite-reseau', icon: BarChart3, label: 'Disponibilité' },
];

export function DashboardNoc() {
  // Push temps réel (poll 5 min en filet).
  useSupervisionSocket();
  const { data: stats } = useQuery({
    queryKey: ['coupures-stats'],
    queryFn: () => api.get('/coupures-reseau/stats').then((r) => r.data.data as Stats),
    refetchInterval: 300_000,
  });
  // File des coupures actives : racines seulement, tri serveur composite
  // (sites entiers d'abord, puis les plus anciennes).
  const { data: coupures } = useQuery({
    queryKey: ['noc-coupures-encours'],
    queryFn: () => api.get('/coupures-reseau', { params: { statut: 'EN_COURS', origine: 'LOCALE', limit: 8 } })
      .then((r) => r.data.data as CoupureRow[]),
    refetchInterval: 300_000,
  });
  const racines = stats ? Math.max(0, stats.enCours - stats.enCoursHeritees) : null;

  // Ligne de vie : le pouls RÉEL des 24 dernières heures (incidents + coupures
  // par heure) — le tracé ECG décoratif devient un instrument.
  const { data: pouls } = useQuery({
    queryKey: ['pouls-24h'],
    queryFn: () => api.get('/rapports/pouls-24h').then((r) => r.data.data as Pouls),
    refetchInterval: 60_000,
  });

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-gray-800">Supervision réseau</h1>
        <p className="mt-0.5 text-sm text-gray-500">Situation en direct - mise à jour en temps réel</p>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-5">
        <Tuile titre="Coupures en cours" valeur={racines ?? '…'}
          detail={stats && stats.enCoursSiteEntier > 0 ? `dont ${stats.enCoursSiteEntier} site(s) entier(s)` : 'racines (aval hérité non compté)'}
          accent={stats && stats.enCoursSiteEntier > 0 ? 'text-red-600' : undefined} />
        <Tuile titre="AUTO à traiter" valeur={stats?.enCoursAuto ?? '…'} detail="détections automatiques non prises en charge"
          accent={stats && stats.enCoursAuto > 0 ? 'text-indigo-600' : undefined} />
        <Tuile titre="À qualifier" valeur={stats?.aQualifier ?? '…'} detail="alarme ou classement manquant"
          accent={stats && stats.aQualifier > 0 ? 'text-[#1B3F6B]' : undefined} />
        <Tuile titre="Nouvelles (1 h)" valeur={stats?.nouvellesDerniereHeure ?? '…'} detail="débutées dans l'heure"
          accent={stats && stats.nouvellesDerniereHeure > 0 ? 'text-amber-600' : undefined} />
        <div className="rounded-xl border border-gray-100 bg-white px-4 py-3">
          <p className="text-xs text-gray-500">Plus ancienne en cours</p>
          {stats?.plusAncienne ? (
            <>
              <p className="mt-0.5 truncate text-sm font-bold text-gray-800" title={stats.plusAncienne.site?.nom}>{stats.plusAncienne.site?.nom ?? '—'}</p>
              <p className="text-xs font-bold text-red-600">{duree(stats.plusAncienne.dateDebut)}</p>
            </>
          ) : <p className="mt-0.5 text-sm font-bold text-emerald-600">aucune</p>}
        </div>
      </div>

      {pouls && <LigneDeVie24h pouls={pouls} />}

      <div className="mb-6 rounded-xl border border-gray-100 bg-white">
        <div className="flex items-center justify-between border-b border-gray-50 px-5 py-3">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-700">
            <ClipboardList size={15} className="text-[#1B3F6B]" /> Coupures actives - les plus graves d&apos;abord
          </h3>
          <Link href="/supervision/coupures" className="flex items-center gap-1 text-xs font-medium text-[#2471A3] hover:underline">
            Tout voir <ArrowRight size={13} />
          </Link>
        </div>
        {!coupures ? (
          <p className="px-5 py-6 text-center text-sm text-gray-400">Chargement…</p>
        ) : coupures.length === 0 ? (
          <p className="px-5 py-6 text-center text-sm font-medium text-emerald-600">Aucune coupure en cours - réseau en service.</p>
        ) : (
          <ul className="divide-y divide-gray-50">
            {coupures.map((c) => (
              <li key={c.id}>
                <Link href={`/supervision/coupures?search=${encodeURIComponent(c.site?.nom ?? '')}`}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-2.5 text-sm hover:bg-gray-50">
                  <span className="font-medium text-gray-800">{c.site?.nom ?? '—'}</span>
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${c.technologie === 'SITE' ? 'bg-red-50 text-red-700' : 'bg-[#EAF1F8] text-[#1B3F6B]'}`}>
                    {c.technologie === 'SITE' ? 'Site entier' : c.technologie}
                  </span>
                  {c.source === 'OSS' && (
                    <span className={`rounded px-1 py-px text-[10px] font-bold ${c.priseEnChargePar ? 'bg-emerald-50 text-emerald-700' : 'bg-indigo-50 text-indigo-600'}`}>
                      {c.priseEnChargePar ? '✓ AUTO' : 'AUTO'}
                    </span>
                  )}
                  {(c._count?.heritees ?? 0) > 0 && (
                    <span className="rounded-full bg-purple-50 px-1.5 py-0.5 text-[10px] font-bold text-purple-700">{nbImpactes(c)} impacté(s)</span>
                  )}
                  <span className="text-xs text-gray-400">{c.site?.region}</span>
                  <span className="ml-auto text-xs text-gray-500">{fmtDateTime(c.dateDebut)}</span>
                  <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-bold text-amber-700">{duree(c.dateDebut)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {ACCES.map((a) => {
          const Icon = a.icon;
          return (
            <Link key={a.href} href={a.href}
              className="group flex items-center gap-3 rounded-xl border border-gray-100 bg-white px-4 py-3 transition-all hover:border-[#2471A3]/30 hover:shadow-md">
              <div className="rounded-lg bg-[#1B3F6B] p-2 transition-colors group-hover:bg-[#2471A3]">
                <Icon size={16} className="text-white" />
              </div>
              <span className="text-sm font-semibold text-gray-700">{a.label}</span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
