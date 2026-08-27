'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Save } from 'lucide-react';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/shared/PageHeader';
import { FormCard, Field, Select, Textarea } from '@/components/shared/Form';
import { SearchSelect } from '@/components/shared/SearchSelect';
import { Button } from '@/components/shared/Button';
import { SEVERITES } from '@/lib/constants';
import { useTypesIncident } from '@/lib/typesIncident';

export default function NouvelIncidentPage() {
  const { options: typesOptions } = useTypesIncident();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [error, setError] = useState('');
  const [form, setForm] = useState({ siteId: '', type: 'ALARME', severite: 'MAJEUR', description: '' });
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const { data: sites } = useQuery({
    queryKey: ['sites-select'],
    queryFn: () => api.get('/sites', { params: { all: true } }).then((r) => r.data.data),
  });
  const siteOptions = (sites ?? []).map((s: { id: string; code: string; nom: string }) => ({ value: s.id, label: `${s.code} - ${s.nom}` }));

  const mutation = useMutation({
    mutationFn: () => {
      if (!form.siteId) throw new Error('Sélectionnez un site.');
      return api.post('/incidents', { siteId: form.siteId, type: form.type, severite: form.severite, description: form.description });
    },
    onSuccess: (r) => {
      queryClient.invalidateQueries({ queryKey: ['incidents'] });
      router.push(`/incidents/${r.data.data.id}`);
    },
    onError: (e: { response?: { data?: { error?: string } }; message?: string }) => setError(e.response?.data?.error || e.message || 'Erreur lors de la déclaration'),
  });

  return (
    <div>
      <PageHeader title="Déclarer un incident" backHref="/incidents" />
      <FormCard>
        {error && <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-4 py-2.5 text-sm text-red-700">{error}</div>}
        <form onSubmit={(e) => { e.preventDefault(); setError(''); mutation.mutate(); }} className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Site" required className="md:col-span-2">
            <SearchSelect value={form.siteId} onChange={(v) => set('siteId', v)} options={siteOptions} placeholder="Rechercher un site (nom ou code)…" />
          </Field>
          <Field label="Type" required>
            <Select value={form.type} onChange={(e) => set('type', e.target.value)} options={typesOptions} />
          </Field>
          <Field label="Sévérité" required>
            <Select value={form.severite} onChange={(e) => set('severite', e.target.value)} options={SEVERITES} />
          </Field>
          <Field label="Description" required className="md:col-span-2">
            <Textarea value={form.description} onChange={(e) => set('description', e.target.value)} required placeholder="Décrivez l'incident constaté…" />
          </Field>

          <div className="md:col-span-2 flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={() => router.back()}>Annuler</Button>
            <Button type="submit" icon={Save} loading={mutation.isPending}>Déclarer</Button>
          </div>
        </form>
      </FormCard>
    </div>
  );
}
