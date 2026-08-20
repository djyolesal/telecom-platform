'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Lock, Pencil, Trash2, X } from 'lucide-react';
import { api } from '@/lib/api';
import { Button } from '@/components/shared/Button';
import { ChampMeta, ImpactSuppression, Ligne, Relations, TableMeta, afficher } from './types';

/** Formulation de ce que la base fera des lignes liées. */
const CONSEQUENCE: Record<string, string> = {
  Cascade: 'seront SUPPRIMÉES avec elle',
  SetNull: 'seront déliées (champ vidé)',
  Restrict: 'bloquent la suppression',
  NoAction: 'bloquent la suppression',
  SetDefault: 'reprendront leur valeur par défaut',
};

/**
 * Fiche complète d'un enregistrement, en panneau latéral : le tableau ne montre
 * qu'une partie des colonnes (certaines tables en comptent plus de quarante),
 * cette fiche montre TOUT — y compris les champs non modifiables — avant
 * d'ouvrir le formulaire ou de supprimer.
 */
export function PanneauLigne({
  meta,
  ligne,
  relations,
  onClose,
  onModifier,
  onSupprimer,
  suppressionEnCours,
}: {
  meta: TableMeta;
  ligne: Ligne;
  relations?: Relations;
  onClose: () => void;
  onModifier: () => void;
  onSupprimer: () => void;
  suppressionEnCours: boolean;
}) {
  const champs: ChampMeta[] = meta.champs.filter((c) => c.kind !== 'relation');
  const id = String(ligne[meta.idChamp] ?? '');
  const [confirmation, setConfirmation] = useState(false);

  // L'inventaire n'est demandé qu'au moment de supprimer : il coûte un COUNT
  // par table qui référence celle-ci.
  const { data: impacts, isLoading: chargeImpacts } = useQuery({
    queryKey: ['db-impact', meta.modele, id],
    queryFn: () => api.get(`/admin/db/tables/${meta.modele}/lignes/${id}/impact`).then((r) => r.data.data as ImpactSuppression[]),
    enabled: confirmation,
  });

  const bloquantes = (impacts ?? []).filter((i) => i.action === 'Restrict' || i.action === 'NoAction');

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/20" onClick={onClose}>
      <aside
        className="flex h-full w-full max-w-xl flex-col bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-3 border-b border-gray-100 px-5 py-4">
          <div className="min-w-0">
            <h2 className="truncate text-base font-bold text-gray-800">{meta.libelle}</h2>
            <p className="mt-0.5 truncate font-mono text-xs text-gray-400">{meta.table} · {id}</p>
          </div>
          <button onClick={onClose} className="rounded p-1 hover:bg-gray-100"><X size={18} /></button>
        </header>

        <div className="flex-1 overflow-auto px-5 py-4">
          <dl className="divide-y divide-gray-50">
            {champs.map((c) => (
              <div key={c.nom} className="grid grid-cols-3 gap-3 py-2">
                <dt className="col-span-1 text-xs font-medium text-gray-500">
                  {c.nom}
                  <span className="mt-0.5 block font-normal text-[10px] text-gray-400">{c.type}</span>
                </dt>
                <dd className="col-span-2 break-words text-sm text-gray-800">
                  {c.secret ? (
                    <span className="text-gray-400">•••••••• (non affiché)</span>
                  ) : c.fkVers ? (
                    <>
                      {afficher(c, ligne[c.nom], relations)}
                      {ligne[c.nom] != null && (
                        <span className="ml-1.5 font-mono text-[10px] text-gray-400">{String(ligne[c.nom])}</span>
                      )}
                    </>
                  ) : c.type === 'Json' && ligne[c.nom] != null ? (
                    <pre className="max-h-40 overflow-auto rounded bg-gray-50 p-2 font-mono text-[11px]">
                      {JSON.stringify(ligne[c.nom], null, 2)}
                    </pre>
                  ) : (
                    afficher(c, ligne[c.nom], relations)
                  )}
                </dd>
              </div>
            ))}
          </dl>
        </div>

        <footer className="border-t border-gray-100 px-5 py-3">
          {meta.lectureSeule ? (
            <p className="flex items-center gap-1.5 text-xs text-amber-600">
              <Lock size={13} /> Table en consultation seule (preuve d&apos;audit)
            </p>
          ) : confirmation ? (
            <div>
              <p className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-red-700">
                <AlertTriangle size={15} /> Supprimer définitivement cet enregistrement ?
              </p>
              {chargeImpacts ? (
                <p className="mb-3 text-xs text-gray-400">Analyse des données liées…</p>
              ) : impacts?.length ? (
                <ul className="mb-3 max-h-40 space-y-1 overflow-auto rounded-lg bg-gray-50 p-2.5 text-xs text-gray-700">
                  {impacts.map((i) => (
                    <li key={`${i.modele}.${i.champ}`}>
                      <span className={i.action === 'Cascade' ? 'font-semibold text-red-700' : ''}>
                        {i.lignes} {i.libelle}
                      </span>{' '}
                      {CONSEQUENCE[i.action] ?? i.action}
                      <span className="ml-1 font-mono text-[10px] text-gray-400">{i.champ}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mb-3 text-xs text-gray-500">Aucune autre donnée ne référence cette ligne.</p>
              )}
              {bloquantes.length > 0 && (
                <p className="mb-3 text-xs text-amber-700">
                  La base refusera la suppression tant que ces références existent : supprimez-les d&apos;abord.
                </p>
              )}
              <div className="flex justify-end gap-2">
                <Button variant="secondary" onClick={() => setConfirmation(false)}>Annuler</Button>
                <Button
                  variant="danger"
                  icon={Trash2}
                  loading={suppressionEnCours}
                  disabled={chargeImpacts || bloquantes.length > 0}
                  onClick={onSupprimer}
                >
                  Supprimer définitivement
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-3">
              <Button variant="danger" icon={Trash2} onClick={() => setConfirmation(true)}>Supprimer</Button>
              <Button icon={Pencil} onClick={onModifier}>Modifier</Button>
            </div>
          )}
        </footer>
      </aside>
    </div>
  );
}
