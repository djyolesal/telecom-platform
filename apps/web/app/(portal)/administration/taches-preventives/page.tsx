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
  /** Prix d'UNE exécution sur UN site (FCFA) ; null = non tarifée. */
  cout: number | null;
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
  // Prix en cours de saisie, en TEXTE : « 1 500,50 » se tape à la française et le
  // champ vide veut dire « pas de prix », ce qui n'est pas « 0 ».
  const [couts, setCouts] = useState<Record<string, string>>({});
  const [coutEnregistre, setCoutEnregistre] = useState<string | null>(null);
  const [coutErreur, setCoutErreur] = useState<{ key: string; message: string } | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['admin-taches-preventives'],
    queryFn: () => api.get('/admin/taches-preventives').then((r) => r.data.data as TacheRow[]),
  });

  useEffect(() => {
    if (data) {
      setEdited(Object.fromEntries(data.map((t) => [t.key, { libelle: t.libelle, frequence: t.frequence }])));
      setCouts(Object.fromEntries(data.map((t) => [t.key, t.cout != null ? String(t.cout) : ''])));
    }
  }, [data]);

  const save = useMutation({
    mutationFn: (key: string) => api.put(`/admin/taches-preventives/${key}`, edited[key]),
    onSuccess: (_r, key) => { setSavedKey(key); queryClient.invalidateQueries({ queryKey: ['admin-taches-preventives'] }); },
  });

  // Endpoint à part : le prix ne dépend pas du libellé ni de la fréquence, et
  // « Restaurer le défaut » ne l'efface pas.
  const saveCout = useMutation({
    mutationFn: ({ key, valeur }: { key: string; valeur: string }) =>
      api.put(`/admin/taches-preventives/${key}/cout`, { cout: valeur.trim() === '' ? null : valeur }),
    onSuccess: (_r, { key }) => {
      setCoutErreur(null);
      setCoutEnregistre(key);
      queryClient.invalidateQueries({ queryKey: ['admin-taches-preventives'] });
    },
    onError: (e: { response?: { data?: { error?: string } } }, { key }) =>
      setCoutErreur({ key, message: e.response?.data?.error ?? 'Enregistrement impossible' }),
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
        subtitle="Libellé, fréquence et prix modifiables sans redéploiement - la clé et l'éligibilité restent fixes"
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

              {/* PRIX. Bloc séparé, avec son propre bouton : il s'enregistre sur son
                  propre endpoint et survit à « Restaurer le défaut ». */}
              {(() => {
                const saisi = couts[t.key] ?? '';
                const enBase = t.cout != null ? String(t.cout) : '';
                const sale = saisi.trim() !== enBase;
                return (
                  <div className="mt-4 rounded-lg bg-gray-50 px-4 py-3">
                    <div className="flex flex-wrap items-end gap-3">
                      <div className="w-56">
                        <Field label="Prix d'une exécution (FCFA, par site)">
                          <Input
                            inputMode="decimal"
                            placeholder="Non renseigné"
                            value={saisi}
                            onChange={(ev) => { setCouts((p) => ({ ...p, [t.key]: ev.target.value })); setCoutEnregistre(null); }}
                          />
                        </Field>
                      </div>
                      <Button
                        variant="secondary" icon={Save}
                        loading={saveCout.isPending && saveCout.variables?.key === t.key}
                        disabled={!sale}
                        onClick={() => saveCout.mutate({ key: t.key, valeur: saisi })}
                      >
                        {saisi.trim() === '' && t.cout != null ? 'Retirer le prix' : 'Enregistrer le prix'}
                      </Button>
                      {coutEnregistre === t.key && !sale && (
                        <span className="flex items-center gap-1 pb-2 text-xs text-green-600"><CheckCircle2 size={13} /> Prix enregistré</span>
                      )}
                    </div>
                    {coutErreur?.key === t.key && <p className="mt-1 text-xs text-red-600">{coutErreur.message}</p>}
                    <p className="mt-1.5 text-xs text-gray-400">
                      {t.cout == null
                        ? 'Tâche non tarifée : la facture mensuelle signalera un prix manquant. Laisser vide n\'est pas la même chose que 0 (prestation incluse).'
                        : 'Montant facturé pour une exécution de cette tâche sur un site. Il survit à « Restaurer le défaut ».'}
                    </p>
                  </div>
                );
              })()}

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
