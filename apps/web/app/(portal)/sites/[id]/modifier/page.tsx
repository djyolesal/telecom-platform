'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Save, Trash2 } from 'lucide-react';
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
    hasGardien: 'false', societeGardiennage: '', gardiennagePrestataireId: '', telephoneSite: '',
    marqueGE: '',
  });
  const { data: societesGardiennage } = useQuery({
    queryKey: ['prestataires-gardiennage'],
    queryFn: () => api.get('/prestataires', { params: { is_gardiennage: 'true', is_active: 'true', limit: 200 } }).then((r) => r.data.data as { id: string; nom: string }[]),
  });
  const gardiennageOptions = (societesGardiennage ?? []).map((p) => ({ value: p.id, label: p.nom }));
  const [error, setError] = useState('');
  // Groupes électrogènes supplémentaires (GE n°2, 3…). Le GE n°1 = champs statut/puissance ci-dessus.
  const [extraGEs, setExtraGEs] = useState<{ puissanceKva: string; statut: string; marque: string }[]>([]);

  const { data: site, isLoading, isError } = useQuery({
    queryKey: ['site', id],
    queryFn: () => api.get(`/sites/${id}`).then((r) => r.data.data),
  });

  const { data: typesPylone } = useQuery({
    queryKey: ['types-pylone'],
    queryFn: () => api.get('/types-pylone').then((r) => r.data.data as { code: string; libelle: string }[]),
  });
  const pyloneOptions = typesPylone?.map((t) => ({ value: t.code, label: t.libelle })) ?? TYPES_PYLONE;
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
      hasGardien: site.hasGardien ? 'true' : 'false',
      societeGardiennage: site.societeGardiennage ?? '',
      gardiennagePrestataireId: site.gardiennagePrestataireId ?? '',
      telephoneSite: site.telephoneSite ?? '',
      marqueGE: (site.groupes as { numero: number; marque?: string | null }[] | undefined)?.find((g) => g.numero === 1)?.marque ?? '',
    });
    const extras = (site.groupes ?? [])
      .filter((g: { numero: number }) => g.numero > 1)
      .sort((a: { numero: number }, b: { numero: number }) => a.numero - b.numero)
      .map((g: { puissanceKva: number; statut: string; marque?: string | null }) => ({ puissanceKva: String(g.puissanceKva ?? 0), statut: g.statut ?? 'GE_SECOURS', marque: g.marque ?? '' }));
    setExtraGEs(extras);
  }, [site]);

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const mutation = useMutation({
    mutationFn: async () => {
      await api.put(`/sites/${id}`, {
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
        hasGardien: form.hasGardien === 'true',
        societeGardiennage: form.societeGardiennage || null,
        gardiennagePrestataireId: form.gardiennagePrestataireId || null,
        telephoneSite: form.telephoneSite || null,
      });
      // Synchronise la liste des GE : n°1 = champs ci-dessus, n°2+ = liste supplémentaire.
      const groupes: { numero: number; puissanceKva: number; statut: string; marque?: string }[] = [];
      if (form.statutGE !== 'PAS_DE_GE') {
        groupes.push({ numero: 1, puissanceKva: Number(form.puissanceGEkva) || 0, statut: form.statutGE, marque: form.marqueGE || undefined });
      }
      extraGEs.forEach((g, i) => groupes.push({ numero: i + 2, puissanceKva: Number(g.puissanceKva) || 0, statut: g.statut, marque: g.marque || undefined }));
      await api.put(`/sites/${id}/groupes`, { groupes });
    },
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
          <Field label="Statut GE n°1" required>
            <Select value={form.statutGE} onChange={(e) => set('statutGE', e.target.value)} options={STATUTS_GE} />
          </Field>
          <Field label="Puissance GE n°1 (kVA)">
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
            <Select value={form.typePylone} onChange={(e) => set('typePylone', e.target.value)} options={pyloneOptions} placeholder="Sélectionner…" />
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

          <div className="md:col-span-2 mt-2 border-t border-gray-100 pt-3 text-sm font-semibold text-gray-700">Gardiennage & contact</div>
          <Field label="Agent de sécurité sur le site">
            <Select value={form.hasGardien} onChange={(e) => set('hasGardien', e.target.value)} options={OUI_NON} />
          </Field>
          <Field label="Société de gardiennage">
            <Select value={form.gardiennagePrestataireId} onChange={(e) => set('gardiennagePrestataireId', e.target.value)} options={gardiennageOptions} placeholder="(aucune)" />
            {form.societeGardiennage && !form.gardiennagePrestataireId && (
              <p className="mt-1 text-xs text-amber-600">Saisie libre héritée : « {form.societeGardiennage} » — créez la société dans Administration → Prestataires (case gardiennage) pour la rapprocher.</p>
            )}
          </Field>
          <Field label="Téléphone du site (gardien / contact local)">
            <Input value={form.telephoneSite} onChange={(e) => set('telephoneSite', e.target.value)} placeholder="+228 90 00 00 00" />
          </Field>

          <div className="md:col-span-2 mt-2 border-t border-gray-100 pt-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-semibold text-gray-700">Groupes électrogènes supplémentaires</span>
              <button type="button" onClick={() => setExtraGEs((g) => [...g, { puissanceKva: '0', statut: 'GE_SECOURS', marque: '' }])} className="text-sm font-medium text-[#2471A3] hover:underline">+ Ajouter un GE</button>
            </div>
            {extraGEs.length === 0 ? (
              <p className="text-xs text-gray-400">Le GE n°1 est défini ci-dessus. Ajoutez un GE n°2, 3… pour les sites multi-générateurs (cuve partagée).</p>
            ) : (
              <div className="space-y-2">
                {extraGEs.map((g, i) => (
                  <div key={i} className="flex items-end gap-2">
                    <span className="pb-2 text-xs font-medium text-gray-500 w-12">n°{i + 2}</span>
                    <Field label="Statut" className="flex-1">
                      <Select value={g.statut} onChange={(e) => setExtraGEs((arr) => arr.map((x, j) => j === i ? { ...x, statut: e.target.value } : x))} options={STATUTS_GE} />
                    </Field>
                    <Field label="Puissance (kVA)" className="flex-1">
                      <Input type="number" step="0.01" value={g.puissanceKva} onChange={(e) => setExtraGEs((arr) => arr.map((x, j) => j === i ? { ...x, puissanceKva: e.target.value } : x))} />
                    </Field>
                    <Field label="Marque" className="flex-1">
                      <Input value={g.marque} onChange={(e) => setExtraGEs((arr) => arr.map((x, j) => j === i ? { ...x, marque: e.target.value } : x))} placeholder="CATERPILLAR" />
                    </Field>
                    <button type="button" onClick={() => setExtraGEs((arr) => arr.filter((_, j) => j !== i))} className="pb-2 text-red-500 hover:text-red-700"><Trash2 size={16} /></button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="md:col-span-2 flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={() => router.back()}>Annuler</Button>
            <Button type="submit" icon={Save} loading={mutation.isPending}>Enregistrer</Button>
          </div>
        </form>
      </FormCard>
    </div>
  );
}
