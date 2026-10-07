'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link2, Link2Off, Search } from 'lucide-react';
import { api } from '@/lib/api';
import { fmtNumber } from '@/lib/utils';
import { LIBELLES_SOURCE_CUVE } from '@/lib/cuve';
import { Button } from '@/components/shared/Button';
import { Loading } from '@/components/shared/states';
import { ModeleCuve, SitePourModele } from './types';

type Vue = 'equipes' | 'candidats' | 'tous';

/**
 * Sites d'un modèle et affectation EN MASSE. « Candidats » = sites sans modèle
 * dont la capacité est celle du modèle : la population la plus probable, mais
 * pas une preuve (deux cuves de 2000 L peuvent avoir des barèmes différents).
 */
export function SitesDuModele({ modele, modeles }: { modele: ModeleCuve; modeles: ModeleCuve[] }) {
  const queryClient = useQueryClient();
  const [vue, setVue] = useState<Vue>(modele.nbSites > 0 ? 'equipes' : 'candidats');
  const [recherche, setRecherche] = useState('');
  const [region, setRegion] = useState('');
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState<{ ok: boolean; texte: string } | null>(null);

  const { data: sites, isLoading } = useQuery({
    queryKey: ['modeles-cuve-sites'],
    queryFn: () => api.get('/modeles-cuve/sites').then((r) => r.data.data as SitePourModele[]),
  });
  const nomModele = useMemo(() => new Map(modeles.map((m) => [m.id, m.nom])), [modeles]);

  const parVue = useMemo(() => {
    const tous = sites ?? [];
    return {
      equipes: tous.filter((s) => s.modeleCuveId === modele.id),
      candidats: tous.filter((s) => !s.modeleCuveId && s.capaciteLitres === modele.capaciteLitres),
      tous,
    };
  }, [sites, modele.id, modele.capaciteLitres]);
  const regions = useMemo(() => [...new Set((sites ?? []).map((s) => s.region))].sort(), [sites]);

  const visibles = parVue[vue].filter((s) =>
    (!region || s.region === region) && (!recherche || s.nom.toLowerCase().includes(recherche.trim().toLowerCase())));
  const choisis = visibles.filter((s) => selection.has(s.id));
  const aRattacher = choisis.filter((s) => s.modeleCuveId !== modele.id);
  const aDetacher = choisis.filter((s) => s.modeleCuveId === modele.id);

  const affecter = useMutation({
    mutationFn: (p: { modeleId: string | null; siteIds: string[] }) => api.post('/admin/modeles-cuve/affectation', p),
    onSuccess: (r, p) => {
      const n = r.data.data.sites as number;
      setMessage({ ok: true, texte: p.modeleId ? `${n} site(s) rattaché(s) à « ${modele.nom} ».` : `${n} site(s) détaché(s).` });
      setSelection(new Set());
      queryClient.invalidateQueries({ queryKey: ['modeles-cuve-sites'] });
      queryClient.invalidateQueries({ queryKey: ['modeles-cuve'] });
      queryClient.invalidateQueries({ queryKey: ['modele-cuve', modele.id] });
    },
    onError: (e: { response?: { data?: { error?: string } } }) => setMessage({ ok: false, texte: e.response?.data?.error || 'Erreur' }),
  });

  const basculer = (id: string) => setSelection((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });
  const toutVisible = visibles.length > 0 && visibles.every((s) => selection.has(s.id));
  const basculerTout = () => setSelection((s) => {
    const n = new Set(s);
    for (const v of visibles) { if (toutVisible) n.delete(v.id); else n.add(v.id); }
    return n;
  });

  const rattacher = () => {
    const autres = aRattacher.filter((s) => s.modeleCuveId).length;
    const ecart = aRattacher.filter((s) => s.capaciteLitres != null && s.capaciteLitres !== modele.capaciteLitres).length;
    const avert = [
      autres ? `${autres} site(s) changent de modèle.` : '',
      ecart ? `${ecart} site(s) ont une autre capacité : elle deviendra ${fmtNumber(modele.capaciteLitres)} L.` : '',
    ].filter(Boolean).join('\n');
    if (confirm(`Rattacher ${aRattacher.length} site(s) à « ${modele.nom} » ?${avert ? `\n\n${avert}` : ''}`)) {
      affecter.mutate({ modeleId: modele.id, siteIds: aRattacher.map((s) => s.id) });
    }
  };
  const detacher = () => {
    if (confirm(`Détacher ${aDetacher.length} site(s) de « ${modele.nom} » ? Leur capacité reste ${fmtNumber(modele.capaciteLitres)} L ; leur conversion redevient celle de leur fiche.`)) {
      affecter.mutate({ modeleId: null, siteIds: aDetacher.map((s) => s.id) });
    }
  };

  if (isLoading) return <Loading />;

  const onglet = (v: Vue, libelle: string) => (
    <button type="button" onClick={() => { setVue(v); setSelection(new Set()); }}
      className={`rounded-full px-3 py-1 text-xs font-medium ${vue === v ? 'bg-[rgb(var(--brand))] text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
      {libelle} ({fmtNumber(parVue[v].length)})
    </button>
  );

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {onglet('equipes', 'Équipés de ce modèle')}
        {onglet('candidats', `Sans modèle, ${fmtNumber(modele.capaciteLitres)} L`)}
        {onglet('tous', 'Tous les sites')}
      </div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={recherche} onChange={(e) => setRecherche(e.target.value)} placeholder="Rechercher un site"
            className="rounded-lg border border-gray-200 py-1.5 pl-8 pr-3 text-sm outline-none focus:border-[rgb(var(--brand-light))]" />
        </div>
        <select value={region} onChange={(e) => setRegion(e.target.value)}
          className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm outline-none focus:border-[rgb(var(--brand-light))]">
          <option value="">Toutes les régions</option>
          {regions.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        <div className="ml-auto flex flex-wrap gap-2">
          {modele.isActive && (
            <Button type="button" icon={Link2} disabled={!aRattacher.length} loading={affecter.isPending && affecter.variables?.modeleId != null} onClick={rattacher}>
              Rattacher ({aRattacher.length})
            </Button>
          )}
          <Button type="button" variant="secondary" icon={Link2Off} disabled={!aDetacher.length} loading={affecter.isPending && affecter.variables?.modeleId == null} onClick={detacher}>
            Détacher ({aDetacher.length})
          </Button>
        </div>
      </div>

      {message && (
        <div className={`mb-3 rounded-lg border px-3 py-2 text-sm ${message.ok ? 'border-green-200 bg-green-50 text-green-800' : 'border-red-200 bg-red-50 text-red-700'}`}>
          {message.texte}
        </div>
      )}

      {visibles.length === 0 ? (
        <p className="rounded-xl border border-dashed border-gray-200 p-6 text-center text-sm text-gray-400">Aucun site dans cette vue.</p>
      ) : (
        <div className="max-h-[32rem] overflow-auto rounded-xl border border-gray-100">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-gray-50 text-left text-xs text-gray-500">
              <tr>
                <th className="w-10 px-3 py-2"><input type="checkbox" checked={toutVisible} onChange={basculerTout} aria-label="Tout sélectionner" /></th>
                <th className="px-3 py-2 font-medium">Site</th>
                <th className="px-3 py-2 font-medium">Région</th>
                <th className="px-3 py-2 text-right font-medium">Capacité</th>
                <th className="px-3 py-2 font-medium">Modèle actuel</th>
                <th className="px-3 py-2 font-medium">Conversion</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {visibles.map((s) => (
                <tr key={s.id} className={selection.has(s.id) ? 'bg-[rgb(var(--brand-light)/0.06)]' : 'hover:bg-gray-50'}>
                  <td className="px-3 py-2"><input type="checkbox" checked={selection.has(s.id)} onChange={() => basculer(s.id)} aria-label={`Sélectionner ${s.nom}`} /></td>
                  <td className="px-3 py-2 font-medium text-gray-800">{s.nom}{s.sansGE && <span className="ml-1.5 text-[11px] font-normal text-gray-400">sans GE</span>}</td>
                  <td className="px-3 py-2 text-gray-500">{s.region}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-gray-700">{s.capaciteLitres != null ? `${fmtNumber(s.capaciteLitres)} L` : '-'}</td>
                  <td className="px-3 py-2 text-gray-600">{s.modeleCuveId ? nomModele.get(s.modeleCuveId) ?? '?' : <span className="text-gray-300">aucun</span>}</td>
                  <td className="px-3 py-2 text-xs">
                    {s.source
                      ? <span className="text-green-700">{LIBELLES_SOURCE_CUVE[s.source]}</span>
                      : <span className="text-amber-700">non calculable</span>}
                    {s.source === 'BAREME_SITE' && s.modeleCuveId && (
                      <span className="block text-[11px] text-gray-400">prioritaire sur le modèle</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-2 text-xs text-gray-400">
        Les sites listés ont un groupe électrogène ou une cuve. La capacité d&apos;un site rattaché devient celle du modèle ;
        les sites à deux cuves ne se rattachent pas.
      </p>
    </div>
  );
}
