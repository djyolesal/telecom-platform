'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, XCircle, ClipboardCheck } from 'lucide-react';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/shared/PageHeader';
import { FilterBar } from '@/components/shared/FilterBar';
import { StatCard } from '@/components/shared/StatCard';
import { DataTable, Column } from '@/components/shared/DataTable';
import { ExportButtons } from '@/components/shared/ExportButtons';
import { Loading, EmptyState } from '@/components/shared/states';

interface PointEvolution {
  mois: string;
  label: string;
  dues: number;
  realisees: number;
  taux: number | null;
}

interface Ligne {
  prestataireId: string;
  prestataireNom: string;
  // CONFORMITÉ CONTRACTUELLE : tâches dues du mois (catalogue × sites) vs réalisées.
  dues: number;
  realisees: number;
  tauxContractuel: number | null;
  sitesAvecDu: number;
  sitesConformes: number;
  // Qualité des clôtures du mois (relevés joints, invalidations).
  total: number;
  conformes: number;
  nonConformes: number;
  tauxQualite: number | null;
  invalidees: number;
  parcSites: number | null;
  sitesCouverts: number;
  couverturePct: number | null;
  evolution: PointEvolution[];
}

function tauxColor(t: number) {
  if (t >= 90) return 'text-green-600';
  if (t >= 70) return 'text-orange-500';
  return 'text-red-600';
}

/** Mini-barres mensuelles : hauteur et couleur = taux de conformité du mois. */
function Sparkline({ evolution }: { evolution: PointEvolution[] }) {
  return (
    <div className="flex items-end gap-[3px] h-7">
      {evolution.map((e) => e.dues === 0 ? (
        <div key={e.mois} className="w-2 h-[3px] rounded-sm bg-gray-200" title={`${e.label} : aucune tâche due`} />
      ) : (
        <div
          key={e.mois}
          className={`w-2 rounded-t ${e.taux! >= 90 ? 'bg-green-500' : e.taux! >= 70 ? 'bg-orange-400' : 'bg-red-500'}`}
          style={{ height: `${Math.max(18, e.taux!)}%` }}
          title={`${e.label} : ${e.taux}% (${e.realisees}/${e.dues} du dû réalisé)`}
        />
      ))}
    </div>
  );
}

const MOIS = ['', 'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];

export default function ConformitePage() {
  // Période CALENDAIRE : un mois précis - le pas des obligations contractuelles.
  const maintenant = new Date();
  const [mois, setMois] = useState(String(maintenant.getMonth() + 1));
  const [annee, setAnnee] = useState(String(maintenant.getFullYear()));

  const { data, isLoading } = useQuery({
    queryKey: ['conformite', annee, mois],
    queryFn: () => api.get('/rapports/conformite', { params: { annee, mois } }).then((r) => r.data.data),
  });
  const anneesOptions = [0, 1].map((i) => {
    const a = String(maintenant.getFullYear() - i);
    return { value: a, label: a };
  });

  const t = data?.totaux ?? {};
  const lignes: Ligne[] = data?.parPrestataire ?? [];

  const columns: Column<Ligne>[] = [
    { key: 'prestataireNom', header: 'Prestataire', render: (l) => <span className="font-medium text-gray-800">{l.prestataireNom}</span> },
    {
      key: 'du', header: 'Dû du mois', align: 'center',
      render: (l) => l.dues === 0
        ? <span className="text-gray-400" title="Aucune tâche contractuelle due ce mois sur ses sites.">—</span>
        : <span title={`${l.realisees} tâche(s) réalisée(s) sur ${l.dues} due(s) au contrat ce mois.`}>
            <b className={l.realisees < l.dues ? 'text-red-600' : 'text-gray-800'}>{l.realisees}</b>
            <span className="text-gray-500">/{l.dues}</span>
          </span>,
    },
    {
      key: 'sitesConf', header: 'Sites conformes', align: 'center',
      render: (l) => l.sitesAvecDu === 0
        ? <span className="text-gray-400">—</span>
        : <span title="Sites dont TOUTES les tâches dues du mois sont réalisées.">
            <b className={l.sitesConformes < l.sitesAvecDu ? 'text-red-600' : 'text-gray-800'}>{l.sitesConformes}</b>
            <span className="text-gray-500">/{l.sitesAvecDu}</span>
          </span>,
    },
    { key: 'total', header: 'Clôturées', align: 'center' },
    { key: 'nonConformes', header: 'Sans relevés', align: 'center', render: (l) => <span className={l.nonConformes > 0 ? 'text-red-600' : 'text-gray-400'}>{l.nonConformes}</span> },
    {
      key: 'invalidees', header: 'Invalidées', align: 'center',
      render: (l) => l.invalidees > 0
        ? <span className="font-semibold text-red-600" title="Clôtures contestées par un manager - non conformes quel que soit leur contenu.">{l.invalidees}</span>
        : <span className="text-gray-400">0</span>,
    },
    { key: 'evolution', header: 'Évolution (6 mois)', render: (l) => <Sparkline evolution={l.evolution} /> },
    {
      key: 'taux', header: 'Conformité contractuelle', render: (l) => l.tauxContractuel == null ? (
        <span className="text-sm text-gray-400" title="Aucune tâche contractuelle due ce mois.">aucun dû</span>
      ) : (
        <div className="flex items-center gap-2">
          <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden min-w-16">
            <div className={`h-full ${l.tauxContractuel >= 90 ? 'bg-green-500' : l.tauxContractuel >= 70 ? 'bg-orange-400' : 'bg-red-500'}`} style={{ width: `${l.tauxContractuel}%` }} />
          </div>
          <span className={`text-sm font-semibold w-10 text-right ${tauxColor(l.tauxContractuel)}`}>{l.tauxContractuel}%</span>
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Conformité maintenances passives"
        subtitle="Tâches contractuelles dues par site (catalogue × fréquences) vs réalisées, par prestataire"
        backHref="/rapports"
        actions={
          <ExportButtons base="/rapports/conformite/export"
            name={`Conformité maintenances ${MOIS[Number(mois)] ?? mois} ${annee}`}
            query={`annee=${annee}&mois=${mois}`} />
        }
      />

      <FilterBar
        filters={[
          { key: 'mois', label: 'Mois', sansVide: true, value: mois,
            options: MOIS.slice(1).map((m, i) => ({ value: String(i + 1), label: m })), onChange: setMois },
          { key: 'annee', label: 'Année', sansVide: true, value: annee,
            options: anneesOptions, onChange: setAnnee },
        ]}
      />

      {isLoading ? (
        <Loading />
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
            <StatCard title="Dû contractuel" value={t.dues ?? 0} subtitle="tâches dues ce mois" icon={ClipboardCheck} color="bg-[#1B3F6B]" />
            <StatCard title="Réalisées" value={t.realisees ?? 0} subtitle="du dû du mois" icon={CheckCircle2} color="bg-[#0E7C6B]" />
            <StatCard title="Non réalisées" value={t.manquantes ?? 0} subtitle="à relancer" icon={XCircle} color={(t.manquantes ?? 0) > 0 ? 'bg-red-500' : 'bg-gray-400'} />
            <StatCard title="Conformité contractuelle" value={t.tauxContractuel != null ? `${t.tauxContractuel}%` : '—'} icon={ClipboardCheck} color="bg-[#2471A3]" />
            <StatCard title="Sites conformes" value={t.sitesAvecDu ? `${t.sitesConformes}/${t.sitesAvecDu}` : '—'}
              subtitle="tout leur dû réalisé" icon={ClipboardCheck}
              color={t.sitesAvecDu && t.sitesConformes < t.sitesAvecDu ? 'bg-[#B23124]' : 'bg-[#7D3C98]'} />
          </div>

          {lignes.length === 0 ? (
            <EmptyState title="Aucune maintenance passive clôturée sur ce mois" />
          ) : (
            <DataTable columns={columns} data={lignes} rowKey={(l) => l.prestataireId} />
          )}
        </>
      )}
    </div>
  );
}
