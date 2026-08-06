'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useSession, signOut } from 'next-auth/react';
import {
  LayoutDashboard, MapPin, Wrench, Fuel, Zap, AlertTriangle,
  BarChart3, Settings, Users, Bell, Menu, X, LogOut, Activity, Truck, Boxes, ShieldAlert, LineChart, Gauge, Building2, WifiOff, Network, ArrowLeftRight
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { NotificationBell } from '@/components/shared/NotificationBell';
import { LogoIcon, LogoWordmark } from '@/components/shared/Logo';

// ── Menu latéral, par domaines ──────────────────────────────────────────────
// `groupe` regroupe visuellement ; un groupe sans entrée visible pour le rôle
// n'affiche pas son titre. `roles` = accès à la section ; `menu` (optionnel)
// restreint l'AFFICHAGE dans la barre sans retirer l'accès.
const GROUPES: Array<{ key: string; titre: string | null }> = [
  { key: 'accueil',     titre: null },
  { key: 'terrain',     titre: 'Terrain' },
  { key: 'carburant',   titre: 'Carburant' },
  { key: 'supervision', titre: 'Supervision' },
  { key: 'pilotage',    titre: 'Pilotage' },
];

const NAV_ITEMS = [
  { groupe: 'accueil', href: '/dashboard', label: 'Tableau de bord', icon: LayoutDashboard, roles: ['TECHNICIEN','SUPERVISEUR','MANAGER','ADMIN','DIRECTION','NOC','TRANSPORTEUR'] },

  // ── Terrain : le quotidien des équipes d'exploitation ──
  { groupe: 'terrain', href: '/sites',       label: 'Sites',         icon: MapPin,        roles: ['TECHNICIEN','SUPERVISEUR','MANAGER','ADMIN','NOC'] },
  { groupe: 'terrain', href: '/maintenance', label: 'Maintenance',   icon: Wrench,        roles: ['TECHNICIEN','SUPERVISEUR','MANAGER','ADMIN'] },
  { groupe: 'terrain', href: '/incidents',   label: 'Incidents',     icon: AlertTriangle, roles: ['TECHNICIEN','SUPERVISEUR','MANAGER','ADMIN','NOC'] },
  { groupe: 'terrain', href: '/actifs',      label: "Parc d'actifs", icon: Boxes,         roles: ['SUPERVISEUR','MANAGER','ADMIN'] },
  { groupe: 'terrain', href: '/energie',     label: 'Énergie',       icon: Zap,           roles: ['SUPERVISEUR','MANAGER','ADMIN'] },

  // ── Carburant : stock, appro et flotte ──
  { groupe: 'carburant', href: '/carburant/stock',      label: 'Stock carburant',  icon: Fuel,           roles: ['SUPERVISEUR','MANAGER','ADMIN'] },
  // Bilan sur période libre : stock aux bornes + conso par conservation.
  { groupe: 'carburant', href: '/carburant/bilan',      label: 'Bilan conso & stock', icon: BarChart3,   roles: ['SUPERVISEUR','MANAGER','ADMIN','DIRECTION'] },
  { groupe: 'carburant', href: '/carburant/commandes',  label: 'Appro. carburant', icon: Truck,          roles: ['TRANSPORTEUR','MANAGER','ADMIN'] },
  // Fiches de chargement : le transporteur n'ouvre que LES SIENNES (l'API
  // filtre et revérifie son prestataire) — sans cette entrée, la section
  // hors-menu /carburant lui refusait la fiche d'un BL.
  { groupe: 'carburant', href: '/carburant/livraisons', label: 'Mes chargements',  icon: Truck,          roles: ['TRANSPORTEUR','SUPERVISEUR','MANAGER','ADMIN'], menu: ['TRANSPORTEUR'] },
  // Transferts, purges et avoirs : écritures hors chaîne BC → BL → dépotage.
  { groupe: 'carburant', href: '/carburant/mouvements', label: 'Mouvements gasoil', icon: ArrowLeftRight, roles: ['SUPERVISEUR','MANAGER','ADMIN','DIRECTION'] },
  { groupe: 'carburant', href: '/carburant/pertes',     label: 'Pertes carburant', icon: ShieldAlert,    roles: ['SUPERVISEUR','MANAGER','ADMIN','DIRECTION'] },
  // Référentiels camions/chauffeurs : le transporteur y gère SON parc (l'API le
  // filtre), le pilotage y renseigne capacités de citerne et jaugeages.
  { groupe: 'carburant', href: '/carburant/flotte',     label: 'Flotte transport', icon: Truck,          roles: ['TRANSPORTEUR','MANAGER','ADMIN'], menu: ['TRANSPORTEUR','MANAGER','ADMIN'] },

  // ── Supervision réseau : temps réel et topologie ──
  // TRANSPORTEUR inclus sur la carte : l'API lui sert une vue dédiée (ses sites
  // à livrer, sans aucune donnée d'exploitation dans l'info-bulle).
  { groupe: 'supervision', href: '/supervision/carte',     label: 'Carte',           icon: MapPin,   roles: ['SUPERVISEUR','MANAGER','ADMIN','NOC','TRANSPORTEUR'] },
  { groupe: 'supervision', href: '/supervision/incidents', label: 'Incidents live',  icon: Activity, roles: ['SUPERVISEUR','MANAGER','ADMIN','NOC'] },
  { groupe: 'supervision', href: '/supervision/coupures',  label: 'Coupures réseau', icon: WifiOff,  roles: ['SUPERVISEUR','MANAGER','ADMIN','DIRECTION','NOC'] },
  { groupe: 'supervision', href: '/supervision/topologie', label: 'Topologie',       icon: Network,  roles: ['SUPERVISEUR','MANAGER','ADMIN','DIRECTION','NOC'] },
  // Entrée directe pour le NOC (les autres rôles y accèdent via la page Rapports :
  // `menu` restreint l'affichage dans la barre, `roles` reste la liste d'accès).
  { groupe: 'supervision', href: '/rapports/disponibilite-reseau', label: 'Dispo réseau', icon: BarChart3, roles: ['NOC','SUPERVISEUR','MANAGER','ADMIN','DIRECTION'], menu: ['NOC'] },

  // ── Pilotage : direction, analyses et administration ──
  { groupe: 'pilotage', href: '/direction',      label: 'Direction',      icon: LineChart, roles: ['MANAGER','ADMIN','DIRECTION'] },
  { groupe: 'pilotage', href: '/fiabilite-ge',   label: 'Fiabilité GE',   icon: Gauge,     roles: ['MANAGER','ADMIN','DIRECTION'] },
  { groupe: 'pilotage', href: '/rapports',       label: 'Rapports',       icon: BarChart3, roles: ['SUPERVISEUR','MANAGER','ADMIN','DIRECTION'] },
  { groupe: 'pilotage', href: '/administration', label: 'Administration', icon: Settings,  roles: ['ADMIN'] },
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
    ...NAV_ITEMS.filter(item => ((item as { menu?: string[] }).menu ?? item.roles).includes(userRole)),
    ...(userRole === 'SUPERVISEUR' && maSociete ? [{ groupe: 'pilotage', href: '/ma-societe', label: 'Ma société', icon: Building2, roles: ['SUPERVISEUR'] }] : []),
  ];
  // Groupes affichés : ceux où le rôle a au moins une entrée. Le titre n'apparaît
  // que barre ouverte ; repliée, un simple filet sépare les groupes.
  const groupesVisibles = GROUPES
    .map((g) => ({ ...g, items: visibleItems.filter((i) => (i as { groupe?: string }).groupe === g.key) }))
    .filter((g) => g.items.length > 0);

  // Garde de rôle. La déduction par préfixe de menu laissait SANS AUCUNE GARDE
  // les pages qu'aucune entrée ne préfixe (/carburant/depotages, /carburant/
  // livraisons, /supervision/alertes…) : elles étaient ouvertes à tout rôle
  // connecté. Cette table couvre explicitement ces sections orphelines, et le
  // menu sert de repli pour le reste.
  const SECTIONS_HORS_MENU: Array<{ prefixe: string; roles: string[] }> = [
    { prefixe: '/carburant', roles: ['TECHNICIEN', 'SUPERVISEUR', 'MANAGER', 'ADMIN'] },
    { prefixe: '/supervision', roles: ['SUPERVISEUR', 'MANAGER', 'ADMIN', 'DIRECTION', 'NOC'] },
    { prefixe: '/energie', roles: ['TECHNICIEN', 'SUPERVISEUR', 'MANAGER', 'ADMIN'] },
    { prefixe: '/rapports', roles: ['SUPERVISEUR', 'MANAGER', 'ADMIN', 'DIRECTION', 'NOC'] },
    { prefixe: '/administration', roles: ['ADMIN'] },
  ];
  // Règles PROFONDES : une page enfouie sous une section dont elle ne partage
  // pas les rôles. Elles priment sur le menu et sur les sections hors-menu, qui
  // ne raisonnent que par préfixe — le rapprochement héritait sinon des rôles de
  // « Appro. carburant » (dont TRANSPORTEUR) et affichait une page en erreur au
  // lieu d'un « accès refusé » propre. L'API refuse déjà (rbac + INTERNE_ONLY).
  const REGLES_PROFONDES: Array<{ test: RegExp; roles: string[] }> = [
    { test: /^\/carburant\/commandes\/[^/]+\/rapprochement/, roles: ['SUPERVISEUR', 'MANAGER', 'ADMIN', 'DIRECTION'] },
  ];
  const correspond = (href: string) => pathname === href || pathname.startsWith(href + '/');
  const section = [...NAV_ITEMS].sort((a, b) => b.href.length - a.href.length).find((item) => correspond(item.href));
  const horsMenu = SECTIONS_HORS_MENU.find((s) => correspond(s.prefixe));
  const profonde = REGLES_PROFONDES.find((r) => r.test.test(pathname));
  const rolesAutorises = profonde?.roles ?? section?.roles ?? horsMenu?.roles;
  const accesRefuse = userRole && rolesAutorises && !rolesAutorises.includes(userRole) && pathname !== '/ma-societe';

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
        <nav className="flex-1 overflow-y-auto py-3 px-2">
          {groupesVisibles.map((g, gi) => (
            <div key={g.key} className={gi > 0 ? 'mt-3' : undefined}>
              {g.titre && (sidebarOpen ? (
                <p className="px-3 pb-1 text-[10px] font-bold uppercase tracking-[0.14em] text-[#7E9CBF]">{g.titre}</p>
              ) : (
                <div className="mx-2 mb-2 border-t border-[#2471A3]/60" />
              ))}
              <div className="space-y-1">
                {g.items.map((item) => {
                  const Icon = item.icon;
                  const active = pathname.startsWith(item.href);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={cn(
                        'flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors',
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
              </div>
            </div>
          ))}
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
