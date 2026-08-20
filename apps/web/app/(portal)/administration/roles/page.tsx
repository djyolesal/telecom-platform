'use client';

import { Check, X } from 'lucide-react';
import { PageHeader } from '@/components/shared/PageHeader';

const MODULES = ['Saisie terrain', 'Validation / assignation', 'Rapports', 'Configuration', 'Gestion utilisateurs', 'Monitoring serveur', 'Base de données'];

// Matrice indicative des droits (alignée sur le middleware RBAC de l'API)
const MATRIX: Record<string, boolean[]> = {
  TECHNICIEN: [true, false, false, false, false, false, false],
  SUPERVISEUR: [true, true, true, false, false, false, false],
  MANAGER: [true, true, true, true, false, false, false],
  DIRECTION: [false, false, true, false, false, false, false],
  ADMIN: [true, true, true, true, true, true, true],
};

const LABELS: Record<string, string> = {
  TECHNICIEN: 'Technicien', SUPERVISEUR: 'Superviseur', MANAGER: 'Manager', DIRECTION: 'Direction', ADMIN: 'Administrateur',
};

export default function RolesPage() {
  return (
    <div>
      <PageHeader title="Rôles & permissions" subtitle="Matrice des droits par rôle (RBAC)" backHref="/administration" />

      <div className="overflow-x-auto rounded-xl border border-gray-100 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50/60">
              <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Module</th>
              {Object.keys(MATRIX).map((r) => (
                <th key={r} className="px-3 py-3 text-center text-xs font-semibold uppercase tracking-wide text-gray-500">{LABELS[r]}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {MODULES.map((mod, i) => (
              <tr key={mod} className="border-b border-gray-50 last:border-0">
                <td className="px-3 py-2.5 text-gray-700">{mod}</td>
                {Object.keys(MATRIX).map((r) => (
                  <td key={r} className="px-3 py-2.5 text-center">
                    {MATRIX[r][i] ? <Check size={16} className="inline text-green-600" /> : <X size={16} className="inline text-gray-300" />}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-4 text-xs text-gray-400">
        Les permissions sont appliquées côté API par le middleware RBAC sur chaque endpoint. Cette matrice est indicative.
      </p>
    </div>
  );
}
