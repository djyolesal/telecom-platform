'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { WifiOff, Activity, Zap, RadioTower } from 'lucide-react';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/shared/PageHeader';
import { ExportButtons } from '@/components/shared/ExportButtons';
import { FilterBar } from '@/components/shared/FilterBar';
import { StatCard } from '@/components/shared/StatCard';
import { Loading, ErrorState, EmptyState } from '@/components/shared/states';
import { fmtNumber } from '@/lib/utils';

interface SiteRow { nom: string; region: string; coupures: number; enCours: number; downtimeHeures: number; dispoPct: number }

const TECHNOS = ['SITE', '2G', '3G', '4G', '5G'];
const ALARMES = ['AE', 'GE', 'EN', 'FO', 'TX', 'RA', 'MI', 'MD', 'NA'];
const basculer = (set: React.Dispatch<React.SetStateAction<Set<string>>>, v: string) =>
  set((prev) => { const n = new Set(prev); if (n.has(v)) n.delete(v); else n.add(v); return n; });
const puce = (actif: boolean) =>
  `rounded-full border px-2.5 py-0.5 text-xs font-medium ${actif ? 'border-[#1B3F6B] bg-[#1B3F6B] text-white' : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'}`;
interface AlarmeRow { type: string; coupures: number; downtimeHeures: number }
interface PrestaRow {
  nom: string; nbSites: number; coupures: number; enCours: number; sitesTouches: number;
  downtimeHeures: number; downtimeActifHeures: number; downtimePassifHeures: number; downtimeNonClasseHeures: number;
  dispoPct: number;
}

export default function DisponibiliteReseauPage() {
  const router = useRouter();
  const [mois, setMois] = useState('3');
  const [du, setDu] = useState('');
  const [au, setAu] = useState('');
  // « Période » (option d'en-tête) et « Période libre » activent le mode du/au.
  const libre = mois === '' || mois === 'libre';
  const pret = !libre || (!!du && !!au);
  const [technos, setTechnos] = useState<Set<string>>(new Set());
  const [alarmes, setAlarmes] = useState<Set<string>>(new Set());

  // Mêmes filtres pour la page ET les exports (fidélité affichage/export).
  const filtres: Record<string, string> = {
    ...(libre ? { date_debut: du, date_fin: au } : { mois }),
    ...(technos.size ? { technologies: [...technos].join(',') } : {}),
    ...(alarmes.size ? { alarmes: [...alarmes].join(',') } : {}),
  };
  const exportQuery = Object.entries(filtres)
    .map(([cle, v]) => `${cle}=${encodeURIComponent(v)}`).join('&');

  const { data, isLoading, isError } = useQuery({
    queryKey: ['disponibilite-reseau', filtres],
    queryFn: () => api.get('/rapports/disponibilite-reseau', { params: filtres }).then((r) => r.data.data),
    enabled: pret,
  });

  const k = data?.kpis;

  return (
    <div>
      <PageHeader
        title="Disponibilité réseau"
        subtitle={data?.perimetreRestreint
          ? 'Votre périmètre : downtime, sites touchés et répartition actif/passif de vos lots'
          : "Coupures radio (supervision NOC) : downtime, sites touchés, répartition actif/passif et évaluation par prestataire"}
        backHref="/rapports"
        actions={pret
          ? <ExportButtons base="/rapports/disponibilite-reseau/export"
              name={libre ? `disponibilite-reseau_du-${du}_au-${au}` : `disponibilite-reseau_${mois}-mois`}
              query={exportQuery || undefined} />
          : undefined}
      />

      <FilterBar
        filters={[{
          key: 'mois', label: 'Période', value: libre ? 'libre' : mois, options: [
            { value: '1', label: '1 mois' }, { value: '3', label: '3 mois' },
            { value: '6', label: '6 mois' }, { value: '12', label: '12 mois' },
            { value: 'libre', label: 'Période libre (du → au)' },
          ], onChange: setMois,
        }]}
      />

      {libre && (
        <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
          <span className="text-gray-500">Du :</span>
          <input type="date" value={du} onChange={(e) => setDu(e.target.value)}
            className="rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-sm text-gray-700 outline-none focus:border-[#2471A3]" />
          <span className="text-gray-400">→</span>
          <input type="date" value={au} onChange={(e) => setAu(e.target.value)}
            className="rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-sm text-gray-700 outline-none focus:border-[#2471A3]" />
        </div>
      )}

      {/* Filtres multi-choix - vide = tout. Une coupure « Site entier » coupe
          toutes les technos : elle est incluse dès qu'une techno est cochée. */}
      <div className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-gray-500">Technologies :</span>
          {TECHNOS.map((t) => (
            <button key={t} type="button" onClick={() => basculer(setTechnos, t)} className={puce(technos.has(t))}>
              {t === 'SITE' ? 'Site entier' : t}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-gray-500">Alarmes :</span>
          {ALARMES.map((a) => (
            <button key={a} type="button" onClick={() => basculer(setAlarmes, a)} className={puce(alarmes.has(a))}>
              {a === 'NA' ? 'N/A' : a}
            </button>
          ))}
          {alarmes.size > 0 && (
            <span className="text-xs text-amber-600" title="Les coupures sans type d'alarme renseigné - dont les détections AUTO OSS - sont exclues par ce filtre.">
              (sans type exclues)
            </span>
          )}
        </div>
        <span className="text-xs text-gray-400" title="Le sas des détections brutes reste visible sur la liste des coupures et la carte NOC, sans peser sur la disponibilité publiée.">
          Les détections AUTO (OSS) ne comptent qu&apos;une fois prises en charge par le NOC.
        </span>
      </div>

      {!pret ? <EmptyState title="Période libre" hint="Choisissez les deux dates pour calculer le rapport." />
        : isLoading ? <Loading />
        : isError || !data || !k ? <ErrorState message="Disponibilité réseau indisponible" />
        : <>

      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-5">
        <StatCard title="Coupures" value={fmtNumber(k.coupures)} subtitle={`${k.sitesTouches}/${k.nbSites} sites touchés`} icon={WifiOff} color="bg-[#1B3F6B]" />
        <StatCard title="En cours" value={fmtNumber(k.enCours)} subtitle="non rétablies" icon={Activity} color="bg-[#C0392B]" />
        <StatCard title="Downtime cumulé" value={`${fmtNumber(k.downtimeHeures)} h`} subtitle={data.periodeLibelle ?? `sur ${data.periodeMois} mois`} icon={RadioTower} color="bg-[#E67E22]" />
        <StatCard title="Part énergie" value={`${k.partEnergiePct}%`} subtitle="alarmes AE / GE / EN" icon={Zap} color="bg-[#0E7C6B]" />
        <StatCard
          title="Part passif"
          value={`${k.partPassifPct ?? 0}%`}
          subtitle={`actif ${fmtNumber(k.downtimeActifHeures ?? 0)} h · passif ${fmtNumber(k.downtimePassifHeures ?? 0)} h · n.c. ${fmtNumber(k.downtimeNonClasseHeures ?? 0)} h`}
          icon={Zap}
          color="bg-[#7D3C98]"
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="rounded-xl border border-gray-100 bg-white p-5">
          <h3 className="mb-3 text-sm font-semibold text-gray-700">Top sites par downtime</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-gray-100 text-left text-xs text-gray-500">
                <th className="py-2 pr-4 font-medium">Site</th>
                <th className="px-3 py-2 font-medium">Région</th>
                <th className="px-3 py-2 text-right font-medium">Coupures</th>
                <th className="px-3 py-2 text-right font-medium">Downtime</th>
                <th className="px-3 py-2 text-right font-medium">Dispo</th>
              </tr></thead>
              <tbody>
                {data.topSites.map((s: SiteRow) => (
                  <tr key={s.nom} className="cursor-pointer border-b border-gray-50 last:border-0 hover:bg-gray-50"
                    onClick={() => router.push(`/supervision/coupures?search=${encodeURIComponent(s.nom)}`)}>
                    <td className="py-2 pr-4 font-medium text-gray-800">
                      {s.nom}{s.enCours > 0 && <span className="ml-1.5 rounded-full bg-red-50 px-1.5 py-0.5 text-[10px] font-bold text-red-700">{s.enCours} en cours</span>}
                    </td>
                    <td className="px-3 py-2 text-gray-600">{s.region}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{s.coupures}</td>
                    <td className="px-3 py-2 text-right tabular-nums font-semibold">{fmtNumber(s.downtimeHeures)} h</td>
                    <td className={`px-3 py-2 text-right tabular-nums font-semibold ${s.dispoPct < 95 ? 'text-red-600' : s.dispoPct < 99 ? 'text-amber-600' : 'text-emerald-600'}`}>{s.dispoPct}%</td>
                  </tr>
                ))}
                {data.topSites.length === 0 && <tr><td colSpan={5} className="py-6 text-center text-gray-400">Aucune coupure sur la période</td></tr>}
              </tbody>
            </table>
          </div>
        </div>

        <div className="rounded-xl border border-gray-100 bg-white p-5">
          <h3 className="mb-4 text-sm font-semibold text-gray-700">Downtime par type d'alarme (heures)</h3>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={data.parTypeAlarme} layout="vertical" margin={{ left: 10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis type="number" tick={{ fontSize: 11 }} />
              <YAxis type="category" dataKey="type" width={46} tick={{ fontSize: 12 }} />
              <Tooltip formatter={(v: number, name) => name === 'downtimeHeures' ? [`${fmtNumber(v)} h`, 'Downtime'] : [v, name]} />
              <Bar dataKey="downtimeHeures" name="Downtime (h)" fill="#1B3F6B" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
          <p className="mt-2 text-xs text-gray-400">AE / GE / EN = causes énergie · FO = fibre · TX = transmission · RA = radio (référentiel NOC).</p>
        </div>
      </div>

      {/* Vue interne : évaluation de chaque prestataire sur le périmètre de ses lots.
          Le downtime PASSIF (énergie/environnement) est sa responsabilité O&M directe. */}
      {(data.parPrestataire?.length ?? 0) > 0 && (
        <div className="mt-6 rounded-xl border border-gray-100 bg-white p-5">
          <h3 className="mb-1 text-sm font-semibold text-gray-700">Évaluation par prestataire</h3>
          <p className="mb-3 text-xs text-gray-400">
            Downtime des sites de leurs lots sur la période - le <b>passif</b> (énergie/environnement) relève de leur responsabilité O&M,
            l'<b>actif</b> (radio/transmission) des équipes réseau.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-gray-100 text-left text-xs text-gray-500">
                <th className="py-2 pr-4 font-medium">Prestataire</th>
                <th className="px-3 py-2 text-right font-medium">Sites</th>
                <th className="px-3 py-2 text-right font-medium">Coupures</th>
                <th className="px-3 py-2 text-right font-medium">Sites touchés</th>
                <th className="px-3 py-2 text-right font-medium">Downtime</th>
                <th className="px-3 py-2 text-right font-medium">Passif</th>
                <th className="px-3 py-2 text-right font-medium">Actif</th>
                <th className="px-3 py-2 text-right font-medium">Non classé</th>
                <th className="px-3 py-2 text-right font-medium">Dispo moyenne</th>
              </tr></thead>
              <tbody>
                {data.parPrestataire.map((p: PrestaRow) => (
                  <tr key={p.nom} className="border-b border-gray-50 last:border-0">
                    <td className="py-2 pr-4 font-medium text-gray-800">
                      {p.nom}{p.enCours > 0 && <span className="ml-1.5 rounded-full bg-red-50 px-1.5 py-0.5 text-[10px] font-bold text-red-700">{p.enCours} en cours</span>}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{p.nbSites}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{p.coupures}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{p.sitesTouches}</td>
                    <td className="px-3 py-2 text-right tabular-nums font-semibold">{fmtNumber(p.downtimeHeures)} h</td>
                    <td className="px-3 py-2 text-right tabular-nums font-semibold text-[#7D3C98]">{fmtNumber(p.downtimePassifHeures)} h</td>
                    <td className="px-3 py-2 text-right tabular-nums text-[#2471A3]">{fmtNumber(p.downtimeActifHeures)} h</td>
                    <td className="px-3 py-2 text-right tabular-nums text-gray-500">{fmtNumber(p.downtimeNonClasseHeures)} h</td>
                    <td className={`px-3 py-2 text-right tabular-nums font-semibold ${p.dispoPct < 95 ? 'text-red-600' : p.dispoPct < 99 ? 'text-amber-600' : 'text-emerald-600'}`}>{p.dispoPct}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      </>}
    </div>
  );
}
