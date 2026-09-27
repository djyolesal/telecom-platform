'use client';

import { useState } from 'react';
import { useSession } from 'next-auth/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, FileText, RefreshCw, ClipboardCheck } from 'lucide-react';
import { api } from '@/lib/api';
import { downloadFileNommeParServeur } from '@/lib/download';
import { PageHeader } from '@/components/shared/PageHeader';
import { Loading, EmptyState } from '@/components/shared/states';
import { Button } from '@/components/shared/Button';

interface RapportPublie {
  id: string;
  mois: string;
  contrat: string;
  reference: string;
  tailleOctets: number;
  nbSites: number;
  nbInterventions: number;
  genereLe: string;
  avecFiche: boolean;
  lot: { id: string; code: string; nom: string; region: string | null };
  prestataire: { id: string; nom: string };
}

const MOIS_FR = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const libelleMois = (mois: string) => {
  const [a, m] = mois.split('-').map(Number);
  return `${MOIS_FR[m - 1] ?? mois} ${a}`;
};
const poids = (o: number) => (o >= 1048576 ? `${(o / 1048576).toFixed(1).replace('.', ',')} Mo` : `${Math.round(o / 1024)} Ko`);

/**
 * RAPPORTS PUBLIÉS : le dernier mois en haut, un bloc par mois.
 *
 * Remplace l'envoi par e-mail, qui ne passait pas - dix mégaoctets de pièce
 * jointe et des relais qui refusent sans prévenir. Chacun vient chercher le
 * document de SON périmètre : le serveur limite un compte prestataire à ses
 * propres lots.
 */
export default function RapportsPubliesPage() {
  const { data: session } = useSession();
  const role = (session?.user as { role?: string })?.role ?? '';
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');

  const { data: rapports, isLoading } = useQuery({
    queryKey: ['rapports-publies'],
    queryFn: () => api.get('/rapports-mensuels').then((r) => r.data.data as RapportPublie[]),
  });

  const telecharger = async (r: RapportPublie, fiche = false) => {
    setBusy(`${r.id}${fiche ? '-f' : ''}`);
    try {
      await downloadFileNommeParServeur(
        `/rapports-mensuels/${r.id}/pdf${fiche ? '?piece=fiche' : ''}`,
        `${fiche ? 'fiche-validation' : 'rapport-activite'}-${r.lot.code}-${r.mois}.pdf`,
        120_000,
      );
    } finally {
      setBusy('');
    }
  };

  const publier = async () => {
    setMessage(''); setBusy('publier');
    try {
      const { data } = await api.get('/rapports-mensuels/mois-par-defaut');
      const mois = window.prompt('Mois à publier (AAAA-MM)', data.data.mois);
      if (!mois) { setBusy(''); return; }
      await api.post('/rapports-mensuels/publier', { mois }, { timeout: 180_000 });
      setMessage(`Publication de ${libelleMois(mois)} lancée. Les rapports apparaissent au fur et à mesure - actualisez dans quelques minutes.`);
    } catch (e) {
      const r = (e as { response?: { data?: { error?: string } } }).response;
      setMessage(r?.data?.error ?? 'Publication impossible.');
    } finally {
      setBusy('');
    }
  };

  if (isLoading) return <Loading />;
  const liste = rapports ?? [];
  const parMois = [...new Set(liste.map((r) => r.mois))];

  return (
    <div>
      <PageHeader
        title="Rapports mensuels publiés"
        subtitle="Rapport d'activité et fiche de validation, par lot et par mois"
        backHref="/rapports"
        actions={role === 'ADMIN' ? (
          <Button variant="secondary" icon={RefreshCw} loading={busy === 'publier'} onClick={publier}>
            Publier un mois
          </Button>
        ) : undefined}
      />

      {message && (
        <div className="mb-4 rounded-lg border border-blue-200 bg-blue-50 px-4 py-2.5 text-sm text-blue-800">{message}</div>
      )}

      {!liste.length ? (
        <EmptyState
          title="Aucun rapport publié"
          hint="Les rapports du mois écoulé sont publiés automatiquement le 1er de chaque mois."
        />
      ) : (
        parMois.map((mois) => (
          <div key={mois} className="mb-8">
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500">{libelleMois(mois)}</h2>
            <div className="divide-y divide-gray-50 rounded-xl border border-gray-100 bg-white">
              {liste.filter((r) => r.mois === mois).map((r) => (
                <div key={r.id} className="flex flex-wrap items-center gap-3 p-4">
                  <div className="min-w-[220px] flex-1">
                    <p className="text-sm font-medium text-gray-800">
                      {r.lot.code} - {r.lot.nom}
                      {r.contrat === 'SOLAIRE' && (
                        <span className="ml-2 rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-bold text-amber-700">SOLAIRE</span>
                      )}
                    </p>
                    <p className="text-xs text-gray-500">
                      {r.prestataire.nom} · {r.nbSites} site(s) · {r.nbInterventions} intervention(s) · {poids(r.tailleOctets)}
                    </p>
                  </div>
                  <Button variant="secondary" icon={FileText} loading={busy === r.id} onClick={() => telecharger(r)}>
                    Rapport
                  </Button>
                  {r.avecFiche && (
                    <Button variant="secondary" icon={ClipboardCheck} loading={busy === `${r.id}-f`} onClick={() => telecharger(r, true)}>
                      Fiche
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
