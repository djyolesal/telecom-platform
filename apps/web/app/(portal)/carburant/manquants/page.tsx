'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Download, AlertTriangle, MapPin, Truck, Calendar, Camera, X, ClipboardList, User } from 'lucide-react';
import { api } from '@/lib/api';
import { downloadFile } from '@/lib/download';
import { ExportButtons } from '@/components/shared/ExportButtons';
import { PageHeader } from '@/components/shared/PageHeader';
import { StatCard } from '@/components/shared/StatCard';
import { DataTable, Column } from '@/components/shared/DataTable';
import { Loading, EmptyState } from '@/components/shared/states';
import { Badge } from '@/components/shared/Badge';
import { Button } from '@/components/shared/Button';
import { Select } from '@/components/shared/Form';
import { SearchSelect } from '@/components/shared/SearchSelect';
import { regionOptions } from '@/lib/constants';
import { fmtNumber, fmtDate } from '@/lib/utils';

const MOIS = ['', 'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];

interface ParSite { siteId: string; siteCode: string; siteNom: string; region: string; prevu: number; livre: number; manquant: number; surLivre: number; nbEnRetard: number; nbCritiques: number }
interface SiteLigne { ligneId: string; blId: string; numeroBL: string; bcNumero: string; transporteur?: string; immatriculation: string; mois: number; annee: number; dateChargement: string; jours: number; prevu: number; livre: number; manquant: number; statut: string; enRetard: boolean }
interface ParCamion { blId: string; numeroBL: string; bcNumero: string; mois: number; immatriculation: string; transporteur?: string; charge: number; distribue: number; manquant: number; surLivre: number; clos: boolean; ventile: number; nbSitesManquants: number; jours: number; enRetard: boolean; critique: boolean }
interface ParMois { bcNumero: string; annee: number; mois: number; prevu: number; charge: number; livre: number; manquantCharge: number; manquantLivre: number; surCharge: number }
// Axes TRANSPORT : l'écart de livraison est imputable au transport, pas au site.
interface AxeTransport { id: string; libelle: string; charge: number; distribue: number; manquant: number; tauxManquantPct: number; nbBl: number; nbBlEcart: number }
interface BlEnAttente { id: string; numeroBL: string; bcNumero: string | null; immatriculation: string; transporteur: string | null; volumeChargeLitres: number; dateChargement: string | null; jours: number }
interface ParBc { bcId: string; numero: string; annee: number; trimestre: number; prevu: number; charge: number; livre: number; manquant: number }
interface ManquantsData {
  seuilJours: number;
  parSite: ParSite[]; parCamion: ParCamion[]; parMois: ParMois[]; parBc: ParBc[];
  parChauffeur: AxeTransport[]; parVehicule: AxeTransport[];
  totaux: { manquantSitesLitres: number; nbSitesManquants: number; nbSitesEnRetard: number; nbCamionsEcart: number; manquantMensuelLitres: number; nbLignesEnRetard: number; nbLignesCritiques: number; nbCamionsCritiques: number; surLivreSitesLitres: number; nbSitesSurLivres: number };
  pilotage: { seuilJours: number; sansPlan: BlEnAttente[]; brouillonsOublies: BlEnAttente[] };
}
interface BCOption { id: string; numero: string }

const TABS = [
  { key: 'site', label: 'Par site', icon: MapPin },
  { key: 'camion', label: 'Par camion', icon: Truck },
  { key: 'mois', label: 'Par mois', icon: Calendar },
  { key: 'bc', label: 'Par bon de commande', icon: Calendar },
  { key: 'chauffeur', label: 'Par chauffeur', icon: User },
  { key: 'vehicule', label: 'Par véhicule', icon: Truck },
  { key: 'attente', label: 'À traiter', icon: ClipboardList },
] as const;

const mq = (v: number) => <span className={v > 0 ? 'font-semibold text-red-600' : 'text-gray-400'}>{v > 0 ? fmtNumber(v) : '—'}</span>;
// Sur-livré : anomalie de sens inverse (bleu, jamais rouge) - le volume n'est pas
// perdu, il manque forcément ailleurs.
const sl = (v: number) => <span className={v > 0 ? 'font-semibold text-blue-600' : 'text-gray-300'}>{v > 0 ? `+${fmtNumber(v)}` : '—'}</span>;
const LIGNE_COLORS: Record<string, string> = { PREVU: 'bg-gray-100 text-gray-600', PARTIEL: 'bg-amber-100 text-amber-700', LIVRE: 'bg-green-100 text-green-700', ANNULE: 'bg-red-100 text-red-700' };

// Drill-down : quels BL ont laissé ce site à découvert.
function SiteDrillModal({ site, bcId, mois, onClose }: { site: ParSite; bcId: string; mois: string; onClose: () => void }) {
  const router = useRouter();
  const { data, isLoading } = useQuery({
    queryKey: ['manquants-site', site.siteId, bcId, mois],
    queryFn: () => api.get(`/rapports/manquants-livraison/site/${site.siteId}`, { params: { bc_id: bcId || undefined, mois: mois || undefined } }).then((r) => r.data.data as { lignes: SiteLigne[] }),
  });
  const lignes = data?.lignes ?? [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div className="w-full max-w-3xl max-h-[90vh] overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-lg font-bold text-gray-800">{site.siteNom}</h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-100"><X size={18} /></button>
        </div>
        <div className="mb-4 flex items-center justify-between">
          <p className="text-xs text-gray-500">{site.region} · livraisons planifiées pour ce site</p>
          <button onClick={() => router.push(`/carburant/depotages?site_id=${site.siteId}`)} className="inline-flex items-center gap-1 text-xs text-blue-600 underline hover:no-underline">
            <Camera size={13} /> Dépotages & photos
          </button>
        </div>
        {isLoading ? (
          <p className="text-sm text-gray-400 py-6">Chargement…</p>
        ) : lignes.length === 0 ? (
          <p className="text-sm text-gray-400 py-6">Aucune ligne de plan pour ce site sur la période.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-gray-500 text-xs border-b">
                <th className="text-left py-2">N° BL</th>
                <th className="text-left">Camion</th>
                <th className="text-left">Chargé le</th>
                <th className="text-right">Prévu</th>
                <th className="text-right">Livré</th>
                <th className="text-right">Manquant</th>
                <th className="text-left">Statut</th>
              </tr>
            </thead>
            <tbody>
              {lignes.map((l) => (
                <tr key={l.ligneId} className="border-b last:border-0 cursor-pointer hover:bg-gray-50" onClick={() => router.push(`/carburant/livraisons/${l.blId}`)}>
                  <td className="py-2 font-medium text-gray-800">{l.numeroBL}</td>
                  <td className="text-gray-600">{l.immatriculation}</td>
                  <td className="text-gray-600">{fmtDate(l.dateChargement)}{l.enRetard && <span className="ml-1 text-red-600">· {l.jours}j</span>}</td>
                  <td className="text-right">{fmtNumber(l.prevu)}</td>
                  <td className="text-right">{l.livre > 0 ? fmtNumber(l.livre) : '—'}</td>
                  <td className="text-right">{mq(l.manquant)}</td>
                  <td><Badge className={LIGNE_COLORS[l.statut] || ''}>{l.statut}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

export default function ManquantsPage() {
  const router = useRouter();
  const [tab, setTab] = useState<'site' | 'camion' | 'mois' | 'bc' | 'chauffeur' | 'vehicule' | 'attente'>('site');
  const [bcId, setBcId] = useState('');
  const [mois, setMois] = useState('');
  const [region, setRegion] = useState('');
  const [enRetardOnly, setEnRetardOnly] = useState(false);
  const [drillSite, setDrillSite] = useState<ParSite | null>(null);

  const { data: bcs = [] } = useQuery({
    queryKey: ['bcs-options'],
    queryFn: () => api.get('/bons-commande', { params: { limit: 100 } }).then((r) => r.data.data as BCOption[]),
  });

  const { data, isLoading } = useQuery({
    queryKey: ['manquants', bcId, mois, region],
    queryFn: () => api.get('/rapports/manquants-livraison', { params: { bc_id: bcId || undefined, mois: mois || undefined, region: region || undefined } }).then((r) => r.data.data as ManquantsData),
  });

  if (isLoading) return <Loading />;
  const t = data?.totaux;
  const params = new URLSearchParams({ ...(bcId ? { bc_id: bcId } : {}), ...(mois ? { mois } : {}), ...(region ? { region } : {}) }).toString();

  // « En retard seulement » : ne s'applique qu'aux niveaux où le retard est défini (site, camion).
  const sites = (data?.parSite ?? []).filter((s) => !enRetardOnly || s.nbEnRetard > 0);
  const camions = (data?.parCamion ?? []).filter((c) => !enRetardOnly || c.enRetard);
  // La région ne s'applique qu'au niveau site (un camion/commande traverse plusieurs régions).
  const regionNationaleNote = region && tab !== 'site';
  const pil = data?.pilotage;
  const nbAttente = (pil?.sansPlan.length ?? 0) + (pil?.brouillonsOublies.length ?? 0);

  const colsSite: Column<ParSite>[] = [
    { key: 'siteCode', header: 'Site', render: (s) => <span className="font-medium text-gray-800">{s.siteNom}</span> },
    { key: 'siteNom', header: 'Nom', render: (s) => <span className="text-gray-600">{s.siteNom}</span> },
    { key: 'region', header: 'Région' },
    { key: 'prevu', header: 'Prévu (L)', align: 'right', render: (s) => fmtNumber(s.prevu) },
    { key: 'livre', header: 'Livré (L)', align: 'right', render: (s) => fmtNumber(s.livre) },
    { key: 'manquant', header: 'Manquant (L)', align: 'right', render: (s) => mq(s.manquant) },
    { key: 'surLivre', header: 'Sur-livré (L)', align: 'right', render: (s) => sl(s.surLivre) },
    { key: 'etat', header: 'État', align: 'center', render: (s) => s.nbCritiques > 0 ? <Badge className="bg-red-600 text-white">Critique</Badge> : s.nbEnRetard > 0 ? <Badge className="bg-amber-100 text-amber-700">En retard</Badge> : <span className="text-gray-300">—</span> },
  ];
  const colsCamion: Column<ParCamion>[] = [
    { key: 'numeroBL', header: 'N° BL', render: (c) => <span className="font-medium text-gray-800">{c.numeroBL}</span> },
    { key: 'bcNumero', header: 'BC' },
    { key: 'immatriculation', header: 'Camion' },
    { key: 'transporteur', header: 'Transporteur', render: (c) => c.transporteur ?? '—' },
    { key: 'charge', header: 'Chargé (L)', align: 'right', render: (c) => fmtNumber(c.charge) },
    { key: 'distribue', header: 'Distribué (L)', align: 'right', render: (c) => fmtNumber(c.distribue) },
    { key: 'manquant', header: 'Manquant (L)', align: 'right', render: (c) => mq(c.manquant) },
    { key: 'surLivre', header: 'Sur-livré (L)', align: 'right', render: (c) => sl(c.surLivre) },
    // Un camion CLÔTURÉ a son reste ventilé : il ne se relance plus, il se lit.
    { key: 'etat', header: 'État', align: 'center', render: (c) => c.clos ? <Badge className="bg-green-100 text-green-700">Soldé</Badge> : c.critique ? <Badge className="bg-red-600 text-white">Critique</Badge> : c.enRetard ? <Badge className="bg-amber-100 text-amber-700">En retard</Badge> : <span className="text-gray-300">{c.jours} j</span> },
  ];
  const colsMois: Column<ParMois>[] = [
    { key: 'bcNumero', header: 'BC' },
    { key: 'mois', header: 'Mois', render: (m) => `${MOIS[m.mois]} ${m.annee}` },
    { key: 'prevu', header: 'Prévu (L)', align: 'right', render: (m) => fmtNumber(m.prevu) },
    { key: 'charge', header: 'Chargé (L)', align: 'right', render: (m) => fmtNumber(m.charge) },
    { key: 'livre', header: 'Livré (L)', align: 'right', render: (m) => fmtNumber(m.livre) },
    { key: 'manquantCharge', header: 'Manq. chargé', align: 'right', render: (m) => mq(m.manquantCharge) },
    { key: 'manquantLivre', header: 'Manq. livré', align: 'right', render: (m) => mq(m.manquantLivre) },
    { key: 'surCharge', header: 'Sur-chargé', align: 'right', render: (m) => sl(m.surCharge) },
  ];
  // Le TAUX distingue un chauffeur qui roule beaucoup d'un chauffeur qui perd
  // beaucoup : sans lui, le classement ne mesure que le volume transporté.
  const colsAxe = (nomColonne: string): Column<AxeTransport>[] => [
    { key: 'libelle', header: nomColonne, render: (a) => <span className="font-medium text-gray-800">{a.libelle}</span> },
    { key: 'charge', header: 'Chargé (L)', align: 'right', render: (a) => fmtNumber(a.charge) },
    { key: 'distribue', header: 'Distribué (L)', align: 'right', render: (a) => fmtNumber(a.distribue) },
    { key: 'manquant', header: 'Manquant (L)', align: 'right', render: (a) => mq(a.manquant) },
    { key: 'taux', header: 'Taux', align: 'right', render: (a) => (
      <span className={a.tauxManquantPct >= 2 ? 'font-semibold text-red-600' : a.tauxManquantPct > 0 ? 'text-amber-700' : 'text-gray-400'}>
        {a.tauxManquantPct > 0 ? `${a.tauxManquantPct.toLocaleString('fr-FR')} %` : '—'}
      </span>
    ) },
    { key: 'nbBl', header: 'Chargements', align: 'right', render: (a) => `${a.nbBlEcart} / ${a.nbBl}` },
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
        actions={<ExportButtons base="/rapports/manquants-livraison/export" name="manquants-livraison" query={params || undefined} />}
      />

      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-5">
        <StatCard title="Manquant total (sites)" value={`${fmtNumber(t?.manquantSitesLitres ?? 0)} L`} icon={AlertTriangle} color="bg-[#C0392B]" />
        <StatCard title="Sites manquants" value={String(t?.nbSitesManquants ?? 0)} icon={MapPin} color="bg-[#1B3F6B]" />
        <StatCard title="Camions avec écart" value={String(t?.nbCamionsEcart ?? 0)} icon={Truck} color="bg-[#2471A3]" />
        <StatCard title="Critiques (≥ seuil)" value={`${(t?.nbLignesCritiques ?? 0)} sites · ${(t?.nbCamionsCritiques ?? 0)} camions`} icon={AlertTriangle} color="bg-[#C0392B]" />
        <StatCard title="À traiter" value={`${nbAttente}`} icon={ClipboardList} color="bg-[#B7950B]" />
      </div>

      {/* Filtres */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="w-56"><SearchSelect value={bcId} onChange={setBcId} placeholder="Rechercher un BC…" emptyLabel="Tous les bons de commande" options={bcs.map((b) => ({ value: b.id, label: b.numero }))} /></div>
        <div className="w-40"><Select value={mois} onChange={(e) => setMois(e.target.value)} placeholder="Tous les mois" options={MOIS.slice(1).map((m, i) => ({ value: String(i + 1), label: m }))} /></div>
        <div className="w-48"><Select value={region} onChange={(e) => setRegion(e.target.value)} placeholder="Toutes régions (sites)" options={regionOptions} /></div>
        <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
          <input type="checkbox" checked={enRetardOnly} onChange={(e) => setEnRetardOnly(e.target.checked)} className="h-4 w-4 rounded border-gray-300" />
          En retard seulement
        </label>
      </div>

      {regionNationaleNote && (
        <div className="mb-3 rounded-lg bg-blue-50 border border-blue-200 px-3 py-2 text-xs text-blue-700">
          Vue nationale - le filtre région ne s’applique qu’à l’onglet « Par site » (un camion ou une commande traverse plusieurs régions).
        </div>
      )}

      {/* Onglets */}
      <div className="flex gap-1 border-b border-gray-200 mb-4">
        {TABS.map((tb) => (
          <button key={tb.key} onClick={() => setTab(tb.key)}
            className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 -mb-px ${tab === tb.key ? 'border-[#1B3F6B] text-[#1B3F6B]' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
            <tb.icon size={15} /> {tb.label}
          </button>
        ))}
      </div>

      {tab === 'site' && (sites.length ? <DataTable columns={colsSite} data={sites} rowKey={(s) => s.siteId} rowClassName={(s) => s.nbCritiques > 0 ? 'bg-red-50' : undefined} onRowClick={(s) => setDrillSite(s)} /> : <EmptyState title="Aucun manquant par site" />)}
      {tab === 'camion' && (camions.length ? <DataTable columns={colsCamion} data={camions} rowKey={(c) => c.blId} rowClassName={(c) => c.critique ? 'bg-red-50' : undefined} onRowClick={(c) => router.push(`/carburant/livraisons/${c.blId}`)} /> : <EmptyState title="Aucun écart par camion" />)}
      {tab === 'mois' && (data?.parMois.length ? <DataTable columns={colsMois} data={data.parMois} /> : <EmptyState title="Aucune donnée mensuelle" />)}
      {tab === 'bc' && (data?.parBc.length ? <DataTable columns={colsBc} data={data.parBc} onRowClick={(b) => router.push(`/carburant/commandes/${b.bcId}`)} /> : <EmptyState title="Aucune donnée par bon de commande" />)}

      {tab === 'chauffeur' && (data?.parChauffeur.length
        ? <DataTable columns={colsAxe('Chauffeur')} data={data.parChauffeur} rowKey={(a) => a.id} />
        : <EmptyState title="Aucun chauffeur déclaré sur la période" hint="Le chauffeur est déclaré à la création du bon de livraison." />)}
      {tab === 'vehicule' && (data?.parVehicule.length
        ? <DataTable columns={colsAxe('Camion')} data={data.parVehicule} rowKey={(a) => a.id} />
        : <EmptyState title="Aucun véhicule identifié sur la période" />)}

      {tab === 'attente' && (
        nbAttente === 0 ? (
          <EmptyState title="Rien en attente" hint={`Aucun chargement sans plan ni brouillon oublié depuis plus de ${pil?.seuilJours ?? 2} jours.`} />
        ) : (
          <div className="space-y-6">
            {/* Un BL parti du dépôt sans plan n'apparaît dans AUCUN manquant :
                c'est le seul écran où il est visible. */}
            <ListeAttente
              titre="Chargés sans plan de livraison"
              aide="Le camion est parti mais aucun site ne lui est affecté - ces volumes n'apparaissent dans aucun manquant."
              lignes={pil?.sansPlan ?? []}
              onOuvrir={(id) => router.push(`/carburant/livraisons/${id}`)}
            />
            <ListeAttente
              titre="Brouillons oubliés"
              aide="Bons de livraison jamais finalisés. À compléter ou à supprimer."
              lignes={pil?.brouillonsOublies ?? []}
              onOuvrir={(id) => router.push(`/carburant/livraisons/${id}`)}
            />
          </div>
        )
      )}

      {drillSite && <SiteDrillModal site={drillSite} bcId={bcId} mois={mois} onClose={() => setDrillSite(null)} />}
    </div>
  );
}

function ListeAttente({ titre, aide, lignes, onOuvrir }: { titre: string; aide: string; lignes: BlEnAttente[]; onOuvrir: (id: string) => void }) {
  if (!lignes.length) return null;
  return (
    <section>
      <h3 className="text-sm font-semibold text-gray-800">{titre} <span className="text-gray-400">({lignes.length})</span></h3>
      <p className="mb-2 text-xs text-gray-500">{aide}</p>
      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-gray-50 text-xs text-gray-500">
              <th className="px-3 py-2 text-left">N° BL</th>
              <th className="text-left">BC</th>
              <th className="text-left">Camion</th>
              <th className="text-left">Transporteur</th>
              <th className="text-right">Chargé (L)</th>
              <th className="px-3 text-right">Ancienneté</th>
            </tr>
          </thead>
          <tbody>
            {lignes.map((b) => (
              <tr key={b.id} className="cursor-pointer border-b last:border-0 hover:bg-gray-50" onClick={() => onOuvrir(b.id)}>
                <td className="px-3 py-2 font-medium text-gray-800">{b.numeroBL}</td>
                <td className="text-gray-600">{b.bcNumero ?? '—'}</td>
                <td className="text-gray-600">{b.immatriculation}</td>
                <td className="text-gray-600">{b.transporteur ?? '—'}</td>
                <td className="text-right">{fmtNumber(b.volumeChargeLitres)}</td>
                <td className="px-3 text-right font-semibold text-amber-700">{b.jours} j</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
