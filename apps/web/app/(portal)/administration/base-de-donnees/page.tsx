'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Database, Lock, Search, Table2 } from 'lucide-react';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/shared/PageHeader';
import { Loading, ErrorState, EmptyState } from '@/components/shared/states';
import { fmtNumber } from '@/lib/utils';
import { TableResume, octetsLisibles } from './types';

interface Catalogue {
  groupes: Array<{ cle: string; libelle: string }>;
  tables: TableResume[];
}

/**
 * Console base de données — catalogue.
 *
 * La liste des tables n'est pas écrite ici : elle vient de l'API, qui la dérive
 * de schema.prisma. Une table ajoutée au modèle apparaît donc d'elle-même.
 */
export default function BaseDeDonneesPage() {
  const [q, setQ] = useState('');

  const { data, isLoading, isError } = useQuery({
    queryKey: ['db-catalogue'],
    queryFn: () => api.get('/admin/db/tables').then((r) => r.data.data as Catalogue),
  });

  const filtrees = useMemo(() => {
    const terme = q.trim().toLowerCase();
    if (!terme) return data?.tables ?? [];
    return (data?.tables ?? []).filter(
      (t) => t.libelle.toLowerCase().includes(terme) || t.table.includes(terme) || t.modele.toLowerCase().includes(terme)
    );
  }, [data, q]);

  if (isLoading) return <Loading />;
  if (isError) return <ErrorState message="Catalogue des tables indisponible" />;

  const totalLignes = (data?.tables ?? []).reduce((s, t) => s + Math.max(0, t.lignes), 0);
  const totalOctets = (data?.tables ?? []).reduce((s, t) => s + (t.octets ?? 0), 0);

  return (
    <div>
      <PageHeader
        title="Base de données"
        subtitle={`${data?.tables.length ?? 0} tables · ${fmtNumber(totalLignes)} lignes · ${octetsLisibles(totalOctets)}`}
        backHref="/administration"
      />

      <div className="mb-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
        Accès direct aux données de l&apos;application. Les modifications faites ici contournent les règles
        métier du portail (calculs, notifications, cohérence des chaînes de sites) : à réserver aux
        corrections ponctuelles. Chaque écriture est tracée dans le <Link href="/administration/audit" className="underline">journal d&apos;audit</Link>.
      </div>

      <div className="relative mb-5 max-w-md">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Rechercher une table…"
          className="w-full rounded-lg border border-gray-200 py-2 pl-9 pr-3 text-sm outline-none focus:border-[#2471A3] focus:ring-2 focus:ring-[#2471A3]/20"
        />
      </div>

      {filtrees.length === 0 ? (
        <EmptyState title="Aucune table" hint="Aucune table ne correspond à cette recherche." />
      ) : (
        (data?.groupes ?? []).map((g) => {
          const tables = filtrees.filter((t) => t.groupe === g.cle);
          if (!tables.length) return null;
          return (
            <section key={g.cle} className="mb-7">
              <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-700">
                <Database size={15} className="text-[#2471A3]" /> {g.libelle}
                <span className="text-xs font-normal text-gray-400">{tables.length}</span>
              </h3>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                {tables.map((t) => (
                  <Link
                    key={t.modele}
                    href={`/administration/base-de-donnees/${t.modele}`}
                    className="group rounded-xl border border-gray-100 bg-white p-4 transition-all hover:border-[#2471A3]/30 hover:shadow-md"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <h4 className="flex items-center gap-1.5 truncate text-sm font-semibold text-gray-800">
                          <Table2 size={14} className="shrink-0 text-gray-400 group-hover:text-[#2471A3]" />
                          {t.libelle}
                          {t.lectureSeule && <Lock size={12} className="shrink-0 text-amber-500" />}
                        </h4>
                        <p className="mt-0.5 truncate font-mono text-[11px] text-gray-400">{t.table}</p>
                      </div>
                      <span
                        className="shrink-0 rounded-lg bg-gray-50 px-2 py-1 text-xs font-semibold text-gray-700"
                        title={t.lignesExactes ? undefined : 'Estimation Postgres (table trop volumineuse pour un comptage exact)'}
                      >
                        {t.lignes < 0 ? '—' : `${t.lignesExactes ? '' : '~'}${fmtNumber(t.lignes)}`}
                      </span>
                    </div>
                    <p className="mt-2 text-[11px] text-gray-400">
                      {t.colonnes} colonnes · {octetsLisibles(t.octets)}
                      {t.lectureSeule && ' · consultation seule'}
                    </p>
                  </Link>
                ))}
              </div>
            </section>
          );
        })
      )}
    </div>
  );
}
