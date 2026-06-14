'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { addWeeks, startOfWeek, addDays, format, isSameDay } from 'date-fns';
import { fr } from 'date-fns/locale';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/shared/PageHeader';
import { Loading } from '@/components/shared/states';
import { StatutMaintBadge } from '@/components/shared/Badge';

interface Maint {
  id: string;
  equipement: string;
  statut: string;
  datePlanifiee: string;
  site?: { code: string };
}

export default function PlanningPage() {
  const router = useRouter();
  const [weekOffset, setWeekOffset] = useState(0);
  const ref = addWeeks(new Date(), weekOffset);
  const semaine = format(ref, 'yyyy-MM-dd');
  const monday = startOfWeek(ref, { weekStartsOn: 1 });
  const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i));

  const { data, isLoading } = useQuery({
    queryKey: ['planning', semaine],
    queryFn: () => api.get('/maintenances/planning', { params: { semaine } }).then((r) => r.data.data),
  });

  const maintenances: Maint[] = data?.maintenances ?? [];

  return (
    <div>
      <PageHeader
        title="Planning des maintenances"
        backHref="/maintenance"
        actions={
          <div className="flex items-center gap-2">
            <button onClick={() => setWeekOffset((w) => w - 1)} className="rounded-lg border border-gray-200 p-2 hover:bg-gray-50"><ChevronLeft size={16} /></button>
            <span className="text-sm font-medium text-gray-700 capitalize min-w-[180px] text-center">
              Semaine du {format(monday, 'd MMM', { locale: fr })}
            </span>
            <button onClick={() => setWeekOffset((w) => w + 1)} className="rounded-lg border border-gray-200 p-2 hover:bg-gray-50"><ChevronRight size={16} /></button>
          </div>
        }
      />

      {isLoading ? (
        <Loading />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-7 gap-3">
          {days.map((day) => {
            const items = maintenances.filter((m) => isSameDay(new Date(m.datePlanifiee), day));
            const today = isSameDay(day, new Date());
            return (
              <div key={day.toISOString()} className={`rounded-xl border bg-white p-3 min-h-[140px] ${today ? 'border-[#2471A3] ring-1 ring-[#2471A3]/20' : 'border-gray-100'}`}>
                <div className="mb-2 text-center">
                  <p className="text-[10px] uppercase text-gray-400 capitalize">{format(day, 'EEE', { locale: fr })}</p>
                  <p className={`text-sm font-bold ${today ? 'text-[#2471A3]' : 'text-gray-700'}`}>{format(day, 'd')}</p>
                </div>
                <div className="space-y-1.5">
                  {items.map((m) => (
                    <button
                      key={m.id}
                      onClick={() => router.push(`/maintenance/${m.id}`)}
                      className="block w-full rounded-lg bg-gray-50 hover:bg-gray-100 p-2 text-left"
                    >
                      <p className="text-[11px] font-medium text-gray-700 truncate">{m.site?.code}</p>
                      <p className="text-[10px] text-gray-500 truncate">{m.equipement}</p>
                      <div className="mt-1"><StatutMaintBadge value={m.statut} /></div>
                    </button>
                  ))}
                  {items.length === 0 && <p className="text-[10px] text-gray-300 text-center pt-4">—</p>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
