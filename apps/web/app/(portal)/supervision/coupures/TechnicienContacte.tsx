'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Input } from '@/components/shared/Form';

interface Personne { nom: string; prenom: string; telephone: string | null; societe: string; role?: 'Responsable' | 'Équipier' }
interface Contactables { zone: string | null; fme: Personne[]; passifs: Personne[]; passifsDuLot: boolean }

const nomComplet = (p: Personne) => `${p.prenom} ${p.nom}`.trim();

/**
 * Champ « technicien contacté » du NOC : saisie libre, plus des suggestions en
 * un clic - l'équipe FME de la zone du site (responsable puis équipiers) et les
 * techniciens passifs du prestataire du lot, avec leur téléphone pour appeler.
 */
export function TechnicienContacte({ siteId, value, onChange, placeholder }: {
  siteId?: string | null;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  const { data } = useQuery({
    queryKey: ['coupures-contactables', siteId],
    queryFn: () => api.get('/coupures-reseau/contactables', { params: { site_id: siteId } }).then((r) => r.data.data as Contactables),
    enabled: !!siteId,
    staleTime: 5 * 60_000,
  });
  const choisi = value.trim().toLowerCase();

  const pastille = (p: Personne, fme: boolean) => {
    const nom = nomComplet(p);
    const actif = nom.toLowerCase() === choisi;
    return (
      <button
        key={`${fme ? 'f' : 'p'}-${nom}-${p.telephone ?? ''}`}
        type="button"
        onClick={() => onChange(nom)}
        title={`${p.societe}${p.telephone ? ` · ${p.telephone}` : ''}`}
        className={`rounded-full border px-2 py-px text-[11px] ${actif
          ? 'border-[rgb(var(--brand-light))] bg-[rgb(var(--brand-light)/0.12)] text-[rgb(var(--brand))]'
          : 'border-gray-200 bg-gray-50 text-gray-600 hover:border-[rgb(var(--brand-light))] hover:text-[rgb(var(--brand))]'}`}
      >
        {nom}
        {fme && p.role === 'Responsable' && <span className="text-gray-400"> · resp.</span>}
        {p.telephone && <span className="text-gray-400"> · {p.telephone}</span>}
      </button>
    );
  };

  return (
    <div>
      <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder ?? 'Nom du technicien appelé'} />
      {data && (data.fme.length > 0 || data.passifs.length > 0) && (
        <div className="mt-1.5 space-y-1">
          {data.fme.length > 0 && (
            <div className="flex flex-wrap items-center gap-1">
              <span className="mr-1 text-[11px] font-medium text-gray-500">FME {data.zone}</span>
              {data.fme.map((p) => pastille(p, true))}
            </div>
          )}
          {data.passifs.length > 0 && (
            <div className="flex flex-wrap items-center gap-1">
              <span className="mr-1 text-[11px] font-medium text-gray-500">
                {data.passifsDuLot ? 'Passifs du lot' : 'Techniciens passifs'}
              </span>
              {data.passifs.map((p) => pastille(p, false))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
