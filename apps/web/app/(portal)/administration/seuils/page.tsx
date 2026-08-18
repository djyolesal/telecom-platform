'use client';

import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Save, CheckCircle2 } from 'lucide-react';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/shared/PageHeader';
import { Loading } from '@/components/shared/states';
import { Button } from '@/components/shared/Button';
import { Field, Input } from '@/components/shared/Form';

interface Param { key: string; label: string; groupe: string; unite: string; defaut: number; valeur: number }

export default function SeuilsPage() {
  const queryClient = useQueryClient();
  const [vals, setVals] = useState<Record<string, string>>({});
  const [savedOk, setSavedOk] = useState(false);

  // Catalogue + valeurs effectives (défaut surchargé par la base).
  const { data, isLoading } = useQuery({
    queryKey: ['settings-effectifs'],
    queryFn: () => api.get('/admin/settings/effectifs').then((r) => r.data.data as Param[]),
  });

  useEffect(() => {
    if (data) setVals(Object.fromEntries(data.map((p) => [p.key, String(p.valeur)])));
  }, [data]);

  const save = useMutation({
    mutationFn: () => api.put('/admin/settings', (data ?? []).map((p) => ({ key: p.key, value: Number(vals[p.key]) || p.defaut, description: p.label }))),
    onSuccess: () => { setSavedOk(true); queryClient.invalidateQueries({ queryKey: ['settings-effectifs'] }); },
  });

  if (isLoading || !data) return <Loading />;

  // Regroupe par catégorie en conservant l'ordre du catalogue.
  const groupes: { nom: string; params: Param[] }[] = [];
  for (const p of data) {
    let g = groupes.find((x) => x.nom === p.groupe);
    if (!g) { g = { nom: p.groupe, params: [] }; groupes.push(g); }
    g.params.push(p);
  }

  return (
    <div>
      <PageHeader title="Seuils & paramètres" subtitle="Carburant, maintenance et alertes - modifiables sans redéploiement" backHref="/administration" />

      <div className="space-y-5 max-w-3xl">
        {groupes.map((g) => (
          <div key={g.nom} className="bg-white rounded-xl border border-gray-100 p-6">
            <h3 className="font-semibold text-gray-700 text-sm mb-4">{g.nom}</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {g.params.map((p) => (
                <Field key={p.key} label={p.label}>
                  <div className="relative">
                    <Input type="number" value={vals[p.key] ?? ''} onChange={(e) => { setVals((v) => ({ ...v, [p.key]: e.target.value })); setSavedOk(false); }} className="pr-12" />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400">{p.unite}</span>
                  </div>
                  <p className="mt-1 text-xs text-gray-400">Défaut : {p.defaut} {p.unite}</p>
                </Field>
              ))}
            </div>
          </div>
        ))}

        <div className="flex items-center gap-3">
          <Button icon={Save} loading={save.isPending} onClick={() => { setSavedOk(false); save.mutate(); }}>Enregistrer</Button>
          {savedOk && <span className="flex items-center gap-1 text-sm text-green-600"><CheckCircle2 size={15} /> Enregistré - effet immédiat</span>}
        </div>
      </div>
    </div>
  );
}
