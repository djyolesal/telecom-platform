'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Save, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { fmtNumber } from '@/lib/utils';
import { FORMES_CUVE } from '@/lib/constants';
import { litresPourHauteur, type ConfigCuve, type PointBaremage } from '@/lib/cuve';
import { PageHeader } from '@/components/shared/PageHeader';
import { Button } from '@/components/shared/Button';
import { Field, Input, Select } from '@/components/shared/Form';
import { Loading, ErrorState } from '@/components/shared/states';
import { ModeleCuve, libelleConversion } from '../types';
import { ImportBareme } from '../ImportBareme';
import { SitesDuModele } from '../SitesDuModele';

type Erreur = { response?: { data?: { error?: string } } };
const texte = (n: number | null) => (n != null ? String(n) : '');

/** Courbe hauteur → litres du barème : un coup d'œil suffit à voir un point aberrant. */
function Courbe({ points }: { points: PointBaremage[] }) {
  const L = 600; const H = 160; const m = 4;
  const hMax = points[points.length - 1].hauteurCm || 1;
  const vMax = Math.max(...points.map((p) => p.litres)) || 1;
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${(m + (p.hauteurCm / hMax) * (L - 2 * m)).toFixed(1)},${(H - m - (p.litres / vMax) * (H - 2 * m)).toFixed(1)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${L} ${H}`} className="h-40 w-full" preserveAspectRatio="none" role="img" aria-label="Courbe du barème">
      <line x1={m} y1={H - m} x2={L - m} y2={H - m} stroke="#e5e7eb" />
      <line x1={m} y1={m} x2={m} y2={H - m} stroke="#e5e7eb" />
      <path d={d} fill="none" stroke="rgb(var(--brand))" strokeWidth="2" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export default function ModeleCuvePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ nom: '', capaciteLitres: '', formeCuve: '', longueurCm: '', largeurCm: '', hauteurCm: '', diametreCm: '', description: '', isActive: true });
  const [hauteurTest, setHauteurTest] = useState('');
  const [message, setMessage] = useState<{ ok: boolean; texte: string } | null>(null);

  const { data: modele, isLoading, isError } = useQuery({
    queryKey: ['modele-cuve', id],
    queryFn: () => api.get(`/modeles-cuve/${id}`).then((r) => r.data.data as ModeleCuve),
  });
  const { data: modeles } = useQuery({
    queryKey: ['modeles-cuve'],
    queryFn: () => api.get('/modeles-cuve').then((r) => r.data.data as ModeleCuve[]),
  });

  useEffect(() => {
    if (!modele) return;
    setForm({
      nom: modele.nom, capaciteLitres: String(modele.capaciteLitres), formeCuve: modele.formeCuve ?? '',
      longueurCm: texte(modele.longueurCm), largeurCm: texte(modele.largeurCm), hauteurCm: texte(modele.hauteurCm),
      diametreCm: texte(modele.diametreCm), description: modele.description ?? '', isActive: modele.isActive,
    });
  }, [modele]);

  const rafraichir = () => {
    queryClient.invalidateQueries({ queryKey: ['modele-cuve', id] });
    queryClient.invalidateQueries({ queryKey: ['modeles-cuve'] });
    queryClient.invalidateQueries({ queryKey: ['modeles-cuve-sites'] });
  };
  const erreur = (e: Erreur) => setMessage({ ok: false, texte: e.response?.data?.error || 'Erreur' });

  const enregistrer = useMutation({
    mutationFn: () => api.put(`/admin/modeles-cuve/${id}`, {
      nom: form.nom, capaciteLitres: Number(form.capaciteLitres), formeCuve: form.formeCuve || null,
      longueurCm: form.longueurCm || null, largeurCm: form.largeurCm || null,
      hauteurCm: form.hauteurCm || null, diametreCm: form.diametreCm || null,
      description: form.description, isActive: form.isActive,
    }),
    onSuccess: (r) => {
      const n = r.data.data.sitesMisAJour as number;
      setMessage({ ok: true, texte: n ? `Enregistré. Capacité reportée sur ${n} site(s).` : 'Enregistré.' });
      rafraichir();
    },
    onError: erreur,
  });
  const remplacerBareme = useMutation({
    mutationFn: (points: PointBaremage[]) => api.put(`/admin/modeles-cuve/${id}/baremage`, { points }),
    onSuccess: (r) => {
      const { points, sitesConcernes } = r.data.data as { points: number; sitesConcernes: number };
      setMessage({ ok: true, texte: points ? `Barème enregistré : ${points} points, appliqué à ${sitesConcernes} site(s).` : 'Barème effacé.' });
      rafraichir();
    },
    onError: erreur,
  });
  const supprimer = useMutation({
    mutationFn: () => api.delete(`/admin/modeles-cuve/${id}`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['modeles-cuve'] }); router.push('/administration/modeles-cuve'); },
    onError: erreur,
  });

  const config: ConfigCuve = useMemo(() => ({
    formeCuve: (modele?.formeCuve ?? null) as ConfigCuve['formeCuve'],
    cuveLongueurCm: modele?.longueurCm, cuveLargeurCm: modele?.largeurCm,
    cuveHauteurCm: modele?.hauteurCm, cuveDiametreCm: modele?.diametreCm,
    baremage: modele?.baremage ?? [],
  }), [modele]);

  if (isLoading) return <Loading />;
  if (isError || !modele) return <ErrorState message="Modèle introuvable" />;

  const set = (k: keyof typeof form, v: string | boolean) => setForm((f) => ({ ...f, [k]: v }));
  const capaciteChangee = Number(form.capaciteLitres) !== modele.capaciteLitres;
  const litresTest = hauteurTest ? litresPourHauteur(config, Number(hauteurTest.replace(',', '.'))) : null;
  const points = modele.baremage ?? [];

  return (
    <div>
      <PageHeader title={modele.nom} subtitle={`${fmtNumber(modele.capaciteLitres)} L · ${libelleConversion(modele)} · ${fmtNumber(modele.nbSites)} site(s)`} backHref="/administration/modeles-cuve" />

      {message && (
        <div className={`mb-4 rounded-lg border px-4 py-2.5 text-sm ${message.ok ? 'border-green-200 bg-green-50 text-green-800' : 'border-red-200 bg-red-50 text-red-700'}`}>
          {message.texte}
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-2">
        <section className="rounded-xl border border-gray-100 bg-white p-5">
          <h2 className="mb-4 text-sm font-semibold text-gray-800">Caractéristiques</h2>
          <form
            onSubmit={(e) => {
              e.preventDefault(); setMessage(null);
              if (capaciteChangee && modele.nbSites > 0
                && !confirm(`La capacité de ${modele.nbSites} site(s) passera à ${fmtNumber(Number(form.capaciteLitres))} L. Continuer ?`)) return;
              enregistrer.mutate();
            }}
            className="grid gap-3 sm:grid-cols-2"
          >
            <Field label="Nom" required><Input value={form.nom} onChange={(e) => set('nom', e.target.value)} maxLength={60} required /></Field>
            <Field label="Capacité nominale (L)" required hint="Celle de la plaque : elle devient la capacité des sites du modèle.">
              <Input type="number" min="1" step="1" value={form.capaciteLitres} onChange={(e) => set('capaciteLitres', e.target.value)} required />
            </Field>
            <Field label="Forme">
              <Select value={form.formeCuve} onChange={(e) => set('formeCuve', e.target.value)} options={FORMES_CUVE} placeholder="Non précisée" />
            </Field>
            <div />
            {form.formeCuve === 'CYLINDRE_COUCHE' && (
              <>
                <Field label="Diamètre intérieur (cm)"><Input type="number" step="0.1" value={form.diametreCm} onChange={(e) => set('diametreCm', e.target.value)} /></Field>
                <Field label="Longueur intérieure (cm)"><Input type="number" step="0.1" value={form.longueurCm} onChange={(e) => set('longueurCm', e.target.value)} /></Field>
              </>
            )}
            {form.formeCuve === 'RECTANGULAIRE' && (
              <>
                <Field label="Longueur intérieure (cm)"><Input type="number" step="0.1" value={form.longueurCm} onChange={(e) => set('longueurCm', e.target.value)} /></Field>
                <Field label="Largeur intérieure (cm)"><Input type="number" step="0.1" value={form.largeurCm} onChange={(e) => set('largeurCm', e.target.value)} /></Field>
                <Field label="Hauteur intérieure (cm)"><Input type="number" step="0.1" value={form.hauteurCm} onChange={(e) => set('hauteurCm', e.target.value)} /></Field>
              </>
            )}
            <Field label="Comment la reconnaître" className="sm:col-span-2">
              <Input value={form.description} onChange={(e) => set('description', e.target.value)} maxLength={300} placeholder="Plaque, forme, couleur…" />
            </Field>
            <label className="inline-flex items-center gap-2 text-sm text-gray-700 sm:col-span-2">
              <input type="checkbox" checked={form.isActive} onChange={(e) => set('isActive', e.target.checked)} />
              Actif (proposé à l&apos;attribution ; un modèle désactivé reste sur les sites qui le portent)
            </label>
            {points.length >= 2 && (form.formeCuve || form.diametreCm || form.longueurCm) && (
              <p className="text-xs text-gray-400 sm:col-span-2">Ce modèle a un barème : les dimensions ne servent que s&apos;il est effacé.</p>
            )}
            <div className="flex flex-wrap gap-2 sm:col-span-2">
              <Button type="submit" icon={Save} loading={enregistrer.isPending}>Enregistrer</Button>
              {modele.nbSites === 0 && (
                <Button type="button" variant="ghost" icon={Trash2} loading={supprimer.isPending}
                  onClick={() => { if (confirm(`Supprimer « ${modele.nom} » ?`)) supprimer.mutate(); }}>
                  Supprimer
                </Button>
              )}
            </div>
          </form>
        </section>

        <section className="rounded-xl border border-gray-100 bg-white p-5">
          <h2 className="mb-1 text-sm font-semibold text-gray-800">Conversion hauteur → litres</h2>
          {modele.calculable ? (
            <>
              <p className="mb-3 text-xs text-gray-500">
                {libelleConversion(modele)}
                {points.length >= 2 && ` · de ${fmtNumber(points[0].hauteurCm)} à ${fmtNumber(modele.hauteurMaxCm)} cm`}
                {` · plein : ${fmtNumber(modele.volumeMaxLitres)} L`}
                {modele.ecartCapacitePct != null && (
                  <span className={Math.abs(modele.ecartCapacitePct) > 15 ? 'font-medium text-amber-700' : ''}>
                    {` (${modele.ecartCapacitePct > 0 ? '+' : ''}${fmtNumber(modele.ecartCapacitePct)} % de la capacité)`}
                  </span>
                )}
              </p>
              {points.length >= 2 && <Courbe points={points} />}
              <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
                <span className="text-gray-600">Tester :</span>
                <Input value={hauteurTest} onChange={(e) => setHauteurTest(e.target.value)} inputMode="decimal" placeholder="hauteur" className="w-28" />
                <span className="text-gray-500">cm</span>
                {litresTest != null && <span className="font-semibold text-gray-800">= {fmtNumber(litresTest)} L</span>}
              </div>
            </>
          ) : (
            <p className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              Non calculable : importez un barème, ou renseignez la forme et les dimensions intérieures. En attendant, ses sites
              gardent la conversion de leur propre fiche.
            </p>
          )}

          <details className="mt-4 rounded-lg border border-gray-100 p-3" open={!modele.calculable}>
            <summary className="cursor-pointer text-sm font-medium text-gray-700">
              {points.length ? 'Remplacer le barème' : 'Importer un barème'}
            </summary>
            <div className="mt-3">
              <ImportBareme enCours={remplacerBareme.isPending} onValider={(pts) => {
                setMessage(null);
                if (modele.nbSites === 0 || confirm(`Ce barème s'appliquera aux ${modele.nbSites} site(s) du modèle. Continuer ?`)) remplacerBareme.mutate(pts);
              }} />
              {points.length > 0 && (
                <button type="button" className="mt-3 text-xs font-medium text-red-600 hover:underline"
                  onClick={() => { if (confirm('Effacer le barème de ce modèle ?')) remplacerBareme.mutate([]); }}>
                  Effacer le barème
                </button>
              )}
            </div>
          </details>
        </section>
      </div>

      <section className="mt-4 rounded-xl border border-gray-100 bg-white p-5">
        <h2 className="mb-3 text-sm font-semibold text-gray-800">Sites</h2>
        <SitesDuModele modele={modele} modeles={modeles ?? [modele]} />
      </section>
    </div>
  );
}
