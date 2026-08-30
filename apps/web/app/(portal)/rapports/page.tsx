'use client';

import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { FileText, Fuel, Zap, Wrench, AlertTriangle, CalendarRange, ClipboardCheck, CalendarClock, FileSpreadsheet , ShieldCheck, Shield, Leaf, WifiOff } from 'lucide-react';

// `internesSeulement` = bloqué serveur pour les comptes prestataires (liste
// INTERNE_ONLY de l'API) : la carte ne doit pas s'afficher pour eux.
// `roles` = rbac serveur plus étroit que l'accès à la page Rapports.
const RAPPORTS: Array<{
  href: string; icon: React.ComponentType<{ size?: number; className?: string }>;
  title: string; desc: string; roles?: string[]; internesSeulement?: boolean;
}> = [
  { href: '/rapports/mensuel', icon: CalendarRange, title: 'Rapport mensuel', desc: 'Synthèse PDF complète par mois, à consulter ou envoyer par email.', roles: ['MANAGER', 'ADMIN', 'DIRECTION'] },
  { href: '/rapports/fiche-validation', icon: FileSpreadsheet, title: 'Fiche de validation (prestataire)', desc: 'Export xlsx des travaux contractuels réalisés par prestataire et par mois, au format de validation.', internesSeulement: true },
  { href: '/rapports/echeancier-preventif', icon: CalendarClock, title: 'Échéancier préventif', desc: 'Tâches contractuelles dues / en retard par site et prestataire, et génération du planning.' },
  { href: '/rapports/conformite', icon: ClipboardCheck, title: 'Conformité maintenances', desc: 'Maintenances passives clôturées avec relevés énergie, par prestataire.' },
  { href: '/rapports/sla', icon: ShieldCheck, title: 'SLA prestataires', desc: 'Respect des délais et du préventif par prestataire, pénalités estimées.' },
  { href: '/rapports/gardiennage', icon: Shield, title: 'Gardiennage', desc: 'Présence des agents de sécurité constatée en intervention, par société.', internesSeulement: true },
  { href: '/carburant/stock', icon: Fuel, title: 'Stock carburant', desc: 'État du stock et autonomie de chaque site.' },
  { href: '/energie/rapports', icon: Zap, title: 'Consommation énergie', desc: 'Tendances kWh et gasoil sur la période.' },
  { href: '/rapports/empreinte-carbone', icon: Leaf, title: 'Empreinte carbone', desc: 'Émissions de CO₂ (gasoil GE, réseau CEET) et émissions évitées par le solaire, par mois, région et site.', internesSeulement: true },
  { href: '/rapports/arcep', icon: ShieldCheck, title: 'Conformité ARCEP (DR1/DR2)', desc: 'Seuils réglementaires de l\u2019arrêté n°005/MENTD/CAB : indisponibilités ≥ 1 h sur 30 jours et par jour, station par station.' },
  { href: '/rapports/disponibilite-reseau', icon: WifiOff, title: 'Disponibilité réseau', desc: 'Coupures radio (NOC) : downtime par site, coupures en cours, part imputable à l\u2019énergie.' },
  { href: '/maintenance', icon: Wrench, title: 'Maintenances', desc: 'Suivi des interventions préventives et curatives.' },
  { href: '/incidents/kpis', icon: AlertTriangle, title: 'KPIs incidents', desc: 'MTTR, MTTI et taux de résolution.' },
];

export default function RapportsHubPage() {
  const { data: session } = useSession();
  const role = (session?.user as { role?: string })?.role ?? '';
  // Même requête (et même cache) que le layout : non-null = compte prestataire.
  const { data: maSociete, isLoading: societeInconnue } = useQuery({
    queryKey: ['ma-societe'],
    queryFn: () => api.get('/ma-societe').then((r) => r.data.data as { nom: string } | null),
    staleTime: 10 * 60_000,
  });
  const visibles = RAPPORTS.filter((r) =>
    (!r.roles || r.roles.includes(role))
    && (!r.internesSeulement || (!societeInconnue && !maSociete)));

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-gray-800">Rapports</h1>
        <p className="text-sm text-gray-500 mt-0.5">Centre des rapports et exports</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {visibles.map((r) => {
          const Icon = r.icon;
          return (
            <Link key={r.href} href={r.href} className="group bg-white rounded-xl border border-gray-100 p-5 hover:shadow-md hover:border-[#2471A3]/30 transition-all">
              <div className="flex items-start gap-3">
                <div className="p-3 rounded-xl bg-[#1B3F6B] group-hover:bg-[#2471A3] transition-colors">
                  <Icon size={20} className="text-white" />
                </div>
                <div>
                  <h3 className="font-semibold text-gray-800 text-sm flex items-center gap-1">{r.title} <FileText size={12} className="text-gray-300" /></h3>
                  <p className="text-xs text-gray-500 mt-1">{r.desc}</p>
                </div>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
