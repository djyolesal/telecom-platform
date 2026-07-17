import { cn, SEVERITE_COLORS, STATUT_INCIDENT_COLORS } from '@/lib/utils';

export function Badge({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={cn('inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium', className)}>
      {children}
    </span>
  );
}

export function SeveriteBadge({ value }: { value: string }) {
  return <Badge className={SEVERITE_COLORS[value] || 'bg-gray-100 text-gray-600'}>{value}</Badge>;
}

export function StatutIncidentBadge({ value }: { value: string }) {
  return <Badge className={STATUT_INCIDENT_COLORS[value] || 'bg-gray-100 text-gray-600'}>{value}</Badge>;
}

const STATUT_MAINT: Record<string, string> = {
  PLANIFIEE: 'bg-blue-100 text-blue-700',
  EN_COURS: 'bg-orange-100 text-orange-700',
  SUSPENDUE: 'bg-amber-200 text-amber-900',
  TERMINEE: 'bg-green-100 text-green-700',
  ANNULEE: 'bg-gray-100 text-gray-500',
};
export function StatutMaintBadge({ value }: { value: string }) {
  return <Badge className={STATUT_MAINT[value] || 'bg-gray-100 text-gray-600'}>{value}</Badge>;
}

const NIVEAU_STOCK: Record<string, string> = {
  VIDE: 'bg-red-200 text-red-800',
  CRITIQUE: 'bg-red-100 text-red-700',
  FAIBLE: 'bg-orange-100 text-orange-700',
  OK: 'bg-green-100 text-green-700',
  NA: 'bg-gray-100 text-gray-500',
};
export function NiveauStockBadge({ value }: { value: string }) {
  return <Badge className={NIVEAU_STOCK[value] || 'bg-gray-100 text-gray-600'}>{value}</Badge>;
}
