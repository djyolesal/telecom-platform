'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation } from '@tanstack/react-query';
import { AlertTriangle, Droplet, Truck, MapPin, Check, Sparkles, ShieldAlert } from 'lucide-react';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/shared/PageHeader';
import { StatCard } from '@/components/shared/StatCard';
import { DataTable, Column } from '@/components/shared/DataTable';
import { Loading, EmptyState } from '@/components/shared/states';
import { Badge } from '@/components/shared/Badge';
import { Button } from '@/components/shared/Button';
import { Select } from '@/components/shared/Form';
import { regionOptions } from '@/lib/constants';
import { fmtNumber, fmtDate } from '@/lib/utils';

const MOIS = ['', 'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];
const PRIO_COLORS: Record<string, string> = { CRITIQUE: 'bg-red-600 text-white', URGENT: 'bg-amber-100 text-amber-700', A_PLANIFIER: 'bg-gray-100 text-gray-600' };
const PRIO_LABEL: Record<string, string> = { CRITIQUE: 'Critique', URGENT: 'Urgent', A_PLANIFIER: 'À planifier' };

interface SiteForecast { siteId: string; code: string; nom: string; region: string; stockActuel: number; consoJour: number; source: string; tendance: string; autonomieJours: number | null; dateLivraisonCible: string | null; joursAvantLivraison: number | null; quantiteRecommandee: number; priorite: string }
interface Anomalie { siteId: string; code: string; nom: string; region: string; consoReelleJour: number; consoTheoriqueJour: number; ecartPct: number; type: string; tendance: string; manquantAssocie: boolean; severite: string }
interface Tournee { region: string; sites: Array<{ siteId: string; code: string; nom: string; quantite: number; passage?: number; nbPassages?: number }>; total: number; capacite: number; distanceKm: number; tauxRemplissage: number }
interface ReapproData { sites: SiteForecast[]; tournees: Tournee[]; params: { horizonJours: number; capaciteCamion: number }; totaux: { nbSites: number; nbCritiques: number; volumeRecommande: number; nbTournees: number; totalKm: number; tauxRemplissageMoyen: number } }
interface BCOption { id: string; numero: string }

export default function ReapprovisionnementPage() {
  const router = useRouter();
  const [tab, setTab] = useState<'sites' | 'tournees' | 'anomalies'>('sites');
  const [region, setRegion] = useState('');
  const [horizon, setHorizon] = useState('14');
  const [bcId, setBcId] = useState('');
  const [mois, setMois] = useState(String(new Date().getMonth() + 1));
  const [done, setDone] = useState<Record<number, string>>({}); // index tournée → blId créé

  const { data: bcs = [] } = useQuery({
    queryKey: ['bcs-options'],
    queryFn: () => api.get('/bons-commande', { params: { limit: 100 } }).then((r) => r.data.data as BCOption[]),
  });

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['reappro', region, horizon],
    queryFn: () => api.get('/rapports/reapprovisionnement', { params: { region: region || undefined, horizon } }).then((r) => r.data.data as ReapproData),
  });

  const { data: anomData } = useQuery({
    queryKey: ['anomalies', region],
    queryFn: () => api.get('/rapports/anomalies-conso', { params: { region: region || undefined } }).then((r) => r.data.data as { anomalies: Anomalie[]; totaux: { nb: number; nbElevees: number; nbSurconso: number } }),
  });

  // Synthèse Claude — générée à la demande.
  const synthese = useMutation({
    mutationFn: () => api.get('/rapports/synthese-appro', { params: { region: region || undefined } }).then((r) => r.data.data as { texte: string; source: string }),
  });

  const createBrouillon = useMutation({
    mutationFn: (vars: { tournee: Tournee }) => api.post('/bons-livraison/brouillon', {
      bonCommandeId: bcId, mois: parseInt(mois),
      lignes: vars.tournee.sites.map((s) => ({ siteId: s.siteId, volumePrevuLitres: s.quantite })),
    }).then((r) => r.data.data as { id: string }),
  });

  if (isLoading) return <Loading />;
  const t = data?.totaux;

  const cols: Column<SiteForecast>[] = [
    { key: 'code', header: 'Site', render: (s) => <span className="font-medium text-gray-800">{s.code}</span> },
    { key: 'nom', header: 'Nom', render: (s) => <span className="text-gray-600">{s.nom}</span> },
    { key: 'region', header: 'Région' },
    { key: 'stockActuel', header: 'Stock (L)', align: 'right', render: (s) => fmtNumber(s.stockActuel) },
    { key: 'consoJour', header: 'Conso/j (L)', align: 'right', render: (s) => <span title={s.source === 'historique' ? 'D’après l’historique des relevés' : 'Estimation théorique (GE)'}>{fmtNumber(s.consoJour)}{s.source === 'theorique' && ' *'}</span> },
    { key: 'tendance', header: 'Tend.', align: 'center', render: (s) => <span title={`Tendance ${s.tendance.toLowerCase()}`} className={s.tendance === 'HAUSSE' ? 'text-red-600' : s.tendance === 'BAISSE' ? 'text-green-600' : 'text-gray-400'}>{s.tendance === 'HAUSSE' ? '↗' : s.tendance === 'BAISSE' ? '↘' : '→'}</span> },
    { key: 'autonomie', header: 'Autonomie', align: 'right', render: (s) => s.autonomieJours != null ? `${s.autonomieJours} j` : '—' },
    { key: 'livraison', header: 'À livrer le', render: (s) => s.dateLivraisonCible ? <span className={(s.joursAvantLivraison ?? 1) <= 0 ? 'text-red-600 font-medium' : ''}>{fmtDate(s.dateLivraisonCible)}</span> : '—' },
    { key: 'quantite', header: 'Quantité reco (L)', align: 'right', render: (s) => <span className="font-semibold text-gray-800">{fmtNumber(s.quantiteRecommandee)}</span> },
    { key: 'priorite', header: 'Priorité', align: 'center', render: (s) => <Badge className={PRIO_COLORS[s.priorite] || ''}>{PRIO_LABEL[s.priorite] || s.priorite}</Badge> },
  ];

  return (
    <div>
      <PageHeader
        title="Réapprovisionnement prédictif"
        subtitle={`Prévision de rupture et tournées suggérées · horizon ${data?.params.horizonJours ?? 14} j`}
        backHref="/carburant/commandes"
        actions={<Button icon={Sparkles} loading={synthese.isPending} onClick={() => synthese.mutate()}>Synthèse intelligente</Button>}
      />

      {synthese.data && (
        <div className="mb-5 rounded-xl border border-indigo-100 bg-indigo-50/50 p-5">
          <div className="flex items-center gap-2 mb-2">
            <Sparkles size={16} className="text-indigo-600" />
            <h3 className="font-semibold text-indigo-900 text-sm">Synthèse opérationnelle</h3>
            <span className="text-xs text-gray-500">· {synthese.data.source === 'claude' ? 'générée par Claude' : 'résumé automatique'}</span>
          </div>
          <p className="text-sm text-gray-700 whitespace-pre-line">{synthese.data.texte}</p>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-5">
        <StatCard title="Sites à livrer" value={String(t?.nbSites ?? 0)} icon={MapPin} color="bg-[#1B3F6B]" />
        <StatCard title="Critiques" value={String(t?.nbCritiques ?? 0)} icon={AlertTriangle} color="bg-[#C0392B]" />
        <StatCard title="Volume recommandé" value={`${fmtNumber(t?.volumeRecommande ?? 0)} L`} icon={Droplet} color="bg-[#2471A3]" />
        <StatCard title="Tournées suggérées" value={String(t?.nbTournees ?? 0)} icon={Truck} color="bg-[#0E7C6B]" />
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="w-48"><Select value={region} onChange={(e) => setRegion(e.target.value)} placeholder="Toutes régions" options={regionOptions} /></div>
        <div className="w-36"><Select value={horizon} onChange={(e) => setHorizon(e.target.value)} options={[{ value: '7', label: '7 jours' }, { value: '14', label: '14 jours' }, { value: '30', label: '30 jours' }]} /></div>
      </div>

      <div className="flex gap-1 border-b border-gray-200 mb-4">
        {(['sites', 'tournees', 'anomalies'] as const).map((k) => (
          <button key={k} onClick={() => setTab(k)} className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 -mb-px ${tab === k ? 'border-[#1B3F6B] text-[#1B3F6B]' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
            {k === 'sites' ? <><MapPin size={15} /> Sites à livrer</> : k === 'tournees' ? <><Truck size={15} /> Tournées suggérées</> : <><ShieldAlert size={15} /> Anomalies conso {anomData?.totaux.nb ? <Badge className="bg-red-100 text-red-700 ml-1">{anomData.totaux.nb}</Badge> : null}</>}
          </button>
        ))}
      </div>

      {tab === 'sites' && (data?.sites.length
        ? <><DataTable columns={cols} data={data.sites} rowKey={(s) => s.siteId} rowClassName={(s) => s.priorite === 'CRITIQUE' ? 'bg-red-50' : undefined} />
            <p className="text-xs text-gray-400 mt-2">* conso estimée (théorique GE), faute d&apos;historique suffisant.</p></>
        : <EmptyState title="Aucun site à livrer sur l'horizon" hint="Tous les sites ont une autonomie supérieure à l'horizon choisi." />)}

      {tab === 'tournees' && (
        <div>
          <div className="mb-3 flex flex-wrap items-center gap-x-6 gap-y-1 text-sm text-gray-600">
            <span><Truck size={14} className="inline -mt-0.5 mr-1 text-[#0E7C6B]" /><b>{t?.nbTournees ?? 0}</b> tournées optimisées</span>
            <span>≈ <b>{fmtNumber(t?.totalKm ?? 0)}</b> km au total</span>
            <span>remplissage moyen <b>{t?.tauxRemplissageMoyen ?? 0} %</b></span>
            <span className="text-xs text-gray-400">(regroupement par balayage géographique + 2-opt)</span>
          </div>

          <div className="flex flex-wrap items-center gap-3 mb-4 rounded-lg bg-gray-50 border border-gray-200 p-3">
            <span className="text-sm font-medium text-gray-600">Pour créer les brouillons :</span>
            <div className="w-56"><Select value={bcId} onChange={(e) => setBcId(e.target.value)} placeholder="Bon de commande…" options={bcs.map((b) => ({ value: b.id, label: b.numero }))} /></div>
            <div className="w-36"><Select value={mois} onChange={(e) => setMois(e.target.value)} options={MOIS.slice(1).map((m, i) => ({ value: String(i + 1), label: m }))} /></div>
          </div>

          {!data?.tournees.length ? (
            <EmptyState title="Aucune tournée suggérée" />
          ) : (
            <div className="grid md:grid-cols-2 gap-4">
              {data.tournees.map((tr, i) => {
                const pct = Math.min(100, Math.round((tr.total / tr.capacite) * 100));
                const created = done[i];
                return (
                  <div key={i} className="bg-white rounded-xl border border-gray-100 p-4">
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="font-semibold text-gray-800 text-sm">{tr.region} · {tr.sites.length} sites</h3>
                      <span className="text-xs text-gray-500">{fmtNumber(tr.total)} / {fmtNumber(tr.capacite)} L · {tr.tauxRemplissage}%</span>
                    </div>
                    <div className="h-1.5 w-full rounded bg-gray-100 mb-1"><div className="h-1.5 rounded bg-[#0E7C6B]" style={{ width: `${pct}%` }} /></div>
                    <p className="text-xs text-gray-400 mb-3">≈ {fmtNumber(tr.distanceKm)} km de tournée</p>
                    <ul className="text-sm space-y-1 mb-3 max-h-40 overflow-y-auto">
                      {tr.sites.map((s, si) => (
                        <li key={`${s.siteId}-${si}`} className="flex justify-between">
                          <span className="text-gray-700">
                            {s.code} <span className="text-gray-400">{s.nom}</span>
                            {s.nbPassages && s.nbPassages > 1 && (
                              <span className="ml-1.5 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700" title="Ce site nécessite plusieurs camions">passage {s.passage}/{s.nbPassages}</span>
                            )}
                          </span>
                          <span className="font-medium">{fmtNumber(s.quantite)} L</span>
                        </li>
                      ))}
                    </ul>
                    {created ? (
                      <button onClick={() => router.push(`/carburant/livraisons/${created}`)} className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-green-50 border border-green-200 px-3 py-2 text-sm font-medium text-green-700">
                        <Check size={15} /> Brouillon créé — ouvrir
                      </button>
                    ) : (
                      <button
                        disabled={!bcId || createBrouillon.isPending}
                        onClick={async () => {
                          const r = await createBrouillon.mutateAsync({ tournee: tr });
                          setDone((d) => ({ ...d, [i]: r.id }));
                          refetch();
                        }}
                        className="w-full rounded-lg bg-[#1B3F6B] px-3 py-2 text-sm font-medium text-white disabled:opacity-40">
                        {bcId ? 'Créer le brouillon de livraison' : 'Choisir un bon de commande'}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {tab === 'anomalies' && (
        <div>
          <p className="text-xs text-gray-500 mb-3">Consommation réelle (relevés) comparée à la consommation théorique (puissance × heures GE). Un écart fort signale une fuite, un vol, ou des heures GE mal déclarées — d&apos;autant plus si le site a aussi un manquant de livraison.</p>
          {!anomData?.anomalies.length ? (
            <EmptyState title="Aucune anomalie détectée" hint="La consommation réelle des sites suit l'attendu (dans la tolérance configurée)." />
          ) : (
            <DataTable
              columns={[
                { key: 'code', header: 'Site', render: (a: Anomalie) => <span className="font-medium text-gray-800">{a.code}</span> },
                { key: 'nom', header: 'Nom', render: (a: Anomalie) => <span className="text-gray-600">{a.nom}</span> },
                { key: 'region', header: 'Région' },
                { key: 'reelle', header: 'Réelle/j (L)', align: 'right', render: (a: Anomalie) => fmtNumber(a.consoReelleJour) },
                { key: 'theo', header: 'Attendue/j (L)', align: 'right', render: (a: Anomalie) => fmtNumber(a.consoTheoriqueJour) },
                { key: 'ecart', header: 'Écart', align: 'right', render: (a: Anomalie) => <span className={a.ecartPct > 0 ? 'text-red-600 font-semibold' : 'text-amber-600 font-medium'}>{a.ecartPct > 0 ? '+' : ''}{a.ecartPct}%</span> },
                { key: 'type', header: 'Type', render: (a: Anomalie) => a.type === 'SURCONSOMMATION' ? 'Surconsommation' : 'Sous-consommation' },
                { key: 'manquant', header: 'Manquant', align: 'center', render: (a: Anomalie) => a.manquantAssocie ? <Badge className="bg-red-100 text-red-700">oui</Badge> : <span className="text-gray-300">—</span> },
                { key: 'severite', header: 'Sévérité', align: 'center', render: (a: Anomalie) => <Badge className={a.severite === 'ELEVEE' ? 'bg-red-600 text-white' : 'bg-amber-100 text-amber-700'}>{a.severite === 'ELEVEE' ? 'Élevée' : 'Moyenne'}</Badge> },
              ]}
              data={anomData.anomalies}
              rowKey={(a) => a.siteId}
              rowClassName={(a) => a.severite === 'ELEVEE' ? 'bg-red-50' : undefined}
            />
          )}
        </div>
      )}
    </div>
  );
}
