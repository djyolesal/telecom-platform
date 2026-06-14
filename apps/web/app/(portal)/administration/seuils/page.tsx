'use client';

import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Save, CheckCircle2, Fuel, Zap } from 'lucide-react';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/shared/PageHeader';
import { Loading } from '@/components/shared/states';
import { Button } from '@/components/shared/Button';
import { Field, Input } from '@/components/shared/Form';

interface Setting { key: string; value: unknown; description?: string }

const SEUILS = [
  { key: 'ge.seuilCritiqueLitres', label: 'Seuil critique (litres)', icon: Fuel, hint: 'En-dessous → alerte CRITIQUE' },
  { key: 'ge.seuilFaibleLitres', label: 'Seuil faible (litres)', icon: Fuel, hint: 'En-dessous → alerte FAIBLE' },
  { key: 'ge.prixLitreFCFA', label: 'Prix du litre de gasoil (FCFA)', icon: Fuel, hint: 'Utilisé pour les coûts estimés' },
  { key: 'ceet.tarifKwhFCFA', label: 'Tarif CEET (FCFA/kWh)', icon: Zap, hint: 'Utilisé pour le coût électricité réseau' },
];

export default function SeuilsPage() {
  const queryClient = useQueryClient();
  const [vals, setVals] = useState<Record<string, string>>({});
  const [savedOk, setSavedOk] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['settings'],
    queryFn: () => api.get('/admin/settings').then((r) => r.data.data as Setting[]),
  });

  useEffect(() => {
    if (data) {
      const init: Record<string, string> = {};
      SEUILS.forEach((s) => {
        const found = data.find((d) => d.key === s.key);
        init[s.key] = found ? String(found.value) : '';
      });
      setVals(init);
    }
  }, [data]);

  const save = useMutation({
    mutationFn: () => api.put('/admin/settings', SEUILS.map((s) => ({ key: s.key, value: Number(vals[s.key]) || 0, description: s.label }))),
    onSuccess: () => { setSavedOk(true); queryClient.invalidateQueries({ queryKey: ['settings'] }); },
  });

  if (isLoading) return <Loading />;

  return (
    <div>
      <PageHeader title="Seuils d'alerte" subtitle="Carburant & tarifs énergie" backHref="/administration" />

      <div className="bg-white rounded-xl border border-gray-100 p-6 max-w-2xl">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {SEUILS.map((s) => {
            const Icon = s.icon;
            return (
              <Field key={s.key} label={s.label}>
                <div className="relative">
                  <Icon size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <Input type="number" value={vals[s.key] ?? ''} onChange={(e) => { setVals((p) => ({ ...p, [s.key]: e.target.value })); setSavedOk(false); }} className="pl-9" />
                </div>
                <p className="mt-1 text-xs text-gray-400">{s.hint}</p>
              </Field>
            );
          })}
        </div>
        <div className="mt-6 flex items-center gap-3">
          <Button icon={Save} loading={save.isPending} onClick={() => { setSavedOk(false); save.mutate(); }}>Enregistrer</Button>
          {savedOk && <span className="flex items-center gap-1 text-sm text-green-600"><CheckCircle2 size={15} /> Enregistré</span>}
        </div>
      </div>
    </div>
  );
}
