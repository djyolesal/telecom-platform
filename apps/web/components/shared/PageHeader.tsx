'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { cleRetour } from '@/lib/hooks/useFiltresUrl';

/**
 * En-tête de page. Le bouton « Retour » est UNIVERSEL : backHref explicite
 * quand la page a un parent naturel (fiche → liste), sinon retour navigateur
 * (page précédente) - beaucoup de pages sont atteignables depuis plusieurs
 * endroits (menu, hub Rapports, liens croisés), le retour doit suivre le
 * chemin réellement emprunté. Masqué seulement s'il n'y a aucun historique
 * (onglet ouvert directement sur la page).
 */
export function PageHeader({
  title,
  subtitle,
  backHref,
  actions,
}: {
  title: string;
  subtitle?: string;
  backHref?: string;
  actions?: React.ReactNode;
}) {
  const router = useRouter();
  const [aHistorique, setAHistorique] = useState(false);
  useEffect(() => { setAHistorique(window.history.length > 1); }, []);

  // Retour vers une liste FILTRÉE : la liste a noté sa dernière adresse (voir
  // useFiltresUrl). Sans cela, « Retour » ramenait à la liste vierge et le
  // filtre était perdu — alors que le bouton du navigateur, lui, le gardait.
  const [cible, setCible] = useState(backHref);
  useEffect(() => {
    setCible(backHref);
    if (!backHref) return;
    try {
      const memo = sessionStorage.getItem(cleRetour(backHref));
      // Garde-fou : on ne suit que ce qui mène bien à CETTE liste.
      if (memo && (memo === backHref || memo.startsWith(`${backHref}?`))) setCible(memo);
    } catch { /* stockage indisponible : lien nu, comportement d'avant */ }
  }, [backHref]);

  const cls = 'inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 mb-1';
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
      <div className="min-w-0">
        {backHref ? (
          <Link href={cible ?? backHref} className={cls}>
            <ArrowLeft size={14} /> Retour
          </Link>
        ) : aHistorique ? (
          <button type="button" onClick={() => router.back()} className={cls}>
            <ArrowLeft size={14} /> Retour
          </button>
        ) : null}
        <h1 className="text-xl font-bold text-gray-800 truncate">{title}</h1>
        {subtitle && <p className="text-sm text-gray-500 mt-0.5">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2 sm:flex-shrink-0">{actions}</div>}
    </div>
  );
}
