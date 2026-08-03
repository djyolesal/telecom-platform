'use client';

import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Building2, CheckCircle2 } from 'lucide-react';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/shared/PageHeader';
import { Field, Input } from '@/components/shared/Form';
import { Button } from '@/components/shared/Button';
import { Loading, ErrorState, EmptyState } from '@/components/shared/states';

interface MaSociete {
  id: string; nom: string;
  email: string | null; adresse: string | null; rccm: string | null; nif: string | null;
  contactCommercial: string | null; contactTechnique: string | null; logoPath: string | null;
  /** URL signée fournie par l'API (le bucket n'est plus lisible par son chemin). */
  logoUrl?: string | null;
  ficheComplete: boolean; champsManquants: string[];
}

/**
 * Fiche de la société du superviseur prestataire : à compléter à la première
 * connexion (navigation bloquée par le layout tant que les champs requis sont
 * vides) — ces coordonnées alimentent l'en-tête des fiches de validation PDF.
 */
export default function MaSocietePage() {
  const queryClient = useQueryClient();
  const { data: societe, isLoading, isError } = useQuery({
    queryKey: ['ma-societe'],
    queryFn: () => api.get('/ma-societe').then((r) => r.data.data as MaSociete | null),
  });

  if (isLoading) return <Loading />;
  if (isError) return <ErrorState />;
  if (!societe) return <EmptyState title="Compte interne" hint="Votre compte n'est rattaché à aucun prestataire — cette page ne vous concerne pas." />;

  return (
    <div>
      <PageHeader
        title={`Ma société — ${societe.nom}`}
        subtitle="Coordonnées officielles utilisées sur les fiches de validation et documents PDF"
      />
      {!societe.ficheComplete && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <b>Fiche incomplète.</b> Renseignez tous les champs requis (*) pour accéder au reste de la plateforme.
        </div>
      )}
      <SocieteForm societe={societe} onSaved={() => queryClient.invalidateQueries({ queryKey: ['ma-societe'] })} />
    </div>
  );
}

function SocieteForm({ societe, onSaved }: { societe: MaSociete; onSaved: () => void }) {
  const [f, setF] = useState({
    email: societe.email ?? '', adresse: societe.adresse ?? '', rccm: societe.rccm ?? '', nif: societe.nif ?? '',
    contactCommercial: societe.contactCommercial ?? '', contactTechnique: societe.contactTechnique ?? '',
    logoPath: societe.logoPath ?? '',
  });
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const set = (k: string, v: string) => { setF((x) => ({ ...x, [k]: v })); setSaved(false); };

  // Une sauvegarde réussie et complète → le layout laisse à nouveau naviguer.
  useEffect(() => { setSaved(false); }, [societe.id]);

  const uploadLogo = async (file: File) => {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('folder', 'logos');
      fd.append('file', file);
      const r = await api.post('/upload/image', fd);
      if (r.data?.data) { set('logoPath', r.data.data.key); setLogoPreview(r.data.data.url); }
    } catch { setError('Échec de l’upload du logo.'); }
    finally { setUploading(false); }
  };

  const save = useMutation({
    mutationFn: () => api.put('/ma-societe', f).then((r) => r.data.data as MaSociete),
    onSuccess: (d) => { setError(''); setSaved(true); onSaved(); if (!d.ficheComplete) setError(`Champs encore manquants : ${d.champsManquants.join(', ')}`); },
    onError: (e: { response?: { data?: { error?: string } } }) => setError(e.response?.data?.error || 'Erreur'),
  });

  return (
    <form className="max-w-3xl rounded-xl border border-gray-100 bg-white p-5"
      onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
      <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-gray-700"><Building2 size={16} /> Coordonnées officielles</div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Email de la société *"><Input type="email" value={f.email} onChange={(e) => set('email', e.target.value)} required /></Field>
        <Field label="Adresse *"><Input value={f.adresse} onChange={(e) => set('adresse', e.target.value)} placeholder="Rue, quartier — BP, ville" required /></Field>
        <Field label="RCCM *"><Input value={f.rccm} onChange={(e) => set('rccm', e.target.value)} placeholder="TG-LOM 2019 M 908" required /></Field>
        <Field label="NIF *"><Input value={f.nif} onChange={(e) => set('nif', e.target.value)} placeholder="1001134806" required /></Field>
        <Field label="Contact commercial *"><Input value={f.contactCommercial} onChange={(e) => set('contactCommercial', e.target.value)} placeholder="+228 …" required /></Field>
        <Field label="Contact technique *"><Input value={f.contactTechnique} onChange={(e) => set('contactTechnique', e.target.value)} placeholder="+228 …" required /></Field>
      </div>
      <div className="mt-3">
        <Field label="Logo (optionnel — en-tête des fiches de validation)">
          <div className="flex items-center gap-3">
            {(logoPreview || f.logoPath) && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logoPreview ?? societe.logoUrl ?? undefined} alt="logo" className="h-12 w-auto rounded border border-gray-100 object-contain" />
            )}
            <input type="file" accept="image/png,image/jpeg" onChange={(e) => { const file = e.target.files?.[0]; if (file) uploadLogo(file); }} className="text-xs" />
            {uploading && <span className="text-xs text-gray-400">Envoi…</span>}
          </div>
        </Field>
      </div>
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      {saved && !error && (
        <p className="mt-3 flex items-center gap-1.5 text-sm text-green-700"><CheckCircle2 size={15} /> Fiche enregistrée.</p>
      )}
      <div className="mt-4 flex justify-end">
        <Button type="submit" loading={save.isPending}>Enregistrer</Button>
      </div>
    </form>
  );
}
