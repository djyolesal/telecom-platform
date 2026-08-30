'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Save } from 'lucide-react';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/shared/PageHeader';
import { FormCard, Field, Input, Select, Textarea } from '@/components/shared/Form';
import { SearchSelect } from '@/components/shared/SearchSelect';
import { Button } from '@/components/shared/Button';

interface TacheContractuelle { key: string; libelle: string; categorie: string; frequenceLabel: string; }
interface Actif { id: string; actifType: string; categorie: string; libelle: string | null; siteId: string | null; site: { code: string; nom: string } | null; }

const NATURE_OPTIONS = [
  { value: 'ENTRETIEN', label: 'Entretien (tâche contractuelle)' },
  { value: 'CURATIVE', label: 'Dépannage / curative (équipement en panne)' },
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
    nature: 'ENTRETIEN', siteId: '', tacheKey: '', actifKey: '', equipementCode: '', precision: '', description: '', datePlanifiee: '', technicienId: '',
  });
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const isEntretien = form.nature === 'ENTRETIEN';
  const isCurative = form.nature === 'CURATIVE';
  const isMouvement = !isEntretien && !isCurative;
  const needsDest = form.nature === 'INSTALLATION' || form.nature === 'DEPLACEMENT';

  const { data: sites } = useQuery({
    queryKey: ['sites-select'],
    queryFn: () => api.get('/sites', { params: { all: true } }).then((r) => r.data.data),
  });
  // Seuls les techniciens AFFECTABLES au site choisi (internes + prestataires
  // du lot, société et scope affichés) - la liste suit le site.
  const { data: techs } = useQuery({
    queryKey: ['techs-assignables-site', form.siteId],
    queryFn: () => api.get('/maintenances/techniciens-assignables', { params: { site_id: form.siteId } }).then((r) => r.data.data),
    enabled: !!form.siteId,
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
    enabled: isMouvement,
  });
  // Référentiel des équipements de dépannage (ATS, TGBT, GE, compteur CEET…) :
  // le choix fixe la catégorie contractuelle côté serveur.
  const { data: equipements } = useQuery({
    queryKey: ['equipements-ref'],
    queryFn: () => api.get('/equipements').then((r) => r.data.data as { code: string; libelle: string; actif: boolean }[]),
    enabled: isCurative,
    staleTime: 5 * 60_000,
  });
  const equipementOptions = (equipements ?? []).filter((e) => e.actif).map((e) => ({ value: e.code, label: e.libelle }));
  // GE du site sélectionné (dépannage curatif : on impute la panne à un GE précis).
  const { data: gesDuSite } = useQuery<Actif[]>({
    queryKey: ['ges-site', form.siteId],
    queryFn: () => api.get('/actifs', { params: { type: 'GE', site_id: form.siteId } }).then((r) => r.data.data),
    enabled: isCurative && !!form.siteId && form.equipementCode === 'GE',
  });
  const geOptions = (gesDuSite ?? []).map((g) => ({ value: g.id, label: g.libelle ?? 'GE' }));

  const siteOptions = (sites ?? []).map((s: { id: string; code: string; nom: string }) => ({ value: s.id, label: `${s.code} - ${s.nom}` }));
  const L_SCOPE: Record<string, string> = { PASSIVE: 'passif', ACTIVE: 'actif', LES_DEUX: 'passif + actif', SOLAIRE: 'solaire' };
  const techOptions = (techs ?? []).map((t: { id: string; nom: string; prenom: string; societe: string; scopes: string[] }) => ({
    value: t.id,
    label: `${t.prenom} ${t.nom} - ${t.societe}${t.scopes.length ? ` (${t.scopes.map((x) => L_SCOPE[x] ?? x).join(' / ')})` : ''}`,
  }));
  const tacheOptions = (taches ?? []).map((t) => ({ value: t.key, label: t.libelle }));
  const actifOptions = (actifs ?? []).map((a) => ({ value: `${a.actifType}:${a.id}`, label: `${a.libelle ?? a.categorie}${a.site ? ` - ${a.site.nom}` : ' - Dépôt'}` }));
  const selectedActif = (actifs ?? []).find((a) => `${a.actifType}:${a.id}` === form.actifKey);

  const nowLocal = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);

  const mutation = useMutation({
    // Type de retour explicite : les trois branches postent des corps différents,
    // et axios ≥1.19 fait porter le type du corps à AxiosResponse - sans cette
    // annotation, TypeScript tente d'unifier les trois et échoue.
    mutationFn: (): Promise<{ data: { data: { id: string } } }> => {
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
      // Dépannage curatif : l'ÉQUIPEMENT du référentiel fixe la catégorie
      // contractuelle côté serveur ; un GE en panne reste rattachable à un GE
      // précis du site (cycle de vie de l'actif).
      if (isCurative) {
        if (!form.siteId) throw new Error('Sélectionnez un site.');
        if (!form.equipementCode) throw new Error('Sélectionnez l\'équipement en panne.');
        if (form.equipementCode === 'GE' && !form.actifKey) throw new Error('Sélectionnez le GE concerné.');
        return api.post('/maintenances', {
          siteId: form.siteId, type: 'CURATIVE',
          equipementCode: form.equipementCode,
          precision: form.precision || undefined,
          ...(form.equipementCode === 'GE' && form.actifKey ? { actifType: 'GE', actifId: form.actifKey } : {}),
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
        equipement: `${NATURE_LABEL[form.nature]} - ${selectedActif.libelle ?? selectedActif.categorie}`,
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
    onError: (e: { response?: { data?: { error?: string } } }) => setError(e.response?.data?.error || 'Création impossible - vérifiez votre connexion et réessayez.'),
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
                <SearchSelect value={form.siteId} onChange={(v) => { set('siteId', v); set('tacheKey', ''); }} options={siteOptions} placeholder="Rechercher un site (nom ou code)…" />
              </Field>
              <Field label="Tâche contractuelle" required className="md:col-span-2">
                <Select value={form.tacheKey} onChange={(e) => set('tacheKey', e.target.value)} required disabled={!form.siteId} options={tacheOptions} placeholder={form.siteId ? 'Sélectionner une tâche…' : 'Choisissez d’abord un site'} />
              </Field>
            </>
          ) : isCurative ? (
            <>
              <Field label="Site" required className="md:col-span-2">
                <SearchSelect value={form.siteId} onChange={(v) => { set('siteId', v); set('actifKey', ''); }} options={siteOptions} placeholder="Rechercher un site (nom ou code)…" />
              </Field>
              <Field label="Équipement en panne" required>
                <Select value={form.equipementCode} onChange={(e) => { set('equipementCode', e.target.value); set('actifKey', ''); }} required
                  options={equipementOptions} placeholder="— Sélectionner l'équipement —" />
              </Field>
              <Field label="Précision (optionnel)">
                <Input value={form.precision} onChange={(e) => set('precision', e.target.value)} placeholder="ex. : climatiseur nº 2, contacteur amont" />
              </Field>
              {form.equipementCode === 'GE' && (
                <Field label="GE concerné" required className="md:col-span-2">
                  <Select value={form.actifKey} onChange={(e) => set('actifKey', e.target.value)} required disabled={!form.siteId}
                    options={geOptions} placeholder={form.siteId ? (geOptions.length ? 'Sélectionner le GE en panne…' : 'Aucun GE sur ce site') : 'Choisissez d’abord un site'} />
                </Field>
              )}
            </>
          ) : (
            <>
              <Field label="Actif concerné" required className="md:col-span-2">
                <Select value={form.actifKey} onChange={(e) => set('actifKey', e.target.value)} required options={actifOptions} placeholder={form.nature === 'INSTALLATION' ? 'Actif au dépôt…' : 'Actif en service…'} />
              </Field>
              {needsDest && (
                <Field label="Site de destination" required className="md:col-span-2">
                  <SearchSelect value={form.siteId} onChange={(v) => set('siteId', v)} options={siteOptions} placeholder="Site où poser l’actif…" />
                </Field>
              )}
            </>
          )}

          <Field label="Date planifiée" required>
            <Input type="datetime-local" min={nowLocal} value={form.datePlanifiee} onChange={(e) => set('datePlanifiee', e.target.value)} required />
          </Field>
          <Field label="Technicien">
            <SearchSelect value={form.technicienId} onChange={(v) => set('technicienId', v)} options={techOptions} emptyLabel="(par défaut : moi)" placeholder="Rechercher un technicien…" />
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
