'use client';

import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Columns3 } from 'lucide-react';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/shared/PageHeader';
import { Loading, ErrorState } from '@/components/shared/states';
import { Button } from '@/components/shared/Button';
import { SITE_COLONNES_OPTIONNELLES } from '@/lib/siteColumns';

/**
 * L'administrateur choisit quelles colonnes OPTIONNELLES de la liste des sites
 * sont proposées aux utilisateurs dans le sélecteur « Colonnes ». La sélection
 * est stockée dans SystemSettings (web.sitesColonnesOptionnelles) et servie via
 * /config — effet immédiat, sans redéploiement.
 */
export default function ColonnesTableauxPage() {
  const queryClient = useQueryClient();
  const [actives, setActives] = useState<Set<string>>(new Set());
  const [savedOk, setSavedOk] = useState(false);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['app-config'],
    queryFn: () => api.get('/config').then((r) => r.data.data as { sitesColonnesOptionnelles?: string[] | null }),
  });

  // null = toutes autorisées (défaut).
  useEffect(() => {
    if (data === undefined) return;
    const autorisees = data.sitesColonnesOptionnelles;
    setActives(new Set(autorisees ?? SITE_COLONNES_OPTIONNELLES.map((c) => c.key)));
  }, [data]);

  const save = useMutation({
    mutationFn: () =>
      api.put('/admin/settings', [{
        key: 'web.sitesColonnesOptionnelles',
        value: SITE_COLONNES_OPTIONNELLES.filter((c) => actives.has(c.key)).map((c) => c.key),
        description: 'Colonnes optionnelles de la liste des sites proposées aux utilisateurs',
      }]),
    onSuccess: () => {
      setSavedOk(true);
      queryClient.invalidateQueries({ queryKey: ['app-config'] });
    },
  });

  if (isLoading) return <Loading />;
  if (isError) return <ErrorState message="Configuration indisponible" />;

  const toggle = (key: string) => {
    const next = new Set(actives);
    if (next.has(key)) next.delete(key); else next.add(key);
    setActives(next); setSavedOk(false);
  };

  return (
    <div>
      <PageHeader
        title="Colonnes des tableaux"
        subtitle="Colonnes optionnelles proposées aux utilisateurs dans la liste des sites"
        backHref="/administration"
      />

      <div className="max-w-2xl rounded-xl border border-gray-100 bg-white">
        <div className="flex items-center gap-2 border-b border-gray-100 px-5 py-3">
          <Columns3 size={16} className="text-[#1B3F6B]" />
          <span className="text-sm font-semibold text-gray-800">Liste des sites</span>
          <span className="ml-auto text-xs text-gray-400">{actives.size}/{SITE_COLONNES_OPTIONNELLES.length} proposées</span>
        </div>
        <div className="divide-y divide-gray-50">
          {SITE_COLONNES_OPTIONNELLES.map((c) => (
            <label key={c.key} className="flex cursor-pointer items-start gap-3 px-5 py-3 hover:bg-gray-50/60">
              <input
                type="checkbox"
                checked={actives.has(c.key)}
                onChange={() => toggle(c.key)}
                className="mt-0.5 h-4 w-4 rounded border-gray-300 text-[#0E7C6B] focus:ring-[#0E7C6B]"
              />
              <span>
                <span className="block text-sm font-medium text-gray-800">{c.header}</span>
                <span className="block text-xs text-gray-500">{c.description}</span>
              </span>
            </label>
          ))}
        </div>
        <div className="flex items-center gap-3 border-t border-gray-100 px-5 py-3">
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending ? 'Enregistrement…' : 'Enregistrer'}
          </Button>
          {savedOk && (
            <span className="inline-flex items-center gap-1.5 text-sm text-emerald-600">
              <CheckCircle2 size={16} /> Enregistré — effet immédiat pour tous les utilisateurs
            </span>
          )}
          {save.isError && <span className="text-sm text-red-600">Échec de l’enregistrement</span>}
        </div>
      </div>

      <p className="mt-4 max-w-2xl text-xs text-gray-400">
        Les colonnes cochées apparaissent dans le menu « Colonnes » de la liste des sites, masquées par défaut :
        chaque utilisateur active celles qu'il veut, et son choix est mémorisé sur son navigateur. Décocher une
        colonne ici la retire pour tout le monde.
      </p>
    </div>
  );
}
