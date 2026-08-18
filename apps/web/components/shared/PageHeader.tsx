'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ArrowLeft } from 'lucide-react';

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

  const cls = 'inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 mb-1';
  return (
    <div className="flex items-start justify-between gap-4 mb-6">
      <div className="min-w-0">
        {backHref ? (
          <Link href={backHref} className={cls}>
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
      {actions && <div className="flex items-center gap-2 flex-shrink-0">{actions}</div>}
    </div>
  );
}
