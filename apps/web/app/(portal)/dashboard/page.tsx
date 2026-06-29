'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, LineChart, Line, Legend } from 'recharts';
import { AlertTriangle, MapPin, Wrench, Fuel, Zap, TrendingUp, TrendingDown, Minus, X } from 'lucide-react';
import { api } from '@/lib/api';
import { useSupervisionSocket, StockUpdatedEvent } from '@/lib/hooks/useSupervisionSocket';

/** Vignette temps réel du dernier dépotage (photo + site + volume). */
function LiveDepotageCard({ e, onClose }: { e: StockUpdatedEvent; onClose: () => void }) {
  const router = useRouter();
  return (
    <div className="fixed bottom-4 right-4 z-50 w-72 rounded-xl border border-gray-200 bg-white shadow-xl overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 bg-[#0E7C6B] text-white text-xs font-semibold">
        <span className="inline-flex items-center gap-1"><Fuel size={13} /> Dépotage en direct</span>
        <button onClick={onClose} className="hover:opacity-80"><X size={14} /></button>
      </div>
      <button onClick={() => router.push(`/carburant/${e.depotageId}`)} className="block w-full text-left hover:bg-gray-50">
        {e.photoUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={e.photoUrl} alt="Dépotage" className="h-32 w-full object-cover" />
        )}
        <div className="p-3">
          <p className="text-sm font-semibold text-gray-800">{e.siteNom ?? e.siteCode ?? 'Site'}</p>
          <p className="text-xs text-gray-500">
            {Math.round(Number(e.volumeLitres ?? 0)).toLocaleString('fr-FR')} L livrés
            {e.stockApresLitres != null ? ` · stock ${Math.round(Number(e.stockApresLitres)).toLocaleString('fr-FR')} L` : ''}
          </p>
        </div>
      </button>
    </div>
  );
}

const COLORS = ['#1B3F6B', '#0E7C6B', '#2471A3', '#F39C12', '#C0392B'];

function KPICard({ title, value, subtitle, icon: Icon, color, trend }: {
  title: string; value: string | number; subtitle?: string;
  icon: React.ElementType; color: string; trend?: 'up' | 'down' | 'neutral';
}) {
  const TrendIcon = trend === 'up' ? TrendingUp : trend === 'down' ? TrendingDown : Minus;
  return (
    <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">{title}</p>
          <p className="text-2xl font-bold text-gray-800 mt-1">{value}</p>
          {subtitle && <p className="text-xs text-gray-400 mt-0.5">{subtitle}</p>}
        </div>
        <div className={`p-3 rounded-xl ${color}`}>
          <Icon size={20} className="text-white" />
        </div>
      </div>
      {trend && (
        <div className="mt-3 flex items-center gap-1 text-xs text-gray-500">
          <TrendIcon size={12} className={trend === 'up' ? 'text-green-500' : trend === 'down' ? 'text-red-500' : 'text-gray-400'} />
          <span>vs mois précédent</span>
        </div>
      )}
    </div>
  );
}

export default function DashboardPage() {
  const { data: dashData, isLoading } = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api.get('/rapports/dashboard').then(r => r.data.data),
    refetchInterval: 60_000, // Refresh toutes les minutes
  });

  // Écoute WebSocket pour mises à jour en temps réel + vignette dépotage.
  const [live, setLive] = useState<StockUpdatedEvent | null>(null);
  useSupervisionSocket({ onStockUpdated: (e) => setLive(e) });
  useEffect(() => {
    if (!live) return;
    const t = setTimeout(() => setLive(null), 12_000);
    return () => clearTimeout(t);
  }, [live]);

  if (isLoading) return (
    <div className="space-y-6 animate-pulse">
      <div className="grid grid-cols-5 gap-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-28 bg-gray-200 rounded-xl" />
        ))}
      </div>
      <div className="grid grid-cols-2 gap-6">
        <div className="h-72 bg-gray-200 rounded-xl" />
        <div className="h-72 bg-gray-200 rounded-xl" />
      </div>
    </div>
  );

  const d = dashData || {};

  const powerConfigData = [
    { name: 'CEET+GE', value: d.parPowerConfig?.CEET_GE || 0 },
    { name: 'GE Only', value: d.parPowerConfig?.GE_UNIQUEMENT || 0 },
    { name: 'Hybride', value: d.parPowerConfig?.HYBRIDE_GE || 0 },
    { name: 'CEET', value: d.parPowerConfig?.CEET_UNIQUEMENT || 0 },
    { name: 'Solaire', value: d.parPowerConfig?.SOLAIRE_UNIQUEMENT || 0 },
  ].filter(x => x.value > 0);

  return (
    <div className="space-y-6">
      {live && <LiveDepotageCard e={live} onClose={() => setLive(null)} />}
      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-4">
        <KPICard title="Sites actifs" value={d.sitesActifs || '—'} icon={MapPin} color="bg-[#1B3F6B]" />
        <KPICard title="Incidents ouverts" value={d.incidentsOuverts || 0} subtitle={`${d.incidentsCritiques || 0} critiques`} icon={AlertTriangle} color={d.incidentsCritiques > 0 ? 'bg-red-500' : 'bg-[#0E7C6B]'} trend={d.incidentsTrend} />
        <KPICard title="Stock critique" value={`${d.sitesCritiques || 0} sites`} subtitle="< 300 L" icon={Fuel} color={d.sitesCritiques > 10 ? 'bg-orange-500' : 'bg-[#2471A3]'} />
        <KPICard title="Stock gasoil" value={`${((d.stockTotalLitres || 0) / 1000).toFixed(0)}k L`} icon={Fuel} color="bg-[#0E7C6B]" />
        <KPICard title="Autonomie méd." value={`${d.autonomieMediane || '—'} j`} icon={Zap} color="bg-[#2471A3]" />
      </div>

      {/* Graphiques row 1 */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {/* Consommation GE 6 mois */}
        <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
          <h3 className="font-semibold text-gray-700 mb-4 text-sm">Consommation GE mensuelle (kWh)</h3>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={d.consoMensuelle || []}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="mois" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip formatter={(v) => [`${Number(v).toLocaleString('fr-FR')} kWh`]} />
              <Bar dataKey="ge" fill="#1B3F6B" name="GE" radius={[3,3,0,0]} />
              <Bar dataKey="ceet" fill="#0E7C6B" name="CEET" radius={[3,3,0,0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Répartition power config */}
        <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
          <h3 className="font-semibold text-gray-700 mb-4 text-sm">Répartition configuration énergie</h3>
          <div className="flex items-center">
            <ResponsiveContainer width="60%" height={220}>
              <PieChart>
                <Pie data={powerConfigData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label={false}>
                  {powerConfigData.map((_, i) => (
                    <Cell key={i} fill={COLORS[i % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(v, n) => [`${v} sites`, n]} />
              </PieChart>
            </ResponsiveContainer>
            <div className="flex-1 space-y-2">
              {powerConfigData.map((item, i) => (
                <div key={item.name} className="flex items-center gap-2 text-xs">
                  <div className="w-3 h-3 rounded-sm flex-shrink-0" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                  <span className="text-gray-600 flex-1">{item.name}</span>
                  <span className="font-medium text-gray-800">{item.value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Graphiques row 2 */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {/* Incidents récents */}
        <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-gray-700 text-sm">Incidents récents</h3>
            <a href="/incidents" className="text-xs text-[#1B3F6B] hover:underline">Voir tout →</a>
          </div>
          <div className="space-y-2 max-h-52 overflow-y-auto">
            {(d.incidentsRecents || []).map((inc: Record<string, string>) => (
              <div key={inc.id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-gray-50 text-xs">
                <div className={`w-2 h-2 rounded-full flex-shrink-0 ${inc.severite === 'CRITIQUE' ? 'bg-red-500' : inc.severite === 'MAJEUR' ? 'bg-orange-500' : 'bg-yellow-400'}`} />
                <span className="font-medium text-gray-700 flex-1 truncate">{inc.siteNom ?? inc.siteCode} — {inc.type}</span>
                <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${inc.statut === 'OUVERT' ? 'bg-red-100 text-red-700' : inc.statut === 'EN_COURS' ? 'bg-orange-100 text-orange-700' : 'bg-green-100 text-green-700'}`}>
                  {inc.statut}
                </span>
              </div>
            ))}
            {(!d.incidentsRecents || d.incidentsRecents.length === 0) && (
              <p className="text-gray-400 text-xs text-center py-4">✅ Aucun incident récent</p>
            )}
          </div>
        </div>

        {/* Stock par région */}
        <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
          <h3 className="font-semibold text-gray-700 mb-4 text-sm">Stock carburant par région (L)</h3>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={d.stockParRegion || []} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={v => `${(v/1000).toFixed(0)}k`} />
              <YAxis dataKey="region" type="category" tick={{ fontSize: 10 }} width={80} />
              <Tooltip formatter={v => [`${Number(v).toLocaleString('fr-FR')} L`]} />
              <Bar dataKey="stock" fill="#2471A3" radius={[0,3,3,0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
