'use client';

/**
 * Bloc de signatures d'une fiche (maintenance, incident, dépotage) — même
 * logique que le PDF : chaque emplacement attendu est affiché, signé ou non.
 * Un emplacement sans image reste VISIBLE (« Signature manquante ») pour que
 * l'absence soit explicite au lieu de disparaître.
 */
export interface SignatureSlot {
  label: string;
  nom?: string | null;
  url?: string | null;
}

export function SignatureBlock({ signatures }: { signatures?: SignatureSlot[] | null }) {
  if (!signatures?.length) return null;
  return (
    <div className="bg-white rounded-xl border border-gray-100 p-5">
      <h3 className="font-semibold text-gray-700 text-sm mb-3">Signatures</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {signatures.map((s) => (
          <div key={s.label}>
            <div className="flex h-24 items-center justify-center rounded-lg border border-gray-200 bg-gray-50/50 p-2">
              {s.url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={s.url} alt={`Signature ${s.label}`} className="max-h-full max-w-full object-contain" />
              ) : (
                <div className="w-full px-4 text-center">
                  <div className="mb-1 border-t border-dashed border-gray-300" />
                  <span className="text-[11px] text-gray-400">Signature manquante</span>
                </div>
              )}
            </div>
            <p className="mt-1.5 text-sm font-semibold text-gray-800">{s.label}</p>
            <p className="text-xs text-gray-500">{s.nom || '—'}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
