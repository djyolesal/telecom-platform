'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Save } from 'lucide-react';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/shared/PageHeader';
import { FormCard, Field, Input, Select, Textarea } from '@/components/shared/Form';
import { SearchableSelect } from '@/components/shared/SearchableSelect';
import { Button } from '@/components/shared/Button';

interface TacheContractuelle { key: string; libelle: string; categorie: string; frequenceLabel: string; }
interface Actif { id: string; actifType: string; categorie: string; libelle: string | null; siteId: string | null; site: { code: string; nom: string } | null; }

const NATURE_OPTIONS = [
  { value: 'ENTRETIEN', label: 'Entretien (tâche contractuelle)' },
  { value: 'INSTALLATION', label: 'Installation d’un actif' },
  { value: 'DESINSTALLATION', label: 'Désinstallation d’un actif' },
  { value: 'DEPLACEMENT', label: 'Déplacement d’un actif' },
];
const NATURE_LABEL: Record<string, string> = {
  INSTALLATION: 'Installation', DESINSTALLATION: 'Désinstallation', DEPLACEMENT: 'Déplacement',
};

export default function NouvelleMaintenancePage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    nature: 'ENTRETIEN', siteId: '', tacheKey: '', actifKey: '', description: '', datePlanifiee: '', technicienId: '',
  });
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const isEntretien = form.nature === 'ENTRETIEN';
  const needsDest = form.nature === 'INSTALLATION' || form.nature === 'DEPLACEMENT';

  const { data: sites } = useQuery({
    queryKey: ['sites-select'],
    queryFn: () => api.get('/sites', { params: { all: true } }).then((r) => r.data.data),
  });
  const { data: techs } = useQuery({
    queryKey: ['techs-select'],
    queryFn: () => api.get('/users', { params: { role: 'TECHNICIEN', limit: 200 } }).then((r) => r.data.data),
  });
  const { data: taches } = useQuery<TacheContractuelle[]>({
    queryKey: ['site-taches-select', form.siteId],
    queryFn: () => api.get(`/sites/${form.siteId}/taches-preventives`).then((r) => r.data.data),
    enabled: isEntretien && !!form.siteId,
  });
  // Actifs candidats : au dépôt pour une installation ; en service sinon.
  const { data: actifs } = useQuery<Actif[]>({
    queryKey: ['actifs-picker', form.nature],
    queryFn: () => api.get('/actifs', { params: form.nature === 'INSTALLATION' ? { en_stock: 'true' } : { statut: 'EN_SERVICE' } }).then((r) => r.data.data),
    enabled: !isEntretien,
  });

  const siteOptions = (sites ?? []).map((s: { id: string; nom: string }) => ({ value: s.id, label: s.nom }));
  const techOptions = (techs ?? []).map((t: { id: string; nom: string; prenom: string }) => ({ value: t.id, label: `${t.prenom} ${t.nom}` }));
  const tacheOptions = (taches ?? []).map((t) => ({ value: t.key, label: t.libelle }));
  const actifOptions = (actifs ?? []).map((a) => ({ value: `${a.actifType}:${a.id}`, label: `${a.libelle ?? a.categorie}${a.site ? ` — ${a.site.code}` : ' — Dépôt'}` }));
  const selectedActif = (actifs ?? []).find((a) => `${a.actifType}:${a.id}` === form.actifKey);

  const nowLocal = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);

  const mutation = useMutation({
    mutationFn: () => {
      if (new Date(form.datePlanifiee).getTime() < Date.now() - 60000) {
        throw new Error('La date planifiée doit être postérieure ou égale à maintenant.');
      }
      if (isEntretien) {
        if (!form.siteId) throw new Error('Sélectionnez un site.');
        const tache = (taches ?? []).find((t) => t.key === form.tacheKey);
        if (!tache) throw new Error('Sélectionnez une tâche contractuelle.');
        return api.post('/maintenances', {
          siteId: form.siteId, type: 'PREVENTIVE',
          categorie: tache.categorie, equipement: tache.libelle, tachePreventiveKey: tache.key,
          description: form.description || undefined,
          datePlanifiee: new Date(form.datePlanifiee).toISOString(),
          technicienId: form.technicienId || undefined,
        });
      }
      // Travail de cycle de vie
      if (!selectedActif) throw new Error('Sélectionnez un actif.');
      if (needsDest && !form.siteId) throw new Error('Sélectionnez le site de destination.');
      const siteId = form.nature === 'DESINSTALLATION' ? selectedActif.siteId : form.siteId;
      if (!siteId) throw new Error('Site indéterminé pour cet actif.');
      return api.post('/maintenances', {
        siteId, type: 'CURATIVE',
        categorie: selectedActif.categorie,
        equipement: `${NATURE_LABEL[form.nature]} — ${selectedActif.libelle ?? selectedActif.categorie}`,
        natureTravaux: form.nature,
        actifType: selectedActif.actifType,
        actifId: selectedActif.id,
        siteSourceId: form.nature === 'DEPLACEMENT' ? selectedActif.siteId : undefined,
        description: form.description || undefined,
        datePlanifiee: new Date(form.datePlanifiee).toISOString(),
        technicienId: form.technicienId || undefined,
      });
    },
    onSuccess: (r) => {
      queryClient.invalidateQueries({ queryKey: ['maintenances'] });
      router.push(`/maintenance/${r.data.data.id}`);
    },
    onError: (e: { response?: { data?: { error?: string } }; message?: string }) => setError(e.response?.data?.error || e.message || 'Erreur lors de la création'),
  });

  return (
    <div>
      <PageHeader title="Planifier une intervention" backHref="/maintenance" />
      <FormCard>
        {error && <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-4 py-2.5 text-sm text-red-700">{error}</div>}
        <form onSubmit={(e) => { e.preventDefault(); setError(''); mutation.mutate(); }} className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Nature des travaux" required className="md:col-span-2">
            <Select value={form.nature} onChange={(e) => setForm((f) => ({ ...f, nature: e.target.value, tacheKey: '', actifKey: '', siteId: '' }))} options={NATURE_OPTIONS} />
          </Field>

          {isEntretien ? (
            <>
              <Field label="Site" required className="md:col-span-2">
                <SearchableSelect value={form.siteId} onChange={(v) => { set('siteId', v); set('tacheKey', ''); }} options={siteOptions} placeholder="Rechercher / sélectionner un site…" />
              </Field>
              <Field label="Tâche contractuelle" required className="md:col-span-2">
                <Select value={form.tacheKey} onChange={(e) => set('tacheKey', e.target.value)} required disabled={!form.siteId} options={tacheOptions} placeholder={form.siteId ? 'Sélectionner une tâche…' : 'Choisissez d’abord un site'} />
              </Field>
            </>
          ) : (
            <>
              <Field label="Actif concerné" required className="md:col-span-2">
                <Select value={form.actifKey} onChange={(e) => set('actifKey', e.target.value)} required options={actifOptions} placeholder={form.nature === 'INSTALLATION' ? 'Actif au dépôt…' : 'Actif en service…'} />
              </Field>
              {needsDest && (
                <Field label="Site de destination" required className="md:col-span-2">
                  <SearchableSelect value={form.siteId} onChange={(v) => set('siteId', v)} options={siteOptions} placeholder="Site où poser l’actif…" />
                </Field>
              )}
            </>
          )}

          <Field label="Date planifiée" required>
            <Input type="datetime-local" min={nowLocal} value={form.datePlanifiee} onChange={(e) => set('datePlanifiee', e.target.value)} required />
          </Field>
          <Field label="Technicien">
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
