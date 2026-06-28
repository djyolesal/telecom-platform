'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Download, AlertTriangle, MapPin, Truck, Calendar } from 'lucide-react';
import { api } from '@/lib/api';
import { downloadFile } from '@/lib/download';
import { PageHeader } from '@/components/shared/PageHeader';
import { StatCard } from '@/components/shared/StatCard';
import { DataTable, Column } from '@/components/shared/DataTable';
import { Loading, EmptyState } from '@/components/shared/states';
import { Badge } from '@/components/shared/Badge';
import { Button } from '@/components/shared/Button';
import { Select } from '@/components/shared/Form';
import { fmtNumber } from '@/lib/utils';

const MOIS = ['', 'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];

interface ParSite { siteCode: string; siteNom: string; region: string; prevu: number; livre: number; manquant: number; nbEnRetard: number }
interface ParCamion { blId: string; numeroBL: string; bcNumero: string; mois: number; immatriculation: string; transporteur?: string; charge: number; distribue: number; manquant: number; nbSitesManquants: number; jours: number }
interface ParMois { bcNumero: string; annee: number; mois: number; prevu: number; charge: number; livre: number; manquantCharge: number; manquantLivre: number }
interface ParBc { bcId: string; numero: string; annee: number; trimestre: number; prevu: number; charge: number; livre: number; manquant: number }
interface ManquantsData {
  seuilJours: number;
  parSite: ParSite[]; parCamion: ParCamion[]; parMois: ParMois[]; parBc: ParBc[];
  totaux: { manquantSitesLitres: number; nbSitesManquants: number; nbSitesEnRetard: number; nbCamionsEcart: number; manquantMensuelLitres: number; nbLignesEnRetard: number };
}
interface BCOption { id: string; numero: string }

const TABS = [
  { key: 'site', label: 'Par site', icon: MapPin },
  { key: 'camion', label: 'Par camion', icon: Truck },
  { key: 'mois', label: 'Par mois', icon: Calendar },
  { key: 'bc', label: 'Par bon de commande', icon: Calendar },
] as const;

const mq = (v: number) => <span className={v > 0 ? 'font-semibold text-red-600' : 'text-gray-400'}>{v > 0 ? fmtNumber(v) : '—'}</span>;

export default function ManquantsPage() {
  const router = useRouter();
  const [tab, setTab] = useState<'site' | 'camion' | 'mois' | 'bc'>('site');
  const [bcId, setBcId] = useState('');
  const [mois, setMois] = useState('');

  const { data: bcs = [] } = useQuery({
    queryKey: ['bcs-options'],
    queryFn: () => api.get('/bons-commande', { params: { limit: 100 } }).then((r) => r.data.data as BCOption[]),
  });

  const { data, isLoading } = useQuery({
    queryKey: ['manquants', bcId, mois],
    queryFn: () => api.get('/rapports/manquants-livraison', { params: { bc_id: bcId || undefined, mois: mois || undefined } }).then((r) => r.data.data as ManquantsData),
  });

  if (isLoading) return <Loading />;
  const t = data?.totaux;
  const params = new URLSearchParams({ ...(bcId ? { bc_id: bcId } : {}), ...(mois ? { mois } : {}) }).toString();

  const colsSite: Column<ParSite>[] = [
    { key: 'siteCode', header: 'Site', render: (s) => <span className="font-medium text-gray-800">{s.siteCode}</span> },
    { key: 'siteNom', header: 'Nom', render: (s) => <span className="text-gray-600">{s.siteNom}</span> },
    { key: 'region', header: 'Région' },
    { key: 'prevu', header: 'Prévu (L)', align: 'right', render: (s) => fmtNumber(s.prevu) },
    { key: 'livre', header: 'Livré (L)', align: 'right', render: (s) => fmtNumber(s.livre) },
    { key: 'manquant', header: 'Manquant (L)', align: 'right', render: (s) => mq(s.manquant) },
    { key: 'nbEnRetard', header: 'En retard', align: 'center', render: (s) => s.nbEnRetard > 0 ? <Badge className="bg-red-100 text-red-700">{s.nbEnRetard}</Badge> : <span className="text-gray-300">—</span> },
  ];
  const colsCamion: Column<ParCamion>[] = [
    { key: 'numeroBL', header: 'N° BL', render: (c) => <span className="font-medium text-gray-800">{c.numeroBL}</span> },
    { key: 'bcNumero', header: 'BC' },
    { key: 'immatriculation', header: 'Camion' },
    { key: 'transporteur', header: 'Transporteur', render: (c) => c.transporteur ?? '—' },
    { key: 'charge', header: 'Chargé (L)', align: 'right', render: (c) => fmtNumber(c.charge) },
    { key: 'distribue', header: 'Distribué (L)', align: 'right', render: (c) => fmtNumber(c.distribue) },
    { key: 'manquant', header: 'Manquant (L)', align: 'right', render: (c) => mq(c.manquant) },
    { key: 'jours', header: 'Ancienneté', align: 'center', render: (c) => `${c.jours} j` },
  ];
  const colsMois: Column<ParMois>[] = [
    { key: 'bcNumero', header: 'BC' },
    { key: 'mois', header: 'Mois', render: (m) => `${MOIS[m.mois]} ${m.annee}` },
    { key: 'prevu', header: 'Prévu (L)', align: 'right', render: (m) => fmtNumber(m.prevu) },
    { key: 'charge', header: 'Chargé (L)', align: 'right', render: (m) => fmtNumber(m.charge) },
    { key: 'livre', header: 'Livré (L)', align: 'right', render: (m) => fmtNumber(m.livre) },
    { key: 'manquantCharge', header: 'Manq. chargé', align: 'right', render: (m) => mq(m.manquantCharge) },
    { key: 'manquantLivre', header: 'Manq. livré', align: 'right', render: (m) => mq(m.manquantLivre) },
  ];
  const colsBc: Column<ParBc>[] = [
    { key: 'numero', header: 'BC', render: (b) => <span className="font-medium text-gray-800">{b.numero}</span> },
    { key: 'periode', header: 'Période', render: (b) => `T${b.trimestre} ${b.annee}` },
    { key: 'prevu', header: 'Prévu (L)', align: 'right', render: (b) => fmtNumber(b.prevu) },
    { key: 'charge', header: 'Chargé (L)', align: 'right', render: (b) => fmtNumber(b.charge) },
    { key: 'livre', header: 'Livré (L)', align: 'right', render: (b) => fmtNumber(b.livre) },
    { key: 'manquant', header: 'Manquant (L)', align: 'right', render: (b) => mq(b.manquant) },
  ];

  return (
    <div>
      <PageHeader
        title="Suivi des manquants de livraison"
        subtitle={`Écart entre prévu et réellement livré · seuil de retard ${data?.seuilJours ?? 7} j`}
        backHref="/carburant/commandes"
        actions={<Button variant="secondary" icon={Download} onClick={() => downloadFile(`/rapports/manquants-livraison/export/xlsx${params ? `?${params}` : ''}`, 'manquants-livraison.xlsx')}>Excel</Button>}
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-5">
        <StatCard title="Manquant total (sites)" value={`${fmtNumber(t?.manquantSitesLitres ?? 0)} L`} icon={AlertTriangle} color="bg-[#C0392B]" />
        <StatCard title="Sites manquants" value={String(t?.nbSitesManquants ?? 0)} icon={MapPin} color="bg-[#1B3F6B]" />
        <StatCard title="Camions avec écart" value={String(t?.nbCamionsEcart ?? 0)} icon={Truck} color="bg-[#2471A3]" />
        <StatCard title="Lignes en retard" value={String(t?.nbLignesEnRetard ?? 0)} icon={AlertTriangle} color="bg-[#B9770E]" />
      </div>

      {/* Filtres */}
      <div className="flex flex-wrap gap-3 mb-4">
        <div className="w-56"><Select value={bcId} onChange={(e) => setBcId(e.target.value)} placeholder="Tous les bons de commande" options={bcs.map((b) => ({ value: b.id, label: b.numero }))} /></div>
        <div className="w-40"><Select value={mois} onChange={(e) => setMois(e.target.value)} placeholder="Tous les mois" options={MOIS.slice(1).map((m, i) => ({ value: String(i + 1), label: m }))} /></div>
      </div>

      {/* Onglets */}
      <div className="flex gap-1 border-b border-gray-200 mb-4">
        {TABS.map((tb) => (
          <button key={tb.key} onClick={() => setTab(tb.key)}
            className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 -mb-px ${tab === tb.key ? 'border-[#1B3F6B] text-[#1B3F6B]' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
            <tb.icon size={15} /> {tb.label}
          </button>
        ))}
      </div>

      {tab === 'site' && (data?.parSite.length ? <DataTable columns={colsSite} data={data.parSite} /> : <EmptyState title="Aucun manquant par site" />)}
      {tab === 'camion' && (data?.parCamion.length ? <DataTable columns={colsCamion} data={data.parCamion} onRowClick={(c) => router.push(`/carburant/livraisons/${c.blId}`)} /> : <EmptyState title="Aucun écart par camion" />)}
      {tab === 'mois' && (data?.parMois.length ? <DataTable columns={colsMois} data={data.parMois} /> : <EmptyState title="Aucune donnée mensuelle" />)}
      {tab === 'bc' && (data?.parBc.length ? <DataTable columns={colsBc} data={data.parBc} onRowClick={(b) => router.push(`/carburant/commandes/${b.bcId}`)} /> : <EmptyState title="Aucune donnée par bon de commande" />)}
    </div>
  );
}
