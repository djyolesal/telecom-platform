'use client';

import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Columns3 } from 'lucide-react';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/shared/PageHeader';
import { Loading, ErrorState } from '@/components/shared/states';
import { Button } from '@/components/shared/Button';
import { COLONNES_OPTIONNELLES, TableOptionnelle } from '@/lib/optionalColumns';

const TABLES = Object.keys(COLONNES_OPTIONNELLES) as TableOptionnelle[];

/**
 * L'administrateur choisit, tableau par tableau, quelles colonnes OPTIONNELLES
 * sont proposées aux utilisateurs dans le sélecteur « Colonnes ». Stocké dans
 * SystemSettings (web.colonnesOptionnelles.<table>) et servi via /config —
 * effet immédiat, sans redéploiement.
 */
export default function ColonnesTableauxPage() {
  const queryClient = useQueryClient();
  const [actives, setActives] = useState<Record<TableOptionnelle, Set<string>>>({
    sites: new Set(), maintenances: new Set(), depotages: new Set(),
  });
  const [savedOk, setSavedOk] = useState(false);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['app-config'],
    queryFn: () => api.get('/config').then((r) => r.data.data as {
      colonnesOptionnelles?: Partial<Record<TableOptionnelle, string[] | null>> | null;
      colonnesMasquees?: Partial<Record<TableOptionnelle, string[] | null>> | null;
    }),
  });

  // Nouveau mode : liste NOIRE (colonnes masquées) — une colonne ajoutée au
  // catalogue plus tard est cochée d'office. Repli : ancienne liste blanche
  // (null = toutes) tant que rien n'a été ré-enregistré ici.
  useEffect(() => {
    if (data === undefined) return;
    const next = {} as Record<TableOptionnelle, Set<string>>;
    for (const t of TABLES) {
      const catalogue = COLONNES_OPTIONNELLES[t].colonnes.map((c) => c.key);
      const masquees = data.colonnesMasquees?.[t];
      if (Array.isArray(masquees)) {
        next[t] = new Set(catalogue.filter((k) => !masquees.includes(k)));
      } else {
        const autorisees = data.colonnesOptionnelles?.[t];
        next[t] = new Set(autorisees ?? catalogue);
      }
    }
    setActives(next);
  }, [data]);

  const save = useMutation({
    mutationFn: () =>
      api.put('/admin/settings', TABLES.map((t) => ({
        // Liste NOIRE : on enregistre ce qui est DÉCOCHÉ. L'ancienne liste
        // blanche figeait le catalogue — toute colonne ajoutée ensuite
        // disparaissait de tous les sélecteurs sans trace.
        key: `web.colonnesMasquees.${t}`,
        value: COLONNES_OPTIONNELLES[t].colonnes.filter((c) => !actives[t].has(c.key)).map((c) => c.key),
        description: `Colonnes optionnelles masquées - ${COLONNES_OPTIONNELLES[t].titre}`,
      }))),
    onSuccess: () => {
      setSavedOk(true);
      queryClient.invalidateQueries({ queryKey: ['app-config'] });
    },
  });

  if (isLoading) return <Loading />;
  if (isError) return <ErrorState message="Configuration indisponible" />;

  const toggle = (table: TableOptionnelle, key: string) => {
    setActives((prev) => {
      const next = new Set(prev[table]);
      if (next.has(key)) next.delete(key); else next.add(key);
      return { ...prev, [table]: next };
    });
    setSavedOk(false);
  };

  return (
    <div>
      <PageHeader
        title="Colonnes des tableaux"
        subtitle="Colonnes optionnelles proposées aux utilisateurs, tableau par tableau"
        backHref="/administration"
      />

      <div className="grid max-w-6xl grid-cols-1 gap-5 lg:grid-cols-3">
        {TABLES.map((table) => {
          const def = COLONNES_OPTIONNELLES[table];
          return (
            <div key={table} className="rounded-xl border border-gray-100 bg-white">
              <div className="flex items-center gap-2 border-b border-gray-100 px-4 py-3">
                <Columns3 size={15} className="text-[#1B3F6B]" />
                <span className="text-sm font-semibold text-gray-800">{def.titre}</span>
                <span className="ml-auto text-xs text-gray-400">{actives[table].size}/{def.colonnes.length}</span>
                <button
                  type="button"
                  onClick={() => {
                    const toutes = actives[table].size === def.colonnes.length;
                    setActives((prev) => ({ ...prev, [table]: new Set(toutes ? [] : def.colonnes.map((c) => c.key)) }));
                    setSavedOk(false);
                  }}
                  className="text-xs font-medium text-[#2471A3] hover:underline"
                >
                  {actives[table].size === def.colonnes.length ? 'Tout décocher' : 'Tout cocher'}
                </button>
              </div>
              <div className="divide-y divide-gray-50">
                {def.colonnes.map((c) => (
                  <label key={c.key} className="flex cursor-pointer items-start gap-3 px-4 py-2.5 hover:bg-gray-50/60">
                    <input
                      type="checkbox"
                      checked={actives[table].has(c.key)}
                      onChange={() => toggle(table, c.key)}
                      className="mt-0.5 h-4 w-4 rounded border-gray-300 text-[#0E7C6B] focus:ring-[#0E7C6B]"
                    />
                    <span>
                      <span className="block text-sm font-medium text-gray-800">{c.header}</span>
                      <span className="block text-xs text-gray-500">{c.description}</span>
                    </span>
                  </label>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-5 flex max-w-6xl items-center gap-3">
        <Button onClick={() => save.mutate()} disabled={save.isPending}>
          {save.isPending ? 'Enregistrement…' : 'Enregistrer'}
        </Button>
        {savedOk && (
          <span className="inline-flex items-center gap-1.5 text-sm text-emerald-600">
            <CheckCircle2 size={16} /> Enregistré - effet immédiat pour tous les utilisateurs
          </span>
        )}
        {save.isError && <span className="text-sm text-red-600">Échec de l’enregistrement</span>}
      </div>

      <p className="mt-4 max-w-3xl text-xs text-gray-400">
        Les colonnes cochées apparaissent dans le menu « Colonnes » du tableau concerné, masquées par défaut :
        chaque utilisateur active celles qu'il veut, mémorisées sur son navigateur. Décocher une colonne ici la
        retire du menu pour tout le monde.
      </p>
    </div>
  );
}
