'use client';

import { useQuery } from '@tanstack/react-query';
import { Cpu, MemoryStick, Server, Activity, ExternalLink } from 'lucide-react';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/shared/PageHeader';
import { StatCard } from '@/components/shared/StatCard';
import { Loading } from '@/components/shared/states';

interface ServiceHealth { service: string; status: 'up' | 'down' | 'degraded'; latencyMs: number }

const STATUS_STYLE: Record<string, string> = {
  up: 'bg-green-100 text-green-700',
  degraded: 'bg-orange-100 text-orange-700',
  down: 'bg-red-100 text-red-700',
};

export default function ServeurPage() {
  const { data: health, isLoading: lh } = useQuery({
    queryKey: ['admin-health'],
    queryFn: () => api.get('/admin/health').then((r) => r.data.data),
    refetchInterval: 15_000,
  });
  const { data: metrics, isLoading: lm } = useQuery({
    queryKey: ['admin-metrics'],
    queryFn: () => api.get('/admin/metrics').then((r) => r.data.data),
    refetchInterval: 10_000,
  });

  const services: ServiceHealth[] = health?.services ?? [];

  return (
    <div>
      <PageHeader
        title="Santé du serveur"
        subtitle={health ? `État global : ${health.status}` : 'Monitoring temps réel'}
        backHref="/administration"
        actions={
          <a href="/grafana" target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-lg bg-white border border-gray-200 px-3.5 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
            <ExternalLink size={15} /> Ouvrir Grafana
          </a>
        }
      />

      {/* Services Docker */}
      <h3 className="font-semibold text-gray-700 text-sm mb-3">Services</h3>
      {lh ? <Loading /> : (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3 mb-8">
          {services.map((s) => (
            <div key={s.service} className="bg-white rounded-xl border border-gray-100 p-3 text-center">
              <p className="text-xs font-medium text-gray-700 capitalize">{s.service}</p>
              <span className={`mt-1 inline-block rounded px-2 py-0.5 text-[11px] font-medium ${STATUS_STYLE[s.status]}`}>{s.status}</span>
              <p className="mt-1 text-[10px] text-gray-400">{s.latencyMs} ms</p>
            </div>
          ))}
        </div>
      )}

      {/* Métriques système */}
      <h3 className="font-semibold text-gray-700 text-sm mb-3">Ressources</h3>
      {lm ? <Loading /> : metrics && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <StatCard title="Charge CPU (1m)" value={metrics.cpu?.load1 ?? '—'} subtitle={`${metrics.cpu?.cores} cœurs`} icon={Cpu} color="bg-[#2471A3]" />
          <StatCard title="Mémoire" value={`${metrics.memory?.usedPercent ?? 0}%`} subtitle={`${metrics.memory?.usedMB} / ${metrics.memory?.totalMB} MB`} icon={MemoryStick} color="bg-[#0E7C6B]" />
          <StatCard title="Process API" value={`${metrics.process?.rssMB ?? 0} MB`} subtitle={metrics.process?.nodeVersion} icon={Activity} color="bg-[#1B3F6B]" />
          <StatCard title="Uptime serveur" value={`${Math.floor((metrics.uptimeSeconds ?? 0) / 3600)} h`} subtitle={metrics.hostname} icon={Server} color="bg-[#1B3F6B]" />
        </div>
      )}

      {/* Grafana embarqué */}
      <h3 className="font-semibold text-gray-700 text-sm mb-3">Monitoring Grafana</h3>
      <div className="rounded-xl border border-gray-200 overflow-hidden bg-white" style={{ height: 600 }}>
        <iframe src="/grafana/d/telecom-api/api-telecom-vue-d-ensemble?kiosk" title="Grafana" className="w-full h-full" />
      </div>
    </div>
  );
}
