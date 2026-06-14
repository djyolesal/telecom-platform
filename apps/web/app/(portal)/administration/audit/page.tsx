'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/shared/PageHeader';
import { FilterBar } from '@/components/shared/FilterBar';
import { DataTable, Column } from '@/components/shared/DataTable';
import { Pagination, PaginationMeta } from '@/components/shared/Pagination';
import { TableSkeleton, EmptyState, ErrorState } from '@/components/shared/states';
import { Badge } from '@/components/shared/Badge';
import { fmtDateTime } from '@/lib/utils';

interface AuditLog {
  id: string;
  action: string;
  resource: string;
  resourceId?: string;
  success: boolean;
  ipAddress?: string;
  createdAt: string;
  user?: { nom: string; prenom: string; email: string; role: string };
}

const ACTIONS = ['CREATE', 'UPDATE', 'DELETE', 'LOGIN', 'LOGOUT', 'EXPORT', 'ASSIGN', 'CLOSE'].map((a) => ({ value: a, label: a }));

const ACTION_COLOR: Record<string, string> = {
  CREATE: 'bg-green-100 text-green-700',
  UPDATE: 'bg-blue-100 text-blue-700',
  DELETE: 'bg-red-100 text-red-700',
  LOGIN: 'bg-gray-100 text-gray-600',
  LOGOUT: 'bg-gray-100 text-gray-600',
  EXPORT: 'bg-purple-100 text-purple-700',
  ASSIGN: 'bg-orange-100 text-orange-700',
  CLOSE: 'bg-teal-100 text-teal-700',
};

export default function AuditPage() {
  const [page, setPage] = useState(1);
  const [action, setAction] = useState('');

  const { data, isLoading, isError } = useQuery({
    queryKey: ['audit', { page, action }],
    queryFn: () => api.get('/admin/audit', { params: { page, limit: 30, action: action || undefined } }).then((r) => r.data),
  });

  const rows: AuditLog[] = data?.data ?? [];
  const meta: PaginationMeta | undefined = data?.meta;

  const columns: Column<AuditLog>[] = [
    { key: 'createdAt', header: 'Date', render: (l) => fmtDateTime(l.createdAt) },
    { key: 'user', header: 'Utilisateur', render: (l) => (l.user ? `${l.user.prenom} ${l.user.nom}` : '—') },
    { key: 'action', header: 'Action', render: (l) => <Badge className={ACTION_COLOR[l.action] || 'bg-gray-100 text-gray-600'}>{l.action}</Badge> },
    { key: 'resource', header: 'Ressource' },
    { key: 'ipAddress', header: 'IP', render: (l) => l.ipAddress || '—' },
    { key: 'success', header: 'Résultat', align: 'center', render: (l) => <Badge className={l.success ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}>{l.success ? 'OK' : 'Échec'}</Badge> },
  ];

  return (
    <div>
      <PageHeader title="Journal d'audit" subtitle="Historique des actions sensibles" backHref="/administration" />

      <FilterBar filters={[{ key: 'action', label: 'Toutes actions', value: action, options: ACTIONS, onChange: (v) => { setAction(v); setPage(1); } }]} />

      {isLoading ? (
        <TableSkeleton cols={6} />
      ) : isError ? (
        <ErrorState />
      ) : rows.length === 0 ? (
        <EmptyState title="Aucune entrée d'audit" />
      ) : (
        <>
          <DataTable columns={columns} data={rows} />
          <Pagination meta={meta} onChange={setPage} />
        </>
      )}
    </div>
  );
}
