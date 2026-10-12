'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link2 } from 'lucide-react';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';

interface Saisie {
  cle: string;
  textes: string[];
  occurrences: number;
  sites: number;
  derniere: string | null;
  suggestion: { id: string; libelle: string } | null;
}

/**
 * SAISIES HORS CATALOGUE : ce que le terrain a tapé et que le rapprochement
 * n'a pas reconnu, regroupé (les variantes d'un même texte comptent une fois).
 * « Rattacher » ajoute ces graphies en SYNONYMES de la pièce choisie et
 * rattache tout l'historique - la même graphie sera reconnue seule ensuite.
 */
export function SaisiesHorsCatalogue({ pieces }: { pieces: Array<{ id: string; libelle: string; actif: boolean }> }) {
  const queryClient = useQueryClient();
  const [choix, setChoix] = useState<Record<string, string>>({});

  const { data, isLoading } = useQuery({
    queryKey: ['pieces-hors-catalogue'],
    queryFn: () => api.get('/admin/pieces-ref/hors-catalogue').then((r) => r.data.data as Saisie[]),
  });
  const rattacher = useMutation({
    mutationFn: (p: { pieceId: string; textes: string[] }) =>
      api.post(`/admin/pieces-ref/${p.pieceId}/rattacher`, { textes: p.textes }).then((r) => r.data.data as { rapprochees: number }),
    onSuccess: (r) => {
      toast(`${r.rapprochees} saisie(s) rattachée(s) ; la graphie est désormais reconnue.`, 'success');
      queryClient.invalidateQueries({ queryKey: ['pieces-hors-catalogue'] });
      queryClient.invalidateQueries({ queryKey: ['pieces-ref-admin'] });
    },
    onError: (e: { response?: { data?: { error?: string } } }) => toast(e.response?.data?.error || 'Rattachement impossible', 'error'),
  });

  const actives = pieces.filter((p) => p.actif).sort((a, b) => a.libelle.localeCompare(b.libelle));
  const saisies = data ?? [];
  if (isLoading || !saisies.length) return null;
  const total = saisies.reduce((s, x) => s + x.occurrences, 0);

  return (
    <section className="mb-4 rounded-xl border border-amber-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-gray-800">
        Saisies hors catalogue <span className="font-normal text-gray-500">({saisies.length} texte(s), {total} saisie(s))</span>
      </h2>
      <p className="mb-3 mt-0.5 text-xs text-gray-500">
        Pièces tapées par le terrain sans correspondance au catalogue. Choisissez la bonne pièce puis « Rattacher » : le texte
        devient un synonyme, tout l&apos;historique se rattache, et la même saisie sera reconnue seule la prochaine fois.
      </p>
      <div className="max-h-[28rem] overflow-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-white text-left text-xs text-gray-500">
            <tr>
              <th className="py-1.5 pr-3 font-medium">Saisi par le terrain</th>
              <th className="py-1.5 pr-3 text-right font-medium">Fois</th>
              <th className="py-1.5 pr-3 text-right font-medium">Sites</th>
              <th className="py-1.5 pr-3 font-medium">Pièce du catalogue</th>
              <th />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {saisies.map((x) => {
              const valeur = choix[x.cle] ?? x.suggestion?.id ?? '';
              return (
                <tr key={x.cle}>
                  <td className="py-1.5 pr-3">
                    <span className="font-medium text-gray-800">{x.textes[0]}</span>
                    {x.textes.length > 1 && (
                      <span className="ml-1 text-xs text-gray-400" title={x.textes.slice(1).join(' · ')}>+ {x.textes.length - 1} variante(s)</span>
                    )}
                  </td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">{x.occurrences}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums text-gray-500">{x.sites}</td>
                  <td className="py-1.5 pr-3">
                    <select value={valeur} onChange={(e) => setChoix((c) => ({ ...c, [x.cle]: e.target.value }))}
                      className={`w-full max-w-xs rounded-lg border px-2 py-1 text-sm outline-none focus:border-[rgb(var(--brand-light))] ${valeur && valeur === x.suggestion?.id && !choix[x.cle] ? 'border-amber-300 bg-amber-50' : 'border-gray-200'}`}>
                      <option value="">Choisir la pièce…</option>
                      {actives.map((p) => <option key={p.id} value={p.id}>{p.libelle}</option>)}
                    </select>
                    {valeur && valeur === x.suggestion?.id && !choix[x.cle] && (
                      <span className="block text-[11px] text-amber-700">suggestion - à confirmer</span>
                    )}
                  </td>
                  <td className="py-1.5 text-right">
                    <button type="button" disabled={!valeur || rattacher.isPending}
                      onClick={() => rattacher.mutate({ pieceId: valeur, textes: x.textes.slice(0, 20) })}
                      className="inline-flex items-center gap-1 rounded-lg bg-[rgb(var(--brand))] px-2.5 py-1 text-xs font-medium text-white hover:bg-[rgb(var(--brand-light))] disabled:opacity-40">
                      <Link2 size={12} /> Rattacher
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
