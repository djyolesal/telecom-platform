'use client';

import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Save, RotateCcw, CheckCircle2 } from 'lucide-react';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/shared/PageHeader';
import { Loading } from '@/components/shared/states';
import { Badge } from '@/components/shared/Badge';
import { Button } from '@/components/shared/Button';
import { Field, Input, Select } from '@/components/shared/Form';

interface TacheRow {
  key: string;
  numero: number;
  categorie: string;
  cible: string;
  libelleDefaut: string;
  frequenceDefaut: string;
  libelle: string;
  frequence: string;
  isOverridden: boolean;
}

const FREQUENCE_OPTIONS = [
  { value: 'MENSUELLE', label: 'Tous les mois' },
  { value: 'TRIMESTRIELLE', label: '1 fois / 3 mois' },
  { value: 'SEMESTRIELLE', label: '1 fois / 6 mois' },
  { value: 'AU_BESOIN', label: 'Au besoin' },
];

export default function TachesPreventivesPage() {
  const queryClient = useQueryClient();
  const [edited, setEdited] = useState<Record<string, { libelle: string; frequence: string }>>({});
  const [savedKey, setSavedKey] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['admin-taches-preventives'],
    queryFn: () => api.get('/admin/taches-preventives').then((r) => r.data.data as TacheRow[]),
  });

  useEffect(() => {
    if (data) setEdited(Object.fromEntries(data.map((t) => [t.key, { libelle: t.libelle, frequence: t.frequence }])));
  }, [data]);

  const save = useMutation({
    mutationFn: (key: string) => api.put(`/admin/taches-preventives/${key}`, edited[key]),
    onSuccess: (_r, key) => { setSavedKey(key); queryClient.invalidateQueries({ queryKey: ['admin-taches-preventives'] }); },
  });

  const reset = useMutation({
    mutationFn: (key: string) => api.delete(`/admin/taches-preventives/${key}`),
    onSuccess: (_r, key) => { setSavedKey(key); queryClient.invalidateQueries({ queryKey: ['admin-taches-preventives'] }); },
  });

  if (isLoading || !data) return <Loading />;

  return (
    <div>
      <PageHeader
        title="Tâches préventives contractuelles"
        subtitle="Libellé et fréquence modifiables sans redéploiement - la clé et l'éligibilité restent fixes"
        backHref="/administration"
      />

      <div className="space-y-3 max-w-4xl">
        {data.map((t) => {
          const e = edited[t.key] ?? { libelle: t.libelle, frequence: t.frequence };
          const dirty = e.libelle !== t.libelle || e.frequence !== t.frequence;
          return (
            <div key={t.key} className="bg-white rounded-xl border border-gray-100 p-5">
              <div className="flex items-start justify-between gap-3 mb-3">
                <div>
                  <span className="text-xs font-mono text-gray-400">#{t.numero} · {t.key}</span>
                  <p className="text-xs text-gray-400 mt-0.5">{t.cible}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {t.isOverridden && <Badge className="bg-amber-100 text-amber-700">Personnalisé</Badge>}
                  {savedKey === t.key && !dirty && <span className="flex items-center gap-1 text-xs text-green-600"><CheckCircle2 size={13} /> Enregistré</span>}
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-[1fr_220px] gap-4">
                <Field label="Libellé">
                  <Input
                    value={e.libelle}
                    onChange={(ev) => setEdited((p) => ({ ...p, [t.key]: { ...e, libelle: ev.target.value } }))}
                  />
                </Field>
                <Field label="Fréquence">
                  <Select
                    value={e.frequence}
                    onChange={(ev) => setEdited((p) => ({ ...p, [t.key]: { ...e, frequence: ev.target.value } }))}
                    options={FREQUENCE_OPTIONS}
                  />
                </Field>
              </div>
              {t.isOverridden && (t.libelleDefaut !== e.libelle || t.frequenceDefaut !== e.frequence) && (
                <p className="mt-1 text-xs text-gray-400">Contractuel : {t.libelleDefaut} · {FREQUENCE_OPTIONS.find((f) => f.value === t.frequenceDefaut)?.label}</p>
              )}

              <div className="mt-3 flex justify-end gap-2">
                {t.isOverridden && (
                  <Button variant="secondary" icon={RotateCcw} loading={reset.isPending} onClick={() => reset.mutate(t.key)}>
                    Restaurer le défaut
                  </Button>
                )}
                <Button icon={Save} loading={save.isPending} disabled={!dirty} onClick={() => save.mutate(t.key)}>
                  Enregistrer
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
