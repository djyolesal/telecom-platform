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
  total: number;
  conformes: number;
  taux: number | null;
}

interface Ligne {
  prestataireId: string;
  prestataireNom: string;
  total: number;
  conformes: number;
  nonConformes: number;
  // null = rien de clôturé sur la période : conformité indéfinie, pas 0 %.
  tauxConformite: number | null;
  // Clôtures contestées par un manager : non conformes quel que soit leur contenu.
  invalidees: number;
  // Parc = sites actifs des lots passifs du prestataire (null : non titulaire).
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
      {evolution.map((e) => e.total === 0 ? (
        <div key={e.mois} className="w-2 h-[3px] rounded-sm bg-gray-200" title={`${e.label} : aucune clôturée`} />
      ) : (
        <div
          key={e.mois}
          className={`w-2 rounded-t ${e.taux! >= 90 ? 'bg-green-500' : e.taux! >= 70 ? 'bg-orange-400' : 'bg-red-500'}`}
          style={{ height: `${Math.max(18, e.taux!)}%` }}
          title={`${e.label} : ${e.taux}% (${e.conformes}/${e.total} avec relevés)`}
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
    { key: 'total', header: 'Passives clôturées', align: 'center' },
    { key: 'conformes', header: 'Avec relevés', align: 'center', render: (l) => <span className="text-green-600">{l.conformes}</span> },
    { key: 'nonConformes', header: 'Sans relevés', align: 'center', render: (l) => <span className={l.nonConformes > 0 ? 'text-red-600' : 'text-gray-400'}>{l.nonConformes}</span> },
    {
      key: 'invalidees', header: 'Invalidées', align: 'center',
      render: (l) => l.invalidees > 0
        ? <span className="font-semibold text-red-600" title="Clôtures contestées par un manager - non conformes quel que soit leur contenu.">{l.invalidees}</span>
        : <span className="text-gray-400">0</span>,
    },
    {
      key: 'parc', header: 'Parc couvert', render: (l) => l.parcSites == null ? (
        <span className="text-gray-400" title="Prestataire sans lot passif attribué.">—</span>
      ) : (
        <span title={`${l.sitesCouverts} site(s) avec au moins une passive clôturée, sur ${l.parcSites} site(s) actifs de ses lots.`}>
          <b className={l.couverturePct != null && l.couverturePct >= 70 ? 'text-gray-800' : 'text-red-600'}>{l.sitesCouverts}</b>
          <span className="text-gray-500">/{l.parcSites}</span>
          {l.couverturePct != null && <span className="ml-1.5 text-xs text-gray-500">({l.couverturePct}%)</span>}
        </span>
      ),
    },
    { key: 'evolution', header: 'Évolution (6 mois)', render: (l) => <Sparkline evolution={l.evolution} /> },
    {
      key: 'taux', header: 'Conformité', render: (l) => l.tauxConformite == null ? (
        <span className="text-sm text-amber-600" title="Aucune maintenance passive clôturée sur le mois - conformité non mesurable.">aucune clôturée</span>
      ) : (
        <div className="flex items-center gap-2">
          <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden min-w-16">
            <div className={`h-full ${l.tauxConformite >= 90 ? 'bg-green-500' : l.tauxConformite >= 70 ? 'bg-orange-400' : 'bg-red-500'}`} style={{ width: `${l.tauxConformite}%` }} />
          </div>
          <span className={`text-sm font-semibold w-10 text-right ${tauxColor(l.tauxConformite)}`}>{l.tauxConformite}%</span>
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Conformité maintenances passives"
        subtitle="Maintenances passives clôturées avec relevés énergie, par prestataire"
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
            <StatCard title="Passives clôturées" value={t.total ?? 0} icon={ClipboardCheck} color="bg-[#1B3F6B]" />
            <StatCard title="Conformes" value={t.conformes ?? 0} subtitle="avec relevés" icon={CheckCircle2} color="bg-[#0E7C6B]" />
            <StatCard title="Non conformes" value={t.nonConformes ?? 0} subtitle="sans relevés" icon={XCircle} color={t.nonConformes > 0 ? 'bg-red-500' : 'bg-gray-400'} />
            <StatCard title="Taux global" value={`${t.tauxConformite ?? 0}%`} icon={ClipboardCheck} color="bg-[#2471A3]" />
            <StatCard title="Couverture parc" value={t.couverturePct != null ? `${t.couverturePct}%` : '—'}
              subtitle={t.parcSites ? `${t.sitesCouverts}/${t.parcSites} sites visités` : 'aucun lot attribué'}
              icon={ClipboardCheck} color={t.couverturePct != null && t.couverturePct < 70 ? 'bg-red-500' : 'bg-[#7D3C98]'} />
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
