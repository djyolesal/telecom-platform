'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ChevronRight, Plus } from 'lucide-react';
import { api } from '@/lib/api';
import { fmtNumber } from '@/lib/utils';
import { FORMES_CUVE } from '@/lib/constants';
import { PageHeader } from '@/components/shared/PageHeader';
import { Button } from '@/components/shared/Button';
import { Field, Input, Select } from '@/components/shared/Form';
import { Loading, ErrorState, EmptyState } from '@/components/shared/states';
import { ModeleCuve, libelleConversion } from './types';

/**
 * Référentiel des modèles de cuve : une catégorie de cuves identiques (même
 * barème de jaugeage) saisie une fois, puis attribuée aux sites qui en sont
 * équipés. Corriger le barème d'un modèle le corrige sur tous ses sites.
 */
export default function ModelesCuvePage() {
  const router = useRouter();
  const [ajout, setAjout] = useState(false);
  const [nouveau, setNouveau] = useState({ nom: '', capaciteLitres: '', formeCuve: 'CYLINDRE_COUCHE' });
  const [error, setError] = useState('');

  const { data, isLoading, isError } = useQuery({
    queryKey: ['modeles-cuve'],
    queryFn: () => api.get('/modeles-cuve').then((r) => r.data.data as ModeleCuve[]),
  });

  const creer = useMutation({
    mutationFn: () => api.post('/admin/modeles-cuve', {
      nom: nouveau.nom, capaciteLitres: Number(nouveau.capaciteLitres), formeCuve: nouveau.formeCuve || null,
    }),
    onSuccess: (r) => router.push(`/administration/modeles-cuve/${r.data.data.id}`),
    onError: (e: { response?: { data?: { error?: string } } }) => setError(e.response?.data?.error || 'Erreur'),
  });

  if (isLoading) return <Loading />;
  if (isError) return <ErrorState />;
  const modeles = data ?? [];

  return (
    <div>
      <PageHeader
        title="Modèles de cuve"
        subtitle="Un barème par catégorie de cuves, partagé par tous les sites qui en sont équipés"
        backHref="/administration"
        actions={!ajout && <Button icon={Plus} onClick={() => setAjout(true)}>Ajouter un modèle</Button>}
      />

      {error && <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">{error}</div>}

      {ajout && (
        <form
          onSubmit={(e) => { e.preventDefault(); setError(''); creer.mutate(); }}
          className="mb-4 grid gap-3 rounded-xl border border-gray-100 bg-white p-4 sm:grid-cols-[1fr_10rem_12rem_auto] sm:items-end"
        >
          <Field label="Nom" required>
            <Input value={nouveau.nom} onChange={(e) => setNouveau((f) => ({ ...f, nom: e.target.value }))} placeholder="Cuve 1000 L" maxLength={60} required autoFocus />
          </Field>
          <Field label="Capacité (L)" required>
            <Input type="number" min="1" step="1" value={nouveau.capaciteLitres} onChange={(e) => setNouveau((f) => ({ ...f, capaciteLitres: e.target.value }))} required />
          </Field>
          <Field label="Forme">
            <Select value={nouveau.formeCuve} onChange={(e) => setNouveau((f) => ({ ...f, formeCuve: e.target.value }))} options={FORMES_CUVE} placeholder="Non précisée" />
          </Field>
          <div className="flex gap-2">
            <Button type="submit" loading={creer.isPending}>Créer</Button>
            <Button type="button" variant="ghost" onClick={() => setAjout(false)}>Annuler</Button>
          </div>
        </form>
      )}

      {modeles.length === 0 ? (
        <EmptyState title="Aucun modèle" hint="Ajoutez un premier modèle de cuve." />
      ) : (
        <div className="divide-y divide-gray-50 rounded-xl border border-gray-100 bg-white">
          {modeles.map((m) => (
            <Link key={m.id} href={`/administration/modeles-cuve/${m.id}`} className="flex items-center gap-4 p-4 hover:bg-gray-50">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-gray-800">{m.nom}</span>
                  {!m.isActive && <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-500">Désactivé</span>}
                </div>
                <p className="mt-0.5 text-xs text-gray-500">
                  {fmtNumber(m.capaciteLitres)} L · {FORMES_CUVE.find((f) => f.value === m.formeCuve)?.label ?? 'forme non précisée'}
                  {m.description ? ` · ${m.description}` : ''}
                </p>
              </div>
              <div className="hidden text-right sm:block">
                <p className={`text-xs font-medium ${m.calculable ? 'text-green-700' : 'text-amber-700'}`}>{libelleConversion(m)}</p>
                {m.volumeMaxLitres != null && (
                  <p className="text-[11px] text-gray-400">plein : {fmtNumber(m.volumeMaxLitres)} L</p>
                )}
              </div>
              <div className="w-20 text-right">
                <p className="text-sm font-semibold text-gray-800">{fmtNumber(m.nbSites)}</p>
                <p className="text-[11px] text-gray-400">site{m.nbSites > 1 ? 's' : ''}</p>
              </div>
              <ChevronRight size={16} className="text-gray-300" />
            </Link>
          ))}
        </div>
      )}

      <p className="mt-3 text-xs text-gray-400">
        Un site rattaché à un modèle convertit les hauteurs avec le barème du modèle et prend sa capacité. Un barème saisi sur la
        fiche d&apos;un site reste prioritaire : c&apos;est le cas particulier d&apos;une cuve qui a son propre certificat.
      </p>
    </div>
  );
}
