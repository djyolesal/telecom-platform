'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useSession, signOut } from 'next-auth/react';
import {
  LayoutDashboard, MapPin, Wrench, Fuel, Zap, AlertTriangle,
  BarChart3, Settings, Users, Bell, Menu, X, LogOut, Activity, Truck, Boxes, ShieldAlert, LineChart, Gauge, Building2
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { NotificationBell } from '@/components/shared/NotificationBell';
import { LogoIcon, LogoWordmark } from '@/components/shared/Logo';

const NAV_ITEMS = [
  { href: '/dashboard',               label: 'Tableau de bord',  icon: LayoutDashboard,  roles: ['TECHNICIEN','SUPERVISEUR','MANAGER','ADMIN','DIRECTION'] },
  { href: '/direction',                label: 'Pilotage',          icon: LineChart,        roles: ['MANAGER','ADMIN','DIRECTION'] },
  { href: '/fiabilite-ge',   label: 'Fiabilité GE',      icon: Gauge,            roles: ['MANAGER','ADMIN','DIRECTION'] },
  { href: '/supervision/carte',        label: 'Supervision carte', icon: MapPin,           roles: ['SUPERVISEUR','MANAGER','ADMIN'] },
  { href: '/supervision/incidents',    label: 'Incidents live',    icon: Activity,         roles: ['SUPERVISEUR','MANAGER','ADMIN'] },
  { href: '/sites',                    label: 'Sites',             icon: MapPin,           roles: ['TECHNICIEN','SUPERVISEUR','MANAGER','ADMIN'] },
  { href: '/maintenance',              label: 'Maintenance',       icon: Wrench,           roles: ['TECHNICIEN','SUPERVISEUR','MANAGER','ADMIN'] },
  { href: '/actifs',                   label: "Parc d'actifs",     icon: Boxes,            roles: ['SUPERVISEUR','MANAGER','ADMIN'] },
  { href: '/carburant/stock',          label: 'Carburant',         icon: Fuel,             roles: ['TECHNICIEN','SUPERVISEUR','MANAGER','ADMIN'] },
  { href: '/carburant/commandes',       label: 'Appro. carburant',  icon: Truck,            roles: ['TRANSPORTEUR','MANAGER','ADMIN'] },
  { href: '/carburant/pertes',         label: 'Pertes carburant',  icon: ShieldAlert,      roles: ['SUPERVISEUR','MANAGER','ADMIN','DIRECTION'] },
  { href: '/energie',                  label: 'Énergie',           icon: Zap,              roles: ['TECHNICIEN','SUPERVISEUR','MANAGER','ADMIN'] },
  { href: '/incidents',                label: 'Incidents',         icon: AlertTriangle,    roles: ['TECHNICIEN','SUPERVISEUR','MANAGER','ADMIN'] },
  { href: '/rapports',                 label: 'Rapports',          icon: BarChart3,        roles: ['SUPERVISEUR','MANAGER','ADMIN','DIRECTION'] },
  { href: '/administration',           label: 'Administration',    icon: Settings,         roles: ['ADMIN'] },
];

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const pathname = usePathname();
  const router = useRouter();
  const { data: session } = useSession();
  const userRole = (session?.user as { role?: string })?.role || '';

  // « Ma société » : un superviseur rattaché à un prestataire doit compléter la
  // fiche de sa société (coordonnées des fiches de validation PDF) avant de
  // naviguer — première connexion bloquée sur /ma-societe tant que c'est vide.
  const { data: maSociete } = useQuery({
    queryKey: ['ma-societe'],
    queryFn: () => api.get('/ma-societe').then((r) => r.data.data as { nom: string; ficheComplete: boolean } | null),
    enabled: userRole === 'SUPERVISEUR',
    staleTime: 60_000,
  });
  useEffect(() => {
    if (userRole === 'SUPERVISEUR' && maSociete && !maSociete.ficheComplete && pathname !== '/ma-societe') {
      router.replace('/ma-societe');
    }
  }, [userRole, maSociete, pathname, router]);

  const visibleItems = [
    ...NAV_ITEMS.filter(item => item.roles.includes(userRole)),
    ...(userRole === 'SUPERVISEUR' && maSociete ? [{ href: '/ma-societe', label: 'Ma société', icon: Building2, roles: ['SUPERVISEUR'] }] : []),
  ];

  // Garde de rôle : la section demandée (préfixe de nav le plus spécifique)
  // doit autoriser le rôle. Évite le loader infini / le rendu partiel d'une
  // page interdite quand l'API renvoie 403 (le menu masqué ne suffit pas).
  const section = [...NAV_ITEMS].sort((a, b) => b.href.length - a.href.length)
    .find((item) => pathname === item.href || pathname.startsWith(item.href + '/'));
  const accesRefuse = userRole && section && !section.roles.includes(userRole) && pathname !== '/ma-societe';

  return (
    <div className="flex h-screen bg-gray-50 overflow-hidden">
      {/* ── Sidebar ─────────────────────────────────────────── */}
      <aside className={cn(
        'flex flex-col bg-[#1B3F6B] text-white transition-all duration-300 z-20',
        sidebarOpen ? 'w-64' : 'w-16'
      )}>
        {/* Logo */}
        <div className="flex items-center justify-between h-16 px-4 border-b border-[#2471A3]">
          {sidebarOpen && (
            <span className="flex items-center gap-2 font-bold text-lg tracking-tight">
              <LogoIcon size={26} variant="dark" />
              <LogoWordmark variant="dark" />
            </span>
          )}
          <button onClick={() => setSidebarOpen(!sidebarOpen)} className="p-1 rounded hover:bg-[#2471A3] transition-colors">
            {sidebarOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>

        {/* Nav items */}
        <nav className="flex-1 overflow-y-auto py-4 space-y-1 px-2">
          {visibleItems.map((item) => {
            const Icon = item.icon;
            const active = pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors',
                  active
                    ? 'bg-[#2471A3] text-white font-medium'
                    : 'text-blue-100 hover:bg-[#2471A3]/60'
                )}
                title={!sidebarOpen ? item.label : undefined}
              >
                <Icon size={18} className="flex-shrink-0" />
                {sidebarOpen && <span>{item.label}</span>}
              </Link>
            );
          })}
        </nav>

        {/* User info */}
        <div className="border-t border-[#2471A3] p-3">
          <div className={cn('flex items-center gap-3', !sidebarOpen && 'justify-center')}>
            <div className="w-8 h-8 rounded-full bg-[#0E7C6B] flex items-center justify-center text-xs font-bold flex-shrink-0">
              {session?.user?.name?.charAt(0)?.toUpperCase() || 'U'}
            </div>
            {sidebarOpen && (
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium truncate">{session?.user?.name}</p>
                <p className="text-xs text-blue-300 truncate">{userRole}</p>
              </div>
            )}
            {sidebarOpen && (
              <button onClick={() => signOut()} className="p-1 hover:text-red-300 transition-colors" title="Déconnexion">
                <LogOut size={16} />
              </button>
            )}
          </div>
        </div>
      </aside>

      {/* ── Main content ────────────────────────────────────── */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <header className="h-16 bg-white border-b border-gray-200 flex items-center justify-between px-6 flex-shrink-0">
          <div className="flex items-center gap-4">
            <h1 className="text-gray-800 font-semibold text-sm">
              {visibleItems.find(i => pathname.startsWith(i.href))?.label || 'Portail'}
            </h1>
          </div>
          <div className="flex items-center gap-3">
            <NotificationBell />
            <div className="text-xs text-gray-500">
              {new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}
            </div>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-auto p-6">
          {accesRefuse ? (
            <div className="flex h-full flex-col items-center justify-center text-center">
              <div className="rounded-full bg-red-50 p-4"><ShieldAlert size={32} className="text-red-500" /></div>
              <h2 className="mt-4 text-lg font-semibold text-gray-800">Accès refusé</h2>
              <p className="mt-1 max-w-sm text-sm text-gray-500">Cette section n&apos;est pas accessible avec votre rôle ({userRole || '—'}).</p>
              <Link href="/dashboard" className="mt-4 rounded-lg bg-[#1B3F6B] px-4 py-2 text-sm font-medium text-white hover:bg-[#2471A3]">Retour au tableau de bord</Link>
            </div>
          ) : children}
        </main>
      </div>
    </div>
  );
}
