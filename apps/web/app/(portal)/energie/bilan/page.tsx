'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { Zap, Gauge, HelpCircle, Banknote, FileWarning } from 'lucide-react';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/shared/PageHeader';
import { StatCard } from '@/components/shared/StatCard';
import { ExportButtons } from '@/components/shared/ExportButtons';
import { DataTable, Column } from '@/components/shared/DataTable';
import { Loading, EmptyState } from '@/components/shared/states';
import { Badge } from '@/components/shared/Badge';
import { Input, Select } from '@/components/shared/Form';
import { regionOptions } from '@/lib/constants';
import { fmtNumber, fmtFCFA } from '@/lib/utils';

const MOIS_COURT = ['', 'Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Juin', 'Juil', 'Août', 'Sep', 'Oct', 'Nov', 'Déc'];

interface LigneSite {
  siteId: string; code: string; nom: string; region: string;
  indexDebut: number | null; indexFin: number | null;
  consoKwh: number | null; source: 'index' | 'declare' | null;
  coutFCFA: number | null; nbReleves: number;
  mesure: boolean; motif: string | null;
}
interface Bilan {
  periode: { debut: string; fin: string; jours: number };
  prixKwh: number | null;
  totaux: {
    nbSites: number; nbSitesMesures: number; nbSitesDeclares: number;
    consoKwh: number; consoKwhMesuree: number; coutFCFA: number; consoJourMoyenneKwh: number;
  };
  lignes: LigneSite[];
  courbe: { annee: number; mois: number; consoKwh: number | null; declareKwh: number; coutFCFA: number; nbSitesMesures: number; nbSites: number }[];
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

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
 * Bilan énergie CEET sur période libre — le pendant du bilan carburant.
 * L'INDEX COMPTEUR joue le rôle de la jauge : conso = index fin − index début,
 * mesurable seulement si les deux bornes ont un index ; à défaut, repli sur la
 * somme des consommations DÉCLARÉES, badgée comme telle.
 */
export default function BilanEnergiePage() {
  const p = useMemo(presets, []);
  const [debut, setDebut] = useState(p['Ce mois'].debut);
  const [fin, setFin] = useState(p['Ce mois'].fin);
  const [region, setRegion] = useState('');
  const [nonMesuresSeuls, setNonMesuresSeuls] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['bilan-energie', debut, fin, region],
    queryFn: () => api.get('/rapports/bilan-energie', { params: { debut, fin, region: region || undefined } })
      .then((r) => r.data.data as Bilan),
    enabled: !!debut && !!fin,
  });

  const t = data?.totaux;
  const lignes = (data?.lignes ?? []).filter((l) => !nonMesuresSeuls || !l.mesure);
  const query = new URLSearchParams({ debut, fin, ...(region ? { region } : {}) }).toString();

  const cols: Column<LigneSite>[] = [
    { key: 'code', header: 'Site', render: (l) => <span className="font-medium text-gray-800">{l.nom}</span> },
    { key: 'region', header: 'Région' },
    { key: 'indexDebut', header: 'Index début', align: 'right', render: (l) => l.indexDebut != null ? fmtNumber(l.indexDebut) : <span className="text-gray-300">—</span> },
    { key: 'indexFin', header: 'Index fin', align: 'right', render: (l) => l.indexFin != null ? fmtNumber(l.indexFin) : <span className="text-gray-300">—</span> },
    {
      key: 'conso', header: 'Conso (kWh)', align: 'right',
      render: (l) => l.consoKwh != null
        ? <span className="font-semibold text-gray-800">{fmtNumber(l.consoKwh)}</span>
        : <span className="inline-flex items-center gap-1 text-xs text-gray-400" title={l.motif ?? ''}><HelpCircle size={12} /> aucune donnée</span>,
    },
    {
      key: 'source', header: 'Source', align: 'center',
      render: (l) => l.source == null ? <span className="text-gray-300">—</span>
        : l.source === 'index'
          ? <Badge className="bg-green-100 text-green-700"><span title="Différence des index compteur aux deux bornes">Index</span></Badge>
          : <Badge className="bg-amber-100 text-amber-700"><span title={l.motif ?? 'Somme des consommations déclarées sur les relevés'}>Déclarée</span></Badge>,
    },
    { key: 'cout', header: 'Coût (FCFA)', align: 'right', render: (l) => l.coutFCFA != null ? fmtFCFA(l.coutFCFA) : <span className="text-gray-300">—</span> },
    { key: 'nbReleves', header: 'Relevés', align: 'right', render: (l) => l.nbReleves || <span className="text-gray-300">0</span> },
  ];

  const chartData = (data?.courbe ?? []).map((c) => ({
    label: `${MOIS_COURT[c.mois]} ${String(c.annee).slice(2)}`,
    'Déclarée (kWh)': c.declareKwh,
    'Index (kWh)': c.consoKwh,
    mesures: `${c.nbSitesMesures}/${c.nbSites}`,
  }));

  return (
    <div>
      <PageHeader
        title="Bilan énergie CEET"
        subtitle="Période libre — index aux deux bornes, consommation et coût, courbe 12 mois"
        backHref="/energie"
        actions={<ExportButtons base="/rapports/bilan-energie/export" name="bilan-energie" query={query} />}
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
        <div className="mb-3 grid grid-cols-2 gap-4 md:grid-cols-4">
          <StatCard title="Consommation" value={`${fmtNumber(t!.consoKwh)} kWh`}
            subtitle={`≈ ${fmtNumber(t!.consoJourMoyenneKwh)} kWh/jour`} icon={Zap} color="bg-[#1B3F6B]" />
          <StatCard title="Dont mesurée (index)" value={`${fmtNumber(t!.consoKwhMesuree)} kWh`} icon={Gauge} color="bg-[#0E7C6B]" />
          <StatCard title="Coût estimé" value={fmtFCFA(t!.coutFCFA)}
            subtitle={data.prixKwh != null ? `tarif ${data.prixKwh} FCFA/kWh` : 'masqué (compte prestataire)'} icon={Banknote} color="bg-[#B7950B]" />
          <StatCard title="Sites au delta d'index" value={`${t!.nbSitesMesures} / ${t!.nbSites}`}
            subtitle={t!.nbSitesDeclares > 0 ? `${t!.nbSitesDeclares} en déclaré` : 'index aux deux bornes'}
            icon={FileWarning} color={t!.nbSitesMesures < t!.nbSites ? 'bg-[#B7950B]' : 'bg-[#148F77]'} />
        </div>

        <p className="mb-4 text-xs text-gray-500">
          La consommation « Index » est la différence des index compteur aux deux bornes — la mesure de référence.
          « Déclarée » est la somme des consommations saisies sur les relevés : un repli, pas une mesure.
          Un index en recul (compteur remplacé) bascule automatiquement le site en déclaré.
        </p>

        {/* ── Courbe 12 mois ── */}
        <div className="mb-4 rounded-xl border border-gray-100 bg-white p-5">
          <h3 className="mb-1 text-sm font-semibold text-gray-700">Consommation CEET — 12 derniers mois</h3>
          <p className="mb-3 text-xs text-gray-500">
            Barres : consommation déclarée (toujours connue). Ligne : delta d&apos;index des sites mesurables
            (l&apos;infobulle indique combien) — les premiers mois peuvent être partiels.
          </p>
          <ResponsiveContainer width="100%" height={260}>
            <ComposedChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
              <Tooltip formatter={(v, name, ctx) => {
                const mesures = (ctx as { payload?: { mesures?: string } })?.payload?.mesures;
                const kwh = v == null ? 'non mesuré'
                  : `${Number(v).toLocaleString('fr-FR')} kWh${String(name).startsWith('Index') && mesures ? ` (${mesures} sites)` : ''}`;
                return [kwh, String(name)];
              }} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="Déclarée (kWh)" fill="#5D6D7E" radius={[3, 3, 0, 0]} />
              <Line dataKey="Index (kWh)" stroke="#1B3F6B" strokeWidth={2} dot={{ r: 3 }} connectNulls />
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        {/* ── Détail par site ── */}
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-700">Détail par site ({lignes.length})</h3>
          <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={nonMesuresSeuls} onChange={(e) => setNonMesuresSeuls(e.target.checked)} className="h-4 w-4 rounded border-gray-300" />
            Sans delta d&apos;index seulement
            {t!.nbSites - t!.nbSitesMesures > 0 && <Badge className="bg-amber-100 text-amber-700">{t!.nbSites - t!.nbSitesMesures}</Badge>}
          </label>
        </div>
        {lignes.length === 0
          ? <EmptyState title="Aucun site" hint={nonMesuresSeuls ? 'Tous les sites raccordés ont leurs index aux deux bornes 🎉' : undefined} />
          : <DataTable columns={cols} data={lignes} rowKey={(l) => l.siteId} maxHeight="60vh"
              rowClassName={(l) => !l.mesure ? 'bg-gray-50/60' : undefined} />}
      </>)}
    </div>
  );
}
