'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { Droplets, Fuel, Gauge, HelpCircle, TrendingDown } from 'lucide-react';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/shared/PageHeader';
import { StatCard } from '@/components/shared/StatCard';
import { ExportButtons } from '@/components/shared/ExportButtons';
import { DataTable, Column } from '@/components/shared/DataTable';
import { Loading, EmptyState } from '@/components/shared/states';
import { Badge } from '@/components/shared/Badge';
import { Input, Select } from '@/components/shared/Form';
import { regionOptions } from '@/lib/constants';
import { fmtNumber } from '@/lib/utils';

const MOIS_COURT = ['', 'Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Juin', 'Juil', 'Août', 'Sep', 'Oct', 'Nov', 'Déc'];

interface LigneSite {
  siteId: string; code: string; nom: string; region: string;
  stockDebut: number | null; stockFin: number | null;
  livre: number; mouvements: number;
  conso: number | null; consoTheorique: number; ecart: number | null;
  mesure: boolean; motifNonMesure: string | null;
}
interface Bilan {
  periode: { debut: string; fin: string; jours: number };
  totaux: {
    nbSites: number; nbSitesMesures: number;
    stockDebutLitres: number; stockFinLitres: number;
    livreLitres: number; mouvementsLitres: number;
    consoLitres: number; consoTheoriqueLitres: number; consoJourMoyenne: number;
  };
  lignes: LigneSite[];
  courbe: { annee: number; mois: number; livre: number; conso: number | null; nbSitesMesures: number; nbSites: number }[];
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Périodes prédéfinies : celles du processus métier (mois, mois dernier, trimestre). */
function presets(): Record<string, { debut: string; fin: string }> {
  const now = new Date();
  const y = now.getFullYear(), m = now.getMonth();
  const trimestre = Math.floor(m / 3);
  return {
    'Ce mois': { debut: iso(new Date(Date.UTC(y, m, 1))), fin: iso(now) },
    'Mois dernier': { debut: iso(new Date(Date.UTC(y, m - 1, 1))), fin: iso(new Date(Date.UTC(y, m, 0))) },
    'Trimestre en cours': { debut: iso(new Date(Date.UTC(y, trimestre * 3, 1))), fin: iso(now) },
    '30 derniers jours': { debut: iso(new Date(now.getTime() - 30 * 86_400_000)), fin: iso(now) },
  };
}

/**
 * Bilan conso & stock sur période libre. La consommation vient de l'équation de
 * conservation (stock début + livré + mouvements − stock fin) : elle n'est
 * affichée que pour les sites dont les DEUX bornes de jauge sont connues - le
 * taux de sites mesurés est donc lui-même un indicateur de qualité de saisie.
 */
export default function BilanCarburantPage() {
  const p = useMemo(presets, []);
  const [debut, setDebut] = useState(p['Ce mois'].debut);
  const [fin, setFin] = useState(p['Ce mois'].fin);
  const [region, setRegion] = useState('');
  const [nonMesuresSeuls, setNonMesuresSeuls] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['bilan-carburant', debut, fin, region],
    queryFn: () => api.get('/rapports/bilan-carburant', { params: { debut, fin, region: region || undefined } })
      .then((r) => r.data.data as Bilan),
    enabled: !!debut && !!fin,
  });

  const t = data?.totaux;
  const deltaStock = t ? t.stockFinLitres - t.stockDebutLitres : 0;
  const lignes = (data?.lignes ?? []).filter((l) => !nonMesuresSeuls || !l.mesure);
  const query = new URLSearchParams({ debut, fin, ...(region ? { region } : {}) }).toString();

  const cols: Column<LigneSite>[] = [
    { key: 'code', header: 'Site', render: (l) => <span className="font-medium text-gray-800">{l.nom}</span> },
    { key: 'region', header: 'Région' },
    { key: 'stockDebut', header: 'Stock début (L)', align: 'right', render: (l) => l.stockDebut != null ? fmtNumber(l.stockDebut) : <span className="text-gray-300">—</span> },
    { key: 'livre', header: 'Livré (L)', align: 'right', render: (l) => l.livre > 0 ? fmtNumber(l.livre) : <span className="text-gray-300">—</span> },
    {
      key: 'mouvements', header: 'Transf./purges (L)', align: 'right',
      render: (l) => l.mouvements === 0 ? <span className="text-gray-300">—</span>
        : <span className={l.mouvements > 0 ? 'text-blue-600' : 'text-amber-700'}>{l.mouvements > 0 ? '+' : ''}{fmtNumber(l.mouvements)}</span>,
    },
    { key: 'stockFin', header: 'Stock fin (L)', align: 'right', render: (l) => l.stockFin != null ? fmtNumber(l.stockFin) : <span className="text-gray-300">—</span> },
    {
      key: 'conso', header: 'Conso (L)', align: 'right',
      render: (l) => l.conso != null
        ? <span className="font-semibold text-gray-800">{fmtNumber(l.conso)}</span>
        : <span className="inline-flex items-center gap-1 text-xs text-gray-400" title={l.motifNonMesure ?? ''}><HelpCircle size={12} /> non mesuré</span>,
    },
    { key: 'theo', header: 'Théorique (L)', align: 'right', render: (l) => <span className="text-gray-500">{fmtNumber(l.consoTheorique)}</span> },
    {
      key: 'ecart', header: 'Écart', align: 'right',
      render: (l) => l.ecart == null ? <span className="text-gray-300">—</span>
        : <span className={l.ecart > 0 ? 'font-semibold text-red-600' : 'text-green-700'}>{l.ecart > 0 ? '+' : ''}{fmtNumber(l.ecart)}</span>,
    },
  ];

  const chartData = (data?.courbe ?? []).map((c) => ({
    label: `${MOIS_COURT[c.mois]} ${String(c.annee).slice(2)}`,
    Livré: c.livre,
    'Consommé (mesuré)': c.conso,
    mesures: `${c.nbSitesMesures}/${c.nbSites}`,
  }));

  return (
    <div>
      <PageHeader
        title="Bilan conso & stock"
        subtitle="Période libre - stock aux deux bornes, consommation par conservation, courbe 12 mois"
        backHref="/carburant/stock"
        actions={<ExportButtons base="/rapports/bilan-carburant/export" name="bilan-carburant" query={query} />}
      />

      {/* ── Période ── */}
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div>
          <label className="mb-1 block text-xs text-gray-500">Du</label>
          <Input type="date" value={debut} max={fin} onChange={(e) => setDebut(e.target.value)} />
        </div>
        <div>
          <label className="mb-1 block text-xs text-gray-500">Au</label>
          <Input type="date" value={fin} min={debut} max={iso(new Date())} onChange={(e) => setFin(e.target.value)} />
        </div>
        <div className="w-48">
          <label className="mb-1 block text-xs text-gray-500">Région</label>
          <Select value={region} onChange={(e) => setRegion(e.target.value)} placeholder="Toutes régions" options={regionOptions} />
        </div>
        <div className="flex flex-wrap gap-1.5 pb-0.5">
          {Object.entries(p).map(([label, v]) => (
            <button key={label} onClick={() => { setDebut(v.debut); setFin(v.fin); }}
              className={`rounded-full border px-3 py-1.5 text-xs font-medium ${debut === v.debut && fin === v.fin ? 'border-[#1B3F6B] bg-[#1B3F6B] text-white' : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'}`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {isLoading || !data ? <Loading /> : (<>
        {/* ── KPIs ── */}
        <div className="mb-3 grid grid-cols-2 gap-4 md:grid-cols-5">
          <StatCard title="Stock début" value={`${fmtNumber(t!.stockDebutLitres)} L`} icon={Fuel} color="bg-[#5D6D7E]" />
          <StatCard title="Livré sur la période" value={`${fmtNumber(t!.livreLitres)} L`} icon={Droplets} color="bg-[#2471A3]" />
          <StatCard title="Consommation" value={`${fmtNumber(t!.consoLitres)} L`}
            subtitle={`≈ ${fmtNumber(t!.consoJourMoyenne)} L/jour`} icon={TrendingDown} color="bg-[#C0392B]" />
          <StatCard title="Stock fin" value={`${fmtNumber(t!.stockFinLitres)} L`}
            subtitle={`${deltaStock >= 0 ? '+' : ''}${fmtNumber(deltaStock)} L sur la période`} icon={Fuel} color="bg-[#0E7C6B]" />
          <StatCard title="Sites mesurés" value={`${t!.nbSitesMesures} / ${t!.nbSites}`}
            subtitle="jauges aux deux bornes" icon={Gauge} color={t!.nbSitesMesures < t!.nbSites ? 'bg-[#B7950B]' : 'bg-[#148F77]'} />
        </div>

        <p className="mb-4 text-xs text-gray-500">
          Stocks et consommation totalisés sur les <b>{t!.nbSitesMesures} sites mesurés</b> (jauge relevée avant chaque borne).
          Le « livré » couvre tous les sites - la logistique est toujours connue. Théorique total : {fmtNumber(t!.consoTheoriqueLitres)} L.
        </p>

        {/* ── Courbe 12 mois ── */}
        <div className="mb-4 rounded-xl border border-gray-100 bg-white p-5">
          <h3 className="mb-1 text-sm font-semibold text-gray-700">Livré et consommé - 12 derniers mois</h3>
          <p className="mb-3 text-xs text-gray-500">
            La consommation mensuelle n&apos;est mesurable que sur les sites jaugés aux deux bornes du mois
            (l&apos;infobulle indique combien) : les premiers mois peuvent être partiels.
          </p>
          <ResponsiveContainer width="100%" height={260}>
            <ComposedChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
              <Tooltip formatter={(v, name, ctx) => {
                const mesures = (ctx as { payload?: { mesures?: string } })?.payload?.mesures;
                const litres = v == null ? 'non mesuré'
                  : `${Number(v).toLocaleString('fr-FR')} L${String(name).startsWith('Consommé') && mesures ? ` (${mesures} sites)` : ''}`;
                return [litres, String(name)];
              }} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="Livré" fill="#2471A3" radius={[3, 3, 0, 0]} />
              <Line dataKey="Consommé (mesuré)" stroke="#C0392B" strokeWidth={2} dot={{ r: 3 }} connectNulls />
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        {/* ── Détail par site ── */}
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-700">Détail par site ({lignes.length})</h3>
          <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={nonMesuresSeuls} onChange={(e) => setNonMesuresSeuls(e.target.checked)} className="h-4 w-4 rounded border-gray-300" />
            Non mesurés seulement
            {t!.nbSites - t!.nbSitesMesures > 0 && <Badge className="bg-amber-100 text-amber-700">{t!.nbSites - t!.nbSitesMesures}</Badge>}
          </label>
        </div>
        {lignes.length === 0
          ? <EmptyState title="Aucun site" hint={nonMesuresSeuls ? 'Tous les sites sont mesurés sur cette période 🎉' : undefined} />
          : <DataTable columns={cols} data={lignes} rowKey={(l) => l.siteId} maxHeight="60vh"
              rowClassName={(l) => !l.mesure ? 'bg-gray-50/60' : (l.ecart ?? 0) > 0 && (l.ecart ?? 0) > l.consoTheorique * 0.25 ? 'bg-red-50/60' : undefined} />}
      </>)}
    </div>
  );
}
