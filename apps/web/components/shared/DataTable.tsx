import { cn } from '@/lib/utils';

export interface Column<T> {
  key: string;
  header: string;
  render?: (row: T) => React.ReactNode;
  className?: string;
  align?: 'left' | 'right' | 'center';
}

export function DataTable<T>({
  columns,
  data,
  onRowClick,
  rowKey,
}: {
  columns: Column<T>[];
  data: T[];
  onRowClick?: (row: T) => void;
  rowKey?: (row: T, i: number) => string;
}) {
  return (
    <div className="overflow-x-auto rounded-xl border border-gray-100 bg-white">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-100 bg-gray-50/60">
            {columns.map((c) => (
              <th
                key={c.key}
                className={cn(
                  'px-3 py-2.5 text-xs font-semibold uppercase tracking-wide text-gray-500',
                  c.align === 'right' ? 'text-right' : c.align === 'center' ? 'text-center' : 'text-left',
                  c.className
                )}
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((row, i) => (
            <tr
              key={rowKey ? rowKey(row, i) : (row as { id?: string }).id ?? i}
              onClick={() => onRowClick?.(row)}
              className={cn(
                'border-b border-gray-50 last:border-0',
                onRowClick && 'cursor-pointer hover:bg-gray-50'
              )}
            >
              {columns.map((c) => (
                <td
                  key={c.key}
                  className={cn(
                    'px-3 py-2.5 text-gray-700',
                    c.align === 'right' ? 'text-right' : c.align === 'center' ? 'text-center' : 'text-left',
                    c.className
                  )}
                >
                  {c.render ? c.render(row) : ((row as Record<string, unknown>)[c.key] as React.ReactNode) ?? '—'}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
