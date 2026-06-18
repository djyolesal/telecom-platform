'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Save } from 'lucide-react';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/shared/PageHeader';
import { FormCard, Field, Input, Select } from '@/components/shared/Form';
import { Button } from '@/components/shared/Button';
import { Loading, ErrorState } from '@/components/shared/states';
import { regionOptions, STATUTS_GE, POWER_CONFIGS, TYPES_PYLONE, FORMES_CUVE, OUI_NON } from '@/lib/constants';

export default function ModifierSitePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    code: '', nom: '', region: '', ville: '', adresse: '',
    powerConfig: 'CEET_GE', statutGE: 'GE_SECOURS', puissanceGEkva: '0',
    latitude: '', longitude: '', lotId: '',
    hasClimatiseur: 'false', hasExtincteurs: 'false', typePylone: '',
    cuveVolumeLitres: '', formeCuve: '', cuveDimensions: '',
  });
  const [error, setError] = useState('');

  const { data: site, isLoading, isError } = useQuery({
    queryKey: ['site', id],
    queryFn: () => api.get(`/sites/${id}`).then((r) => r.data.data),
  });

  const { data: lots } = useQuery({
    queryKey: ['lots-select'],
    queryFn: () => api.get('/lots', { params: { limit: 500 } }).then((r) => r.data.data),
  });
  const lotOptions = (lots ?? []).map((l: { id: string; code: string; nom: string }) => ({ value: l.id, label: `${l.code} — ${l.nom}` }));

  useEffect(() => {
    if (!site) return;
    setForm({
      code: site.code ?? '',
      nom: site.nom ?? '',
      region: site.region ?? '',
      ville: site.ville ?? '',
      adresse: site.adresse ?? '',
      powerConfig: site.powerConfig ?? 'CEET_GE',
      statutGE: site.statutGE ?? 'GE_SECOURS',
      puissanceGEkva: site.puissanceGEkva != null ? String(site.puissanceGEkva) : '0',
      latitude: site.latitude != null ? String(site.latitude) : '',
      longitude: site.longitude != null ? String(site.longitude) : '',
      lotId: site.lotId ?? '',
      hasClimatiseur: site.hasClimatiseur ? 'true' : 'false',
      hasExtincteurs: site.hasExtincteurs ? 'true' : 'false',
      typePylone: site.typePylone ?? '',
      cuveVolumeLitres: site.cuveVolumeLitres != null ? String(site.cuveVolumeLitres) : '',
      formeCuve: site.formeCuve ?? '',
      cuveDimensions: site.cuveDimensions ?? '',
    });
  }, [site]);

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const mutation = useMutation({
    mutationFn: () =>
      api.put(`/sites/${id}`, {
        code: form.code, nom: form.nom, region: form.region, ville: form.ville || null,
        adresse: form.adresse || null, powerConfig: form.powerConfig, statutGE: form.statutGE,
        puissanceGEkva: Number(form.puissanceGEkva) || 0,
        latitude: form.latitude ? Number(form.latitude) : null,
        longitude: form.longitude ? Number(form.longitude) : null,
        lotId: form.lotId || null,
        hasClimatiseur: form.hasClimatiseur === 'true',
        hasExtincteurs: form.hasExtincteurs === 'true',
        typePylone: form.typePylone || null,
        cuveVolumeLitres: form.cuveVolumeLitres ? Number(form.cuveVolumeLitres) : null,
        formeCuve: form.formeCuve || null,
        cuveDimensions: form.cuveDimensions || null,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['site', id] });
      queryClient.invalidateQueries({ queryKey: ['sites'] });
      router.push(`/sites/${id}`);
    },
    onError: (e: { response?: { data?: { error?: string } } }) => setError(e.response?.data?.error || 'Erreur lors de la mise à jour'),
  });

  if (isLoading) return <Loading />;
  if (isError || !site) return <ErrorState message="Site introuvable" />;

  return (
    <div>
      <PageHeader title={`Modifier — ${site.code}`} backHref={`/sites/${id}`} />
      <FormCard>
        {error && <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-4 py-2.5 text-sm text-red-700">{error}</div>}
        <form
          onSubmit={(e) => { e.preventDefault(); setError(''); mutation.mutate(); }}
          className="grid grid-cols-1 md:grid-cols-2 gap-4"
        >
          <Field label="Code" required>
            <Input value={form.code} onChange={(e) => set('code', e.target.value)} required />
          </Field>
          <Field label="Nom" required>
            <Input value={form.nom} onChange={(e) => set('nom', e.target.value)} required />
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

          <div className="md:col-span-2 mt-2 border-t border-gray-100 pt-3 text-sm font-semibold text-gray-700">Infrastructure</div>
          <Field label="Type de pylône">
            <Select value={form.typePylone} onChange={(e) => set('typePylone', e.target.value)} options={TYPES_PYLONE} placeholder="Sélectionner…" />
          </Field>
          <Field label="Climatiseur sur le site">
            <Select value={form.hasClimatiseur} onChange={(e) => set('hasClimatiseur', e.target.value)} options={OUI_NON} />
          </Field>
          <Field label="Extincteurs sur le site">
            <Select value={form.hasExtincteurs} onChange={(e) => set('hasExtincteurs', e.target.value)} options={OUI_NON} />
          </Field>
          <Field label="Volume cuve gasoil (L)">
            <Input type="number" step="0.01" value={form.cuveVolumeLitres} onChange={(e) => set('cuveVolumeLitres', e.target.value)} placeholder="2000" />
          </Field>
          <Field label="Forme de la cuve">
            <Select value={form.formeCuve} onChange={(e) => set('formeCuve', e.target.value)} options={FORMES_CUVE} placeholder="Sélectionner…" />
          </Field>
          <Field label="Dimensions de la cuve">
            <Input value={form.cuveDimensions} onChange={(e) => set('cuveDimensions', e.target.value)} placeholder="ex: 2m × 1m × 1m" />
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
