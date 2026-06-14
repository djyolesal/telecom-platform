'use client';

import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Save, CheckCircle2 } from 'lucide-react';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/shared/PageHeader';
import { Loading, EmptyState } from '@/components/shared/states';
import { Button } from '@/components/shared/Button';

interface Setting {
  key: string;
  value: unknown;
  description?: string;
}

export default function ParametresPage() {
  const queryClient = useQueryClient();
  const [edited, setEdited] = useState<Record<string, string>>({});
  const [savedOk, setSavedOk] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['settings'],
    queryFn: () => api.get('/admin/settings').then((r) => r.data.data as Setting[]),
  });

  useEffect(() => {
    if (data) {
      const init: Record<string, string> = {};
      data.forEach((s) => { init[s.key] = typeof s.value === 'string' ? s.value : JSON.stringify(s.value); });
      setEdited(init);
    }
  }, [data]);

  const save = useMutation({
    mutationFn: () => {
      const payload = (data ?? []).map((s) => {
        let value: unknown = edited[s.key];
        try { value = JSON.parse(edited[s.key]); } catch { /* garder la chaîne */ }
        return { key: s.key, value, description: s.description };
      });
      return api.put('/admin/settings', payload);
    },
    onSuccess: () => { setSavedOk(true); queryClient.invalidateQueries({ queryKey: ['settings'] }); },
  });

  if (isLoading) return <Loading />;
  const settings = data ?? [];

  return (
    <div>
      <PageHeader
        title="Paramètres système"
        subtitle="Configuration clé / valeur de la plateforme"
        backHref="/administration"
        actions={
          <div className="flex items-center gap-3">
            {savedOk && <span className="flex items-center gap-1 text-sm text-green-600"><CheckCircle2 size={15} /> Enregistré</span>}
            <Button icon={Save} loading={save.isPending} onClick={() => { setSavedOk(false); save.mutate(); }}>Enregistrer</Button>
          </div>
        }
      />

      {settings.length === 0 ? (
        <EmptyState title="Aucun paramètre" hint="Les paramètres sont initialisés par le seed." />
      ) : (
        <div className="bg-white rounded-xl border border-gray-100 divide-y divide-gray-50">
          {settings.map((s) => (
            <div key={s.key} className="flex flex-col md:flex-row md:items-center gap-2 p-4">
              <div className="md:w-1/3">
                <p className="text-sm font-medium text-gray-800">{s.key}</p>
                {s.description && <p className="text-xs text-gray-400">{s.description}</p>}
              </div>
              <input
                value={edited[s.key] ?? ''}
                onChange={(e) => { setEdited((p) => ({ ...p, [s.key]: e.target.value })); setSavedOk(false); }}
                className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm font-mono focus:border-[#2471A3] focus:ring-2 focus:ring-[#2471A3]/20 outline-none"
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
