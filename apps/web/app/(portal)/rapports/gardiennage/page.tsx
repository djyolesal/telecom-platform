'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Shield, ShieldAlert, MapPin, HelpCircle } from 'lucide-react';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/shared/PageHeader';
import { FilterBar } from '@/components/shared/FilterBar';
import { StatCard } from '@/components/shared/StatCard';
import { Loading, ErrorState, EmptyState } from '@/components/shared/states';

interface SocieteGardiennage {
  prestataireId: string; nom: string; contactTechnique: string | null;
  nbSites: number; nbSitesNuit: number; interventions: number;
  presents: number; absents: number; nonRenseigne: number;
  // Passages de JOUR sur des sites gardés uniquement la nuit : absence normale,
  // exclue du taux.
  horsPlage: number;
  tauxAbsencePct: number | null;
}
interface Report { periodeJours: number; societes: SocieteGardiennage[]; sitesNonRattaches: number }

/**
 * Contrôle du gardiennage : à chaque clôture d'intervention, le technicien
 * déclare si l'agent de sécurité était présent — taux d'absence par société.
 */
export default function GardiennagePage() {
  const [jours, setJours] = useState('90');
  const { data, isLoading, isError } = useQuery<Report>({
    queryKey: ['rapport-gardiennage', jours],
    queryFn: () => api.get('/rapports/gardiennage', { params: { jours } }).then((r) => r.data.data),
  });

  if (isLoading) return <Loading />;
  if (isError || !data) return <ErrorState message="Rapport gardiennage indisponible" />;

  const totalAbsents = data.societes.reduce((s, x) => s + x.absents, 0);
  const totalSites = data.societes.reduce((s, x) => s + x.nbSites, 0);

  return (
    <div>
      <PageHeader title="Gardiennage" subtitle="Présence des agents de sécurité constatée par les techniciens en intervention" backHref="/rapports" />

      <FilterBar
        filters={[{ key: 'jours', label: 'Période', sansVide: true, value: jours, options: [
          { value: '30', label: '30 jours' }, { value: '90', label: '90 jours' },
          { value: '180', label: '6 mois' }, { value: '365', label: '12 mois' },
        ], onChange: setJours }]}
      />

      <div className="mb-4 grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard title="Sociétés suivies" value={String(data.societes.length)} icon={Shield} color="bg-[#1B3F6B]" />
        <StatCard title="Sites rattachés" value={String(totalSites)} icon={MapPin} color="bg-[#2471A3]" />
        <StatCard title="Absences constatées" value={String(totalAbsents)} icon={ShieldAlert} color="bg-[#DC2626]" />
        <StatCard title="Sites à rapprocher" value={String(data.sitesNonRattaches)} subtitle="gardien déclaré, société non liée" icon={HelpCircle} color="bg-[#F59E0B]" />
      </div>

      {data.societes.length === 0 ? (
        <EmptyState title="Aucune société de gardiennage" hint="Créez-les dans Administration → Prestataires (case « Société de gardiennage ») : les sites seront rapprochés automatiquement par nom." />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-100 bg-white">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-gray-100 text-left text-xs text-gray-500">
              <th className="py-3 pl-5 pr-4 font-medium">Société</th>
              <th className="px-3 py-3 text-right font-medium">Sites gardés</th>
              <th className="px-3 py-3 text-right font-medium">Interventions</th>
              <th className="px-3 py-3 text-right font-medium">Agent présent</th>
              <th className="px-3 py-3 text-right font-medium">Absent</th>
              <th className="px-3 py-3 text-right font-medium">Non renseigné</th>
              <th className="px-3 py-3 text-right font-medium">Hors plage (nuit)</th>
              <th className="px-3 py-3 pr-5 text-right font-medium">Taux d&apos;absence</th>
            </tr></thead>
            <tbody>
              {data.societes.map((s) => (
                <tr key={s.prestataireId} className="border-b border-gray-50 last:border-0">
                  <td className="py-3 pl-5 pr-4">
                    <p className="font-medium text-gray-800">{s.nom}</p>
                    {s.contactTechnique && <p className="text-xs text-gray-400">{s.contactTechnique}</p>}
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums">
                    {s.nbSites}
                    {s.nbSitesNuit > 0 && <span className="ml-1 text-xs text-indigo-500" title="dont postes de nuit uniquement">({s.nbSitesNuit} nuit)</span>}
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums">{s.interventions}</td>
                  <td className="px-3 py-3 text-right tabular-nums text-green-700">{s.presents}</td>
                  <td className={`px-3 py-3 text-right tabular-nums ${s.absents > 0 ? 'font-semibold text-red-600' : 'text-gray-400'}`}>{s.absents}</td>
                  <td className="px-3 py-3 text-right tabular-nums text-gray-400">{s.nonRenseigne}</td>
                  <td className="px-3 py-3 text-right tabular-nums text-indigo-400" title="Passages de jour sur des postes de nuit — absence normale, exclue du taux">{s.horsPlage ?? 0}</td>
                  <td className="px-3 py-3 pr-5 text-right tabular-nums">
                    {s.tauxAbsencePct == null ? <span className="text-gray-300">—</span> : (
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${s.tauxAbsencePct === 0 ? 'bg-green-100 text-green-700' : s.tauxAbsencePct <= 10 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'}`}>
                        {s.tauxAbsencePct} %
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-3 text-xs text-gray-400">
        La déclaration « Agent présent / absent » est faite par le technicien à la clôture de chaque maintenance et incident (application mobile). « Non renseigné » : interventions clôturées avant la mise en place ou depuis une ancienne version de l&apos;application.
        « Hors plage » : passages de jour sur des sites marqués « poste de nuit uniquement » (fiche du site) — l&apos;absence y est normale et n&apos;entre pas dans le taux. La plage de nuit (défaut 18h→6h GMT) se règle dans Administration → Paramètres.
      </p>
    </div>
  );
}
