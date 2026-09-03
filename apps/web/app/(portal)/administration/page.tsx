'use client';

import Link from 'next/link';
import {Users, ShieldCheck, Settings, SlidersHorizontal, ScrollText, ServerCog, Building2, Boxes, ClipboardList, RadioTower, MessageSquareText, Columns3, Database, AlertTriangle, Wrench , WifiOff } from 'lucide-react';

const SECTIONS = [
  { href: '/administration/utilisateurs', icon: Users, title: 'Utilisateurs', desc: 'Créer, modifier et désactiver les comptes.' },
  { href: '/administration/prestataires', icon: Building2, title: 'Prestataires', desc: 'Sociétés de maintenance externes.' },
  { href: '/administration/contacts', icon: MessageSquareText, title: 'Contacts SMS', desc: 'Personnes notifiées au démarrage/clôture des actions.' },
  { href: '/administration/lots', icon: Boxes, title: 'Lots de maintenance', desc: 'Lots de sites, attributions passive/active.' },
  { href: '/administration/roles', icon: ShieldCheck, title: 'Rôles & permissions', desc: 'Matrice des droits par rôle.' },
  { href: '/administration/parametres', icon: Settings, title: 'Paramètres système', desc: 'Configuration générale de la plateforme.' },
  { href: '/administration/seuils', icon: SlidersHorizontal, title: 'Seuils d\'alerte', desc: 'Seuils carburant et tarifs énergie.' },
  { href: '/administration/colonnes', icon: Columns3, title: 'Colonnes des tableaux', desc: 'Colonnes optionnelles proposées aux utilisateurs (GPS, marque GE, gardiennage…).' },
  { href: '/administration/taches-preventives', icon: ClipboardList, title: 'Tâches préventives', desc: 'Libellé et fréquence du catalogue contractuel.' },
  { href: '/administration/types-pylone', icon: RadioTower, title: 'Types de pylône', desc: 'Référentiel éditable des types de pylône.' },
  { href: '/administration/types-incident', icon: AlertTriangle, title: "Types d'incident", desc: 'Référentiel des formulaires de déclaration (web et mobile).' },
  { href: '/administration/motifs-coupure', icon: WifiOff, title: 'Motifs de coupure', desc: 'Formulations suggérées au NOC (cause, actions) pour unifier les saisies.' },
  { href: '/administration/equipements', icon: Wrench, title: 'Équipements de dépannage', desc: 'ATS, TGBT, GE… — la catégorie route vers le bon contrat.' },
  { href: '/administration/audit', icon: ScrollText, title: 'Journal d\'audit', desc: 'Historique des actions sensibles.' },
  { href: '/administration/serveur', icon: ServerCog, title: 'Santé serveur', desc: 'État des services, métriques et monitoring.' },
  { href: '/administration/base-de-donnees', icon: Database, title: 'Base de données', desc: 'Consulter et corriger les données de toutes les tables.' },
];

export default function AdministrationHubPage() {
  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-gray-800">Administration</h1>
        <p className="text-sm text-gray-500 mt-0.5">Gestion de la plateforme et du serveur</p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {SECTIONS.map((s) => {
          const Icon = s.icon;
          return (
            <Link key={s.href} href={s.href} className="group bg-white rounded-xl border border-gray-100 p-5 hover:shadow-md hover:border-[#2471A3]/30 transition-all">
              <div className="flex items-start gap-3">
                <div className="p-3 rounded-xl bg-[#1B3F6B] group-hover:bg-[#2471A3] transition-colors">
                  <Icon size={20} className="text-white" />
                </div>
                <div>
                  <h3 className="font-semibold text-gray-800 text-sm">{s.title}</h3>
                  <p className="text-xs text-gray-500 mt-1">{s.desc}</p>
                </div>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
