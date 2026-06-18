'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Save } from 'lucide-react';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/shared/PageHeader';
import { FormCard, Field, Input, Select } from '@/components/shared/Form';
import { Button } from '@/components/shared/Button';
import { regionOptions, STATUTS_GE, POWER_CONFIGS } from '@/lib/constants';

export default function NouveauSitePage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    code: '', nom: '', region: '', ville: '', adresse: '',
    powerConfig: 'CEET_GE', statutGE: 'GE_SECOURS', puissanceGEkva: '0',
    latitude: '', longitude: '', lotId: '',
  });
  const [error, setError] = useState('');

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const { data: lots } = useQuery({
    queryKey: ['lots-select'],
    queryFn: () => api.get('/lots', { params: { limit: 500 } }).then((r) => r.data.data),
  });
  const lotOptions = (lots ?? []).map((l: { id: string; code: string; nom: string }) => ({ value: l.id, label: `${l.code} — ${l.nom}` }));

  const mutation = useMutation({
    mutationFn: () =>
      api.post('/sites', {
        code: form.code, nom: form.nom, region: form.region, ville: form.ville || undefined,
        adresse: form.adresse || undefined, powerConfig: form.powerConfig, statutGE: form.statutGE,
        puissanceGEkva: Number(form.puissanceGEkva) || 0,
        latitude: form.latitude ? Number(form.latitude) : undefined,
        longitude: form.longitude ? Number(form.longitude) : undefined,
        lotId: form.lotId || undefined,
      }),
    onSuccess: (r) => {
      queryClient.invalidateQueries({ queryKey: ['sites'] });
      router.push(`/sites/${r.data.data.id}`);
    },
    onError: (e: { response?: { data?: { error?: string } } }) => setError(e.response?.data?.error || 'Erreur lors de la création'),
  });

  return (
    <div>
      <PageHeader title="Nouveau site" backHref="/sites" />
      <FormCard>
        {error && <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-4 py-2.5 text-sm text-red-700">{error}</div>}
        <form
          onSubmit={(e) => { e.preventDefault(); setError(''); mutation.mutate(); }}
          className="grid grid-cols-1 md:grid-cols-2 gap-4"
        >
          <Field label="Code" required>
            <Input value={form.code} onChange={(e) => set('code', e.target.value)} required placeholder="MAR-001" />
          </Field>
          <Field label="Nom" required>
            <Input value={form.nom} onChange={(e) => set('nom', e.target.value)} required placeholder="Site Lomé Centre" />
          </Field>
          <Field label="Région" required>
            <Select value={form.region} onChange={(e) => set('region', e.target.value)} required options={regionOptions} placeholder="Sélectionner…" />
          </Field>
          <Field label="Ville">
            <Input value={form.ville} onChange={(e) => set('ville', e.target.value)} />
          </Field>
          <Field label="Configuration énergie" required>
            <Select value={form.powerConfig} onChange={(e) => set('powerConfig', e.target.value)} options={POWER_CONFIGS} />
          </Field>
          <Field label="Statut GE" required>
            <Select value={form.statutGE} onChange={(e) => set('statutGE', e.target.value)} options={STATUTS_GE} />
          </Field>
          <Field label="Puissance GE (kVA)">
            <Input type="number" step="0.01" value={form.puissanceGEkva} onChange={(e) => set('puissanceGEkva', e.target.value)} />
          </Field>
          <Field label="Lot (rattachement / prestataire)">
            <Select value={form.lotId} onChange={(e) => set('lotId', e.target.value)} options={lotOptions} placeholder="Aucun lot" />
          </Field>
          <Field label="Adresse">
            <Input value={form.adresse} onChange={(e) => set('adresse', e.target.value)} />
          </Field>
          <Field label="Latitude">
            <Input type="number" step="0.000001" value={form.latitude} onChange={(e) => set('latitude', e.target.value)} placeholder="6.1725" />
          </Field>
          <Field label="Longitude">
            <Input type="number" step="0.000001" value={form.longitude} onChange={(e) => set('longitude', e.target.value)} placeholder="1.2314" />
          </Field>

          <div className="md:col-span-2 flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={() => router.back()}>Annuler</Button>
            <Button type="submit" icon={Save} loading={mutation.isPending}>Enregistrer</Button>
          </div>
        </form>
      </FormCard>
    </div>
  );
}
