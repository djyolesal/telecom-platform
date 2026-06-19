'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Save } from 'lucide-react';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/shared/PageHeader';
import { FormCard, Field, Input, Select, Textarea } from '@/components/shared/Form';
import { Button } from '@/components/shared/Button';

interface TacheContractuelle { key: string; libelle: string; categorie: string; frequenceLabel: string; }

export default function NouvelleMaintenancePage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    siteId: '', tacheKey: '', description: '', datePlanifiee: '', technicienId: '',
  });
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const { data: sites } = useQuery({
    queryKey: ['sites-select'],
    queryFn: () => api.get('/sites', { params: { limit: 1000 } }).then((r) => r.data.data),
  });
  const { data: techs } = useQuery({
    queryKey: ['techs-select'],
    queryFn: () => api.get('/users', { params: { role: 'TECHNICIEN', limit: 200 } }).then((r) => r.data.data),
  });
  // Tâches contractuelles applicables au site choisi.
  const { data: taches } = useQuery<TacheContractuelle[]>({
    queryKey: ['site-taches-select', form.siteId],
    queryFn: () => api.get(`/sites/${form.siteId}/taches-preventives`).then((r) => r.data.data),
    enabled: !!form.siteId,
  });

  const siteOptions = (sites ?? []).map((s: { id: string; code: string; nom: string }) => ({ value: s.id, label: `${s.code} — ${s.nom}` }));
  const techOptions = (techs ?? []).map((t: { id: string; nom: string; prenom: string }) => ({ value: t.id, label: `${t.prenom} ${t.nom}` }));
  const tacheOptions = (taches ?? []).map((t) => ({ value: t.key, label: `${t.libelle} (${t.frequenceLabel})` }));

  const mutation = useMutation({
    mutationFn: () => {
      const tache = (taches ?? []).find((t) => t.key === form.tacheKey);
      if (!tache) throw new Error('Tâche introuvable');
      return api.post('/maintenances', {
        siteId: form.siteId, type: 'PREVENTIVE',
        categorie: tache.categorie, equipement: tache.libelle, tachePreventiveKey: tache.key,
        description: form.description || undefined,
        datePlanifiee: new Date(form.datePlanifiee).toISOString(),
        technicienId: form.technicienId || undefined,
      });
    },
    onSuccess: (r) => {
      queryClient.invalidateQueries({ queryKey: ['maintenances'] });
      router.push(`/maintenance/${r.data.data.id}`);
    },
    onError: (e: { response?: { data?: { error?: string } } }) => setError(e.response?.data?.error || 'Erreur lors de la création'),
  });

  return (
    <div>
      <PageHeader title="Planifier une maintenance" backHref="/maintenance" />
      <FormCard>
        {error && <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-4 py-2.5 text-sm text-red-700">{error}</div>}
        <form onSubmit={(e) => { e.preventDefault(); setError(''); mutation.mutate(); }} className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Site" required className="md:col-span-2">
            <Select value={form.siteId} onChange={(e) => { set('siteId', e.target.value); set('tacheKey', ''); }} required options={siteOptions} placeholder="Sélectionner un site…" />
          </Field>
          <Field label="Tâche contractuelle" required className="md:col-span-2">
            <Select
              value={form.tacheKey}
              onChange={(e) => set('tacheKey', e.target.value)}
              required
              disabled={!form.siteId}
              options={tacheOptions}
              placeholder={form.siteId ? 'Sélectionner une tâche…' : 'Choisissez d’abord un site'}
            />
          </Field>
          <Field label="Date planifiée" required>
            <Input type="datetime-local" value={form.datePlanifiee} onChange={(e) => set('datePlanifiee', e.target.value)} required />
          </Field>
          <Field label="Technicien" className="md:col-span-2">
            <Select value={form.technicienId} onChange={(e) => set('technicienId', e.target.value)} options={techOptions} placeholder="(par défaut : moi)" />
          </Field>
          <Field label="Description" className="md:col-span-2">
            <Textarea value={form.description} onChange={(e) => set('description', e.target.value)} placeholder="Détails de l'intervention…" />
          </Field>

          <div className="md:col-span-2 flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={() => router.back()}>Annuler</Button>
            <Button type="submit" icon={Save} loading={mutation.isPending}>Planifier</Button>
          </div>
        </form>
      </FormCard>
    </div>
  );
}
