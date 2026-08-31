'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ShieldCheck, ShieldAlert, CalendarRange, WifiOff } from 'lucide-react';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/shared/PageHeader';
import { ExportButtons } from '@/components/shared/ExportButtons';
import { DataTable, Column } from '@/components/shared/DataTable';
import { Loading, ErrorState, EmptyState } from '@/components/shared/states';
import { Select } from '@/components/shared/Form';
import { StatCard } from '@/components/shared/StatCard';

interface LigneArcep {
  siteId: string; code: string; nom: string; region: string;
  dr1: number; dr1Conforme: boolean;
  joursDepassement: number; dr2Conforme: boolean;
  pireJour: string | null; pireJourMinutes: number; totalMinutes: number;
  conforme: boolean;
}
interface DataArcep {
  mois: string; moisEnCours: boolean; du: string; au: string;
  seuils: { dr1Max: number; dr2MaxMinutesParJour: number };
  sitesAnalyses: number; nonConformesDr1: number; nonConformesDr2: number; nonConformes: number;
  lignes: LigneArcep[];
}

const fmtMin = (m: number) => (m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}`);

/**
 * Conformité réglementaire ARCEP — arrêté n°005/MENTD/CAB du 12/08/2022 :
 * DR1 (≤ 2 indisponibilités ≥ 1 h par station sur 30 jours) et DR2 (≤ 3 h
 * d'indisponibilité par jour et par station). Anticipe les audits du
 * régulateur : mêmes règles officielles que le rapport de disponibilité.
 */
// Douze derniers mois calendaires (le seuil DR1 est « par mois »).
const MOIS_OPTIONS = (() => {
  const out: { value: string; label: string }[] = [];
  const now = new Date();
  for (let i = 0; i < 12; i++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const value = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    const label = d.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' });
    out.push({ value, label: i === 0 ? `${label} (en cours)` : label });
  }
  return out;
})();

export default function ConformiteArcepPage() {
  const [mois, setMois] = useState(MOIS_OPTIONS[0].value);
  const [seulNonConformes, setSeulNonConformes] = useState(false);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['conformite-arcep', mois],
    queryFn: () => api.get('/rapports/conformite-arcep', { params: { mois } }).then((r) => r.data.data as DataArcep),
  });

  if (isLoading) return <Loading />;
  if (isError || !data) return <ErrorState />;

  const lignes = seulNonConformes ? data.lignes.filter((l) => !l.conforme) : data.lignes;

  const columns: Column<LigneArcep>[] = [
    { key: 'nom', header: 'Site', render: (l) => <span className="font-medium text-gray-800">{l.nom}</span> },
    { key: 'region', header: 'Région' },
    {
      key: 'dr1', header: `DR1 (seuil ≤ ${data.seuils.dr1Max})`, align: 'center',
      render: (l) => (
        <span className={`rounded px-1.5 py-0.5 text-xs font-semibold ${l.dr1Conforme ? (l.dr1 ? 'bg-amber-50 text-amber-700' : 'bg-green-50 text-green-700') : 'bg-red-100 text-red-700'}`}>
          {l.dr1} épisode{l.dr1 > 1 ? 's' : ''} ≥ 1 h
        </span>
      ),
    },
    {
      key: 'joursDepassement', header: 'DR2 (jours > 3 h)', align: 'center',
      render: (l) => (
        <span className={`rounded px-1.5 py-0.5 text-xs font-semibold ${l.dr2Conforme ? 'bg-green-50 text-green-700' : 'bg-red-100 text-red-700'}`}>
          {l.joursDepassement} jour{l.joursDepassement > 1 ? 's' : ''}
        </span>
      ),
    },
    {
      key: 'pireJourMinutes', header: 'Pire jour', align: 'right',
      render: (l) => (l.pireJour ? <span className="text-gray-700">{fmtMin(l.pireJourMinutes)} <span className="text-xs text-gray-400">({l.pireJour})</span></span> : '—'),
    },
    { key: 'totalMinutes', header: 'Indispo. totale', align: 'right', render: (l) => (l.totalMinutes ? fmtMin(l.totalMinutes) : '—') },
    {
      key: 'conforme', header: 'Verdict', align: 'center',
      render: (l) => l.conforme
        ? <span className="inline-flex items-center gap-1 rounded-full bg-green-50 px-2 py-0.5 text-xs font-semibold text-green-700"><ShieldCheck size={12} /> Conforme</span>
        : <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs font-bold text-red-700"><ShieldAlert size={12} /> Non conforme</span>,
    },
  ];

  return (
    <div>
      <PageHeader
        title="Conformité ARCEP (DR1 / DR2)"
        subtitle={`Arrêté n°005/MENTD/CAB du 12/08/2022 · ${MOIS_OPTIONS.find((o) => o.value === data.mois)?.label ?? data.mois} · détections automatiques comptées une fois prises en charge`}
        backHref="/rapports"
        actions={<ExportButtons base="/rapports/conformite-arcep/export" name="conformite-arcep" query={`mois=${mois}`} />}
      />

      <div className="mb-4 grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard title="Sites analysés" value={String(data.sitesAnalyses)} subtitle="stations de base actives" icon={WifiOff} color="bg-[#1B3F6B]" />
        <StatCard title="Hors seuil DR1" value={String(data.nonConformesDr1)} subtitle={`> ${data.seuils.dr1Max} indisponibilités ≥ 1 h dans le mois`} icon={ShieldAlert} color={data.nonConformesDr1 ? 'bg-[#B23124]' : 'bg-[#0E7C6B]'} />
        <StatCard title="Hors seuil DR2" value={String(data.nonConformesDr2)} subtitle="au moins 1 jour > 3 h d'indispo." icon={ShieldAlert} color={data.nonConformesDr2 ? 'bg-[#B23124]' : 'bg-[#0E7C6B]'} />
        <StatCard title="Non conformes" value={String(data.nonConformes)} subtitle="exposés en cas d'audit" icon={CalendarRange} color={data.nonConformes ? 'bg-[#B26A00]' : 'bg-[#0E7C6B]'} />
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-3">
        <div className="w-56">
          <Select value={mois} onChange={(e) => setMois(e.target.value)} options={MOIS_OPTIONS} />
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-600">
          <input type="checkbox" checked={seulNonConformes} onChange={(e) => setSeulNonConformes(e.target.checked)} />
          Non conformes uniquement
        </label>
      </div>

      {lignes.length === 0 ? (
        <EmptyState title={seulNonConformes ? 'Aucun site non conforme 🎉' : 'Aucun site'} />
      ) : (
        <DataTable columns={columns} data={lignes} />
      )}

      <p className="mt-4 max-w-3xl text-xs text-gray-400">
        DR1 : nombre de fois qu&apos;une même station est restée indisponible au moins une heure <b>au cours du mois</b> (seuil ≤ 2 par mois).
        DR2 : indisponibilité par jour calendaire d&apos;une même station (seuil ≤ 3 h). Station indisponible = site entièrement
        hors service (y compris entraîné par son site amont). Une même panne fusionnée en un seul épisode.
      </p>
    </div>
  );
}
