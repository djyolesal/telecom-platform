import { cn } from '@/lib/utils';

export function StatCard({
  title,
  value,
  subtitle,
  icon: Icon,
  color = 'bg-[#1B3F6B]',
}: {
  title: string;
  value: string | number;
  subtitle?: string;
  icon?: React.ElementType;
  color?: string;
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
      <div className="flex items-start justify-between">
        <div className="min-w-0">
          <p className="text-xs text-gray-500 font-medium uppercase tracking-wide truncate">{title}</p>
          <p className="text-2xl font-bold text-gray-800 mt-1">{value}</p>
          {subtitle && <p className="text-xs text-gray-400 mt-0.5">{subtitle}</p>}
        </div>
        {Icon && (
          <div className={cn('p-3 rounded-xl flex-shrink-0', color)}>
            <Icon size={20} className="text-white" />
          </div>
        )}
      </div>
    </div>
  );
}
