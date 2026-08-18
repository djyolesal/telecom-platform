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

interface SmsTemplate {
  key: string; label: string; defaut: string; variables: string[];
  valeur: string | null; // personnalisation, null = défaut
}

export default function ParametresPage() {
  const queryClient = useQueryClient();
  const [edited, setEdited] = useState<Record<string, string>>({});
  const [savedOk, setSavedOk] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['settings'],
    queryFn: () => api.get('/admin/settings').then((r) => r.data.data as Setting[]),
  });

  // Modèles de SMS : édition à part (textarea + variables), même endpoint de
  // sauvegarde — une valeur vide ou identique au défaut = retour au défaut.
  const { data: tpls } = useQuery({
    queryKey: ['sms-templates'],
    queryFn: () => api.get('/admin/sms-templates').then((r) => r.data.data as SmsTemplate[]),
  });
  const [tplEdits, setTplEdits] = useState<Record<string, string>>({});
  useEffect(() => {
    if (tpls) {
      const init: Record<string, string> = {};
      tpls.forEach((t) => { init[t.key] = t.valeur ?? t.defaut; });
      setTplEdits(init);
    }
  }, [tpls]);
  const saveTpls = useMutation({
    mutationFn: () => api.put('/admin/settings', (tpls ?? []).map((t) => ({
      key: t.key,
      value: (tplEdits[t.key] ?? '').trim() === t.defaut.trim() ? '' : (tplEdits[t.key] ?? ''),
      description: `Modèle SMS - ${t.label}`,
    }))),
    onSuccess: () => { setSavedOk(true); queryClient.invalidateQueries({ queryKey: ['sms-templates'] }); },
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
  // Les modèles SMS ont leur section dédiée : on les retire de la liste brute.
  const settings = (data ?? []).filter((s) => !s.key.startsWith('sms.tpl.'));

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

      {(tpls?.length ?? 0) > 0 && (
        <div className="mt-8">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold text-gray-700">Modèles de SMS</h2>
              <p className="text-xs text-gray-400">
                Les {'{variables}'} sont remplacées à l&apos;envoi. Revenir au texte du défaut (bouton « défaut ») puis enregistrer = retour au modèle standard.
              </p>
            </div>
            <Button icon={Save} loading={saveTpls.isPending} onClick={() => { setSavedOk(false); saveTpls.mutate(); }}>
              Enregistrer les modèles
            </Button>
          </div>
          <div className="divide-y divide-gray-50 rounded-xl border border-gray-100 bg-white">
            {tpls!.map((t) => (
              <div key={t.key} className="p-4">
                <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-medium text-gray-800">
                    {t.label}
                    {t.valeur && <span className="ml-2 rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-bold text-amber-700">personnalisé</span>}
                  </p>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {t.variables.map((v) => (
                      <code key={v} className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-600">{`{${v}}`}</code>
                    ))}
                    {(tplEdits[t.key] ?? '') !== t.defaut && (
                      <button type="button" onClick={() => { setTplEdits((p) => ({ ...p, [t.key]: t.defaut })); setSavedOk(false); }}
                        className="text-[11px] font-medium text-[#2471A3] hover:underline">défaut</button>
                    )}
                  </div>
                </div>
                <textarea
                  value={tplEdits[t.key] ?? ''}
                  onChange={(e) => { setTplEdits((p) => ({ ...p, [t.key]: e.target.value })); setSavedOk(false); }}
                  rows={2}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 font-mono text-sm outline-none focus:border-[#2471A3] focus:ring-2 focus:ring-[#2471A3]/20"
                />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
