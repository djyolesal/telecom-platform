'use client';

import { useState, useEffect } from 'react';
import { useTypesIncident } from '@/lib/typesIncident';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { AlertTriangle, Fuel, X } from 'lucide-react';
import { api } from '@/lib/api';
import { useSupervisionSocket, StockUpdatedEvent } from '@/lib/hooks/useSupervisionSocket';

/** Vignette temps réel du dernier dépotage (photo + site + volume). */
function LiveDepotageCard({ e, onClose }: { e: StockUpdatedEvent; onClose: () => void }) {
  const router = useRouter();
  return (
    <div className="fixed bottom-4 right-4 z-50 w-72 rounded-xl border border-gray-200 bg-white shadow-xl overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 bg-[#0E7C6B] text-white text-xs font-semibold">
        <span className="inline-flex items-center gap-1"><Fuel size={13} /> Dépotage en direct</span>
        <button onClick={onClose} className="hover:opacity-80"><X size={14} /></button>
      </div>
      <button onClick={() => router.push(`/carburant/${e.depotageId}`)} className="block w-full text-left hover:bg-gray-50">
        {e.photoUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={e.photoUrl} alt="Dépotage" className="h-32 w-full object-cover" />
        )}
        <div className="p-3">
          <p className="text-sm font-semibold text-gray-800">{e.siteNom ?? 'Site'}</p>
          <p className="text-xs text-gray-500">
            {Math.round(Number(e.volumeLitres ?? 0)).toLocaleString('fr-FR')} L livrés
            {e.stockApresLitres != null ? ` · stock ${Math.round(Number(e.stockApresLitres)).toLocaleString('fr-FR')} L` : ''}
          </p>
        </div>
      </button>
    </div>
  );
}


const COLORS = ['#1B3F6B', '#0E7C6B', '#2471A3', '#F39C12', '#C0392B'];

/**
 * « Pouls du parc » : la Ligne de vie porte l'état du stock des sites —
 * battement positionné à la frontière saine → tension, jauge proportionnelle
 * OK / faible / critique. Clic → carte de supervision.
 */
function PoulsParc({ ok, faible, critique, stockTotal, autonomie, sitesActifs }: {
  ok: number; faible: number; critique: number; stockTotal: number; autonomie: number | null; sitesActifs: number;
}) {
  const router = useRouter();
  const total = Math.max(1, ok + faible + critique);
  const spikeX = 8 + 508 * Math.min(0.82, Math.max(0.12, ok / total));
  const tail = critique > 0 ? '#F87171' : faible > 0 ? '#FFB020' : '#3BC9AF';

  const stat = (value: string, label: string, color = 'text-white') => (
    <div>
      <p className={`text-xl font-extrabold leading-tight ${color}`}>{value}</p>
      <p className="text-[11px] text-[#C6D5E4]">{label}</p>
    </div>
  );

  return (
    <button
      onClick={() => router.push('/supervision/carte')}
      className="relative block w-full overflow-hidden rounded-xl bg-gradient-to-br from-[#1B3F6B] to-[#122C4E] p-5 text-left shadow-sm transition-shadow hover:shadow-md"
    >
      {/* Filigrane Écrou-signal */}
      <svg viewBox="0 0 120 120" className="pointer-events-none absolute -right-6 -top-8 h-44 w-44 opacity-[0.07]" aria-hidden="true">
        <path d="M104 60 L82 98 L38 98 L16 60 L38 22 L82 22 Z" fill="none" stroke="#fff" strokeWidth="9" strokeLinejoin="round" />
        <path d="M46 52 A18 18 0 0 1 74 52 M40 45 A25 25 0 0 1 80 45" fill="none" stroke="#fff" strokeWidth="6.5" strokeLinecap="round" />
      </svg>

      <div className="flex items-baseline justify-between">
        <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-[#9FB3C8]">Pouls du parc</span>
        <span className="text-xs text-[#3BC9AF]">Voir la carte →</span>
      </div>

      {/* Ligne de vie dynamique */}
      <svg viewBox="0 0 600 42" className="mt-2 h-11 w-full" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
        <line x1="8" y1="27" x2={spikeX} y2="27" stroke="#3BC9AF" strokeWidth="3" strokeLinecap="round" />
        <path d={`M${spikeX} 27 l8 -15 l10 25 l8 -12 l2 2`} fill="none" stroke="#FFB020" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        <line x1={spikeX + 28} y1="27" x2="572" y2="27" stroke={tail} strokeWidth="3" strokeLinecap="round" />
        <circle cx="586" cy="27" r="5" fill={tail} />
      </svg>

      {/* Jauge proportionnelle */}
      <div className="mt-1 flex h-2 overflow-hidden rounded-full">
        {ok > 0 && <span style={{ flex: ok, background: '#0E7C6B' }} />}
        {faible > 0 && <span style={{ flex: faible, background: '#F59E0B' }} />}
        {critique > 0 && <span style={{ flex: critique, background: '#DC2626' }} />}
        {ok + faible + critique === 0 && <span className="flex-1 bg-[#3A5573]" />}
      </div>

      <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
        {stat(String(sitesActifs), 'sites actifs')}
        {stat(String(ok), 'stock OK', 'text-[#3BC9AF]')}
        {stat(String(faible), 'stock faible', 'text-[#FFB020]')}
        {stat(String(critique), 'critiques / vides', 'text-[#F87171]')}
        {stat(stockTotal >= 10_000 ? `${(stockTotal / 1000).toFixed(0)}k L` : `${Math.round(stockTotal).toLocaleString('fr-FR')} L`, 'stock total')}
        {stat(autonomie != null ? `${autonomie} j` : '—', 'autonomie médiane')}
      </div>
    </button>
  );
}

/**
 * Aiguillage par rôle. Le TRANSPORTEUR (prestataire externe) n'a pas accès aux
 * agrégats du parc : /rapports/dashboard lui est fermé côté API et le canal
 * supervision lui est refusé. On rend donc un tableau de bord distinct, bâti
 * sur ses seuls chargements - au lieu de le laisser tomber sur « Accès refusé ».
 * On attend que la session soit chargée : sinon le rôle est vide une fraction de
 * seconde et la requête interdite partirait quand même (403 dans la console).
 */
export function DashboardInterne() {
  const { labelDe } = useTypesIncident();
  const router = useRouter();
  const { data: dashData, isLoading } = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api.get('/rapports/dashboard').then(r => r.data.data),
    refetchInterval: 60_000,
    // staleTime aligné : sans lui, chaque tick refait un aller-retour réseau
    // même si la donnée vient d'arriver (endpoints agrégés coûteux).
    staleTime: 60_000, // Refresh toutes les minutes
  });

  // Écoute WebSocket pour mises à jour en temps réel + vignette dépotage.
  const [live, setLive] = useState<StockUpdatedEvent | null>(null);
  useSupervisionSocket({ onStockUpdated: (e) => setLive(e) });
  useEffect(() => {
    if (!live) return;
    const t = setTimeout(() => setLive(null), 12_000);
    return () => clearTimeout(t);
  }, [live]);

  if (isLoading) return (
    <div className="space-y-6 animate-pulse">
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="h-52 bg-gray-200 rounded-xl xl:col-span-2" />
        <div className="h-52 bg-gray-200 rounded-xl" />
      </div>
      <div className="grid grid-cols-2 gap-6">
        <div className="h-72 bg-gray-200 rounded-xl" />
        <div className="h-72 bg-gray-200 rounded-xl" />
      </div>
    </div>
  );

  const d = dashData || {};
  const critiques = Number(d.sitesCritiques || 0);
  const faibles = Number(d.sitesFaibles || 0);
  const ok = d.sitesOk != null ? Number(d.sitesOk) : Math.max(0, Number(d.sitesActifs || 0) - critiques - faibles);

  const powerConfigData = [
    { name: 'CEET+GE', value: d.parPowerConfig?.CEET_GE || 0 },
    { name: 'GE Only', value: d.parPowerConfig?.GE_UNIQUEMENT || 0 },
    { name: 'Hybride', value: d.parPowerConfig?.HYBRIDE_GE || 0 },
    { name: 'CEET', value: d.parPowerConfig?.CEET_UNIQUEMENT || 0 },
    { name: 'Solaire', value: d.parPowerConfig?.SOLAIRE_UNIQUEMENT || 0 },
  ].filter(x => x.value > 0);

  return (
    <div className="space-y-6">
      {live && <LiveDepotageCard e={live} onClose={() => setLive(null)} />}

      {/* ── Pouls du parc + panneau incidents ── */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2">
          <PoulsParc
            ok={ok}
            faible={faibles}
            critique={critiques}
            stockTotal={Number(d.stockTotalLitres || 0)}
            autonomie={d.autonomieMediane ?? null}
            sitesActifs={Number(d.sitesActifs || 0)}
          />
        </div>

        <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm flex flex-col">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-gray-700 text-sm inline-flex items-center gap-1.5">
              <AlertTriangle size={15} className={critiquesInc(d) > 0 ? 'text-red-500' : 'text-gray-400'} />
              Incidents
            </h3>
            <button onClick={() => router.push('/incidents')} className="text-xs text-[#1B3F6B] hover:underline">Voir tout →</button>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-3xl font-extrabold text-gray-800">{d.incidentsOuverts || 0}</span>
            <span className="text-xs text-gray-400">ouverts{critiquesInc(d) > 0 ? ` · dont ${critiquesInc(d)} critiques` : ''}</span>
          </div>
          <div className="mt-3 space-y-1.5 overflow-y-auto max-h-40">
            {(d.incidentsRecents || []).map((inc: Record<string, string>) => (
              <div key={inc.id} className="flex items-center gap-2.5 rounded-lg p-1.5 text-xs hover:bg-gray-50">
                <span className={`h-2 w-2 flex-shrink-0 rounded-full ${inc.severite === 'CRITIQUE' ? 'bg-red-500' : inc.severite === 'MAJEUR' ? 'bg-orange-500' : 'bg-yellow-400'}`} />
                <span className="flex-1 truncate font-medium text-gray-700">{inc.siteNom} - {labelDe(inc.type)}</span>
                <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${inc.statut === 'OUVERT' ? 'bg-red-100 text-red-700' : inc.statut === 'EN_COURS' ? 'bg-orange-100 text-orange-700' : 'bg-green-100 text-green-700'}`}>
                  {({ OUVERT: 'Ouvert', EN_COURS: 'En cours', RESOLU: 'Résolu', CLOS: 'Clos' } as Record<string, string>)[inc.statut] ?? inc.statut}
                </span>
              </div>
            ))}
            {(!d.incidentsRecents || d.incidentsRecents.length === 0) && (
              <p className="py-4 text-center text-xs text-gray-400">✅ Aucun incident récent</p>
            )}
          </div>
        </div>
      </div>

      {/* ── Graphiques ── */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
          <h3 className="font-semibold text-gray-700 mb-4 text-sm">Consommation GE mensuelle (kWh)</h3>
          {!(d.consoMensuelle?.some((m: { ge?: number; ceet?: number }) => (m.ge ?? 0) + (m.ceet ?? 0) > 0)) ? (
            <p className="flex h-[220px] items-center justify-center text-sm text-gray-400">Aucune consommation enregistrée sur la période.</p>
          ) : (
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={d.consoMensuelle || []}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="mois" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip formatter={(v) => [`${Number(v).toLocaleString('fr-FR')} kWh`]} />
              <Bar dataKey="ge" fill="#1B3F6B" name="GE" radius={[3,3,0,0]} />
              <Bar dataKey="ceet" fill="#0E7C6B" name="CEET" radius={[3,3,0,0]} />
            </BarChart>
          </ResponsiveContainer>
          )}
        </div>

        <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
          <h3 className="font-semibold text-gray-700 mb-4 text-sm">Répartition configuration énergie</h3>
          <div className="flex items-center">
            <ResponsiveContainer width="60%" height={220}>
              <PieChart>
                <Pie data={powerConfigData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label={false}>
                  {powerConfigData.map((_, i) => (
                    <Cell key={i} fill={COLORS[i % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(v, n) => [`${v} sites`, n]} />
              </PieChart>
            </ResponsiveContainer>
            <div className="flex-1 space-y-2">
              {powerConfigData.map((item, i) => (
                <div key={item.name} className="flex items-center gap-2 text-xs">
                  <div className="w-3 h-3 rounded-sm flex-shrink-0" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                  <span className="text-gray-600 flex-1">{item.name}</span>
                  <span className="font-medium text-gray-800">{item.value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <ParcParPrestataire />

      {/* ── Stock par région ── */}
      <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
        <h3 className="font-semibold text-gray-700 mb-4 text-sm">Stock carburant par région (L)</h3>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={d.stockParRegion || []} layout="vertical">
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={v => `${(v/1000).toFixed(0)}k`} />
            <YAxis dataKey="region" type="category" tick={{ fontSize: 10 }} width={80} />
            <Tooltip formatter={v => [`${Number(v).toLocaleString('fr-FR')} L`]} />
            <Bar dataKey="stock" fill="#2471A3" radius={[0,3,3,0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function critiquesInc(d: Record<string, unknown>): number {
  return Number((d as { incidentsCritiques?: number }).incidentsCritiques || 0);
}

// ── Parc par prestataire ────────────────────────────────────────────────────
// Nombre de sites couverts par chaque société, avec l'état du moment : combien
// sont actuellement en coupure site entier. Réservé aux internes - pour un
// compte prestataire l'API répond 403 et le bloc ne s'affiche pas.

function ParcParPrestataire() {
  const { data, isError } = useQuery({
    queryKey: ['parc-prestataires'],
    queryFn: () => api.get('/rapports/parc-prestataires').then((r) => r.data.data as {
      prestataires: { nom: string; nbSites: number; sitesCoupes: number }[];
      sitesNonAffectes: number;
    }),
    refetchInterval: 120_000,
    retry: false,
  });
  if (isError || !data || data.prestataires.length === 0) return null;
  const max = Math.max(...data.prestataires.map((p) => p.nbSites), 1);

  return (
    <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
      <h3 className="font-semibold text-gray-700 mb-1 text-sm">Parc par prestataire</h3>
      <p className="mb-4 text-xs text-gray-400">Sites couverts par société - en rouge, ceux actuellement en coupure site entier.</p>
      <div className="space-y-2.5">
        {data.prestataires.map((p) => (
          <div key={p.nom} className="flex items-center gap-3">
            <span className="w-40 truncate text-sm font-medium text-gray-700" title={p.nom}>{p.nom}</span>
            <div className="h-4 flex-1 overflow-hidden rounded bg-gray-100">
              <div className="flex h-full" style={{ width: `${(p.nbSites / max) * 100}%` }}>
                <div className="h-full bg-[#C0392B]" style={{ width: `${p.nbSites ? (p.sitesCoupes / p.nbSites) * 100 : 0}%` }} />
                <div className="h-full flex-1 bg-[#2471A3]" />
              </div>
            </div>
            <span className="w-32 text-right text-sm tabular-nums text-gray-700">
              <b>{p.nbSites}</b> sites
              {p.sitesCoupes > 0 && <span className="ml-1.5 rounded-full bg-red-50 px-1.5 py-0.5 text-[10px] font-bold text-red-700">{p.sitesCoupes} coupé(s)</span>}
            </span>
          </div>
        ))}
        {data.sitesNonAffectes > 0 && (
          <p className="pt-1 text-xs font-medium text-amber-600">
            {data.sitesNonAffectes} site(s) actif(s) sans lot - à affecter (Administration → Lots).
          </p>
        )}
      </div>
    </div>
  );
}
