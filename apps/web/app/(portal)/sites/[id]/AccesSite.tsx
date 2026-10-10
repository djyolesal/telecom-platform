'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, Plus } from 'lucide-react';
import { api } from '@/lib/api';
import { Button } from '@/components/shared/Button';
import { Input } from '@/components/shared/Form';

interface Periode {
  id: string;
  debutLe: string;
  finLe: string | null;
  motif: string;
  createdAt: string;
  auteur: { nom: string; prenom: string } | null;
}

const jour = (d: string) => new Date(d).toLocaleDateString('fr-FR', { timeZone: 'UTC' });
const aujourdhui = () => new Date().toISOString().slice(0, 10);

/**
 * ACCÈS AU SITE : périodes où le site est inaccessible à la maintenance (route
 * coupée, crue…). Les tâches restent dues ; non réalisées sur un mois couvert,
 * elles sont JUSTIFIÉES dans les rapports (ni retard ni pénalité). Déclarées au
 * cas par cas par un manager ou un admin ; « Accès rétabli » clôt la période.
 */
export function AccesSite({ siteId, peutDeclarer }: { siteId: string; peutDeclarer: boolean }) {
  const queryClient = useQueryClient();
  const [ouvert, setOuvert] = useState(false);
  const [form, setForm] = useState({ debutLe: aujourdhui(), finLe: '', motif: '' });
  const [erreur, setErreur] = useState('');

  const { data: periodes } = useQuery({
    queryKey: ['inaccessibilites', siteId],
    queryFn: () => api.get(`/sites/${siteId}/inaccessibilites`).then((r) => r.data.data as Periode[]),
  });
  const rafraichir = () => queryClient.invalidateQueries({ queryKey: ['inaccessibilites', siteId] });
  const surErreur = (e: { response?: { data?: { error?: string } } }) => setErreur(e.response?.data?.error || 'Erreur');

  const declarer = useMutation({
    mutationFn: () => api.post(`/sites/${siteId}/inaccessibilites`, { ...form, finLe: form.finLe || null }),
    onSuccess: () => { rafraichir(); setOuvert(false); setErreur(''); setForm({ debutLe: aujourdhui(), finLe: '', motif: '' }); },
    onError: surErreur,
  });
  const clore = useMutation({
    mutationFn: (id: string) => api.put(`/inaccessibilites/${id}`, { finLe: aujourdhui() }),
    onSuccess: () => { rafraichir(); setErreur(''); },
    onError: surErreur,
  });
  const supprimer = useMutation({
    mutationFn: (id: string) => api.delete(`/inaccessibilites/${id}`),
    onSuccess: () => { rafraichir(); setErreur(''); },
    onError: surErreur,
  });

  const liste = periodes ?? [];
  const now = aujourdhui();
  const enCours = liste.find((p) => p.debutLe.slice(0, 10) <= now && (!p.finLe || p.finLe.slice(0, 10) >= now));
  if (!liste.length && !peutDeclarer) return null;

  return (
    <div className={`mb-6 rounded-xl border bg-white p-4 ${enCours ? 'border-amber-300' : 'border-gray-100'}`}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-gray-700"><Ban size={15} /> Accès au site</h3>
        {peutDeclarer && !ouvert && (
          <Button type="button" variant="secondary" icon={Plus} onClick={() => setOuvert(true)}>Déclarer une période d&apos;inaccessibilité</Button>
        )}
      </div>

      {enCours && (
        <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <b>Site inaccessible</b> depuis le {jour(enCours.debutLe)}{enCours.finLe ? `, jusqu'au ${jour(enCours.finLe)}` : ' (accès non rétabli)'} : {enCours.motif}.
          Les tâches non réalisées pendant cette période sont justifiées dans les rapports.
        </p>
      )}

      {erreur && <p className="mb-2 text-sm text-red-600">{erreur}</p>}

      {ouvert && (
        <form onSubmit={(e) => { e.preventDefault(); declarer.mutate(); }}
          className="mb-3 grid gap-2 rounded-lg border border-gray-100 bg-gray-50 p-3 sm:grid-cols-[9.5rem_9.5rem_1fr_auto] sm:items-end">
          <label className="text-xs text-gray-600">Du
            <Input type="date" value={form.debutLe} onChange={(e) => setForm((f) => ({ ...f, debutLe: e.target.value }))} required />
          </label>
          <label className="text-xs text-gray-600">Au (vide si en cours)
            <Input type="date" value={form.finLe} min={form.debutLe} onChange={(e) => setForm((f) => ({ ...f, finLe: e.target.value }))} />
          </label>
          <label className="text-xs text-gray-600">Motif
            <Input value={form.motif} maxLength={300} onChange={(e) => setForm((f) => ({ ...f, motif: e.target.value }))}
              placeholder="ex. Route coupée par la crue, pont effondré" required />
          </label>
          <div className="flex gap-2">
            <Button type="submit" loading={declarer.isPending}>Enregistrer</Button>
            <Button type="button" variant="ghost" onClick={() => { setOuvert(false); setErreur(''); }}>Annuler</Button>
          </div>
        </form>
      )}

      {liste.length === 0 ? (
        <p className="text-sm text-gray-400">Aucune période d&apos;inaccessibilité déclarée.</p>
      ) : (
        <ul className="divide-y divide-gray-50 text-sm">
          {liste.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-1.5">
              <span className="font-medium text-gray-800">
                du {jour(p.debutLe)} {p.finLe ? `au ${jour(p.finLe)}` : <span className="text-amber-700">(en cours)</span>}
              </span>
              <span className="flex-1 text-gray-600">{p.motif}</span>
              {p.auteur && <span className="text-xs text-gray-400">déclarée par {p.auteur.prenom} {p.auteur.nom}</span>}
              {peutDeclarer && !p.finLe && (
                <button type="button" onClick={() => clore.mutate(p.id)} className="text-xs font-medium text-[rgb(var(--brand-light))] hover:underline">
                  Accès rétabli aujourd&apos;hui
                </button>
              )}
              {peutDeclarer && (
                <button type="button"
                  onClick={() => { if (confirm('Supprimer cette période ? Les rapports des mois concernés se recalculeront sans elle.')) supprimer.mutate(p.id); }}
                  className="text-xs text-gray-400 hover:text-red-600">Supprimer</button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
