import { auth } from '@/lib/auth';
import { TransporteurDashboard } from '@/components/dashboard/TransporteurDashboard';
import { DashboardInterne } from './DashboardInterne';
import { DashboardNoc } from './DashboardNoc';

/**
 * Aiguillage par rôle, CÔTÉ SERVEUR.
 *
 * L'aiguillage vivait dans un composant client, décidé d'après `useSession()`.
 * Or la session client n'est pas propagée instantanément après une connexion
 * sans rechargement (signIn `redirect: false` puis `router.push`) : pendant
 * cette fenêtre le rôle était vide, la branche PAR DÉFAUT - le tableau de bord
 * général - se montait pour un transporteur, tirait des endpoints qui lui sont
 * refusés (403) et pouvait rester affichée. Ici `auth()` lit le cookie de
 * session sur le serveur : le rôle est connu AVANT le premier rendu, il n'y a
 * plus de fenêtre où il serait inconnu.
 *
 * Le TRANSPORTEUR (prestataire externe) n'a pas accès aux agrégats du parc :
 * /rapports/dashboard lui est fermé côté API et le canal supervision lui est
 * refusé. Il reçoit un tableau de bord bâti sur ses seuls chargements.
 */
export default async function DashboardPage() {
  const session = await auth();
  const role = (session?.user as { role?: string } | undefined)?.role ?? '';
  if (role === 'TRANSPORTEUR') return <TransporteurDashboard />;
  // Le NOC supervise le réseau, pas la logistique : son tableau de bord est
  // l'état des coupures (le dashboard interne est centré stock carburant).
  if (role === 'NOC') return <DashboardNoc />;
  return <DashboardInterne />;
}
