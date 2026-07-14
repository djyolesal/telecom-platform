import { prisma } from '../config/database';
import { env } from '../config/env';
import { logger } from '../utils/logger';

/**
 * Notifications SMS vers le carnet de contacts (personnel interne, prestataires,
 * techniciens) quand un technicien démarre ou clôture une action terrain.
 *
 * Passerelle : API SMS Pro Moov Africa (contrat requis). Tant que SMS_API_URL
 * n'est pas configurée, les envois passent en mode SIMULE : ils sont journalisés
 * dans sms_logs mais rien ne part — la fonctionnalité se teste sans coût, et
 * s'active en renseignant les variables d'environnement, sans redéploiement de code.
 *
 * Ciblage : chaque contact choisit ses événements (démarrage/clôture,
 * maintenances/incidents) et son périmètre (sa société seulement, ou toutes).
 */

export interface EvenementAction {
  domaine: 'MAINTENANCE' | 'INCIDENT';
  evenement: 'DEMARRAGE' | 'CLOTURE';
  siteCode: string;
  /** Utilisateur qui exécute l'action (technicien). */
  technicienId: string;
  /** Précision affichée dans le message (ex: "préventive", "coupure totale"). */
  detail?: string;
}

/** +228XXXXXXXX : les numéros du fichier sont à 8 chiffres locaux Togo. */
export function normaliserTelephone(tel: string): string {
  const digits = tel.replace(/[^\d+]/g, '');
  if (digits.startsWith('+')) return digits;
  if (digits.startsWith('228')) return `+${digits}`;
  return `+228${digits}`;
}

/**
 * Envoi d'UN SMS via la passerelle Kannel (SMS Pro Moov Africa) :
 *   GET http://<ip>:<port>/cgi-bin/sendsms?username=…&password=…&smsc=…&from=…&to=…&text=…
 * Kannel répond 202 « 0: Accepted for delivery » en cas de succès (res.ok le couvre).
 * charset=UTF-8 pour que les accents (é, à, …) passent correctement.
 * NB : `to` accepte plusieurs numéros séparés par des virgules, mais on envoie
 * numéro par numéro pour journaliser un statut individuel par contact.
 */
async function envoyerSms(telephone: string, message: string): Promise<void> {
  const url = new URL(env.SMS_API_URL!);
  url.searchParams.set('username', env.SMS_USERNAME ?? '');
  url.searchParams.set('password', env.SMS_PASSWORD ?? '');
  if (env.SMS_SMSC) url.searchParams.set('smsc', env.SMS_SMSC);
  url.searchParams.set('from', env.SMS_SENDER);
  url.searchParams.set('to', telephone);
  url.searchParams.set('text', message);
  url.searchParams.set('charset', 'UTF-8');
  const res = await fetch(url);
  // Ne jamais inclure l'URL dans l'erreur : elle contient le mot de passe.
  if (!res.ok) throw new Error(`Passerelle SMS: HTTP ${res.status} ${(await res.text()).slice(0, 120)}`);
}

export interface ResultatEnvoiManuel {
  telephone: string;
  contactId: string | null;
  statut: 'ENVOYE' | 'ECHEC' | 'SIMULE';
  erreur: string | null;
}

/**
 * Envoi manuel d'un SMS à une liste de destinataires (endpoint POST /sms/send).
 * Même passerelle et même mode SIMULE que les notifications automatiques ;
 * chaque envoi est journalisé dans sms_logs avec l'événement MANUEL.
 */
export async function envoyerSmsManuel(
  destinataires: { telephone: string; contactId?: string | null }[],
  message: string
): Promise<{ simule: boolean; resultats: ResultatEnvoiManuel[] }> {
  const simule = !env.SMS_API_URL;
  const resultats = await Promise.all(
    destinataires.map(async (d): Promise<ResultatEnvoiManuel> => {
      const telephone = normaliserTelephone(d.telephone);
      let statut: ResultatEnvoiManuel['statut'] = simule ? 'SIMULE' : 'ENVOYE';
      let erreur: string | null = null;
      if (!simule) {
        try {
          await envoyerSms(telephone, message);
        } catch (e) {
          statut = 'ECHEC';
          erreur = e instanceof Error ? e.message.slice(0, 200) : 'Erreur inconnue';
        }
      }
      await prisma.smsLog.create({
        data: { telephone, contactId: d.contactId ?? null, message, evenement: 'MANUEL', statut, erreur },
      });
      return { telephone, contactId: d.contactId ?? null, statut, erreur };
    })
  );
  logger.info(`[sms] envoi manuel → ${resultats.length} destinataire(s)${simule ? ' (SIMULE)' : ''}`);
  return { simule, resultats };
}

/**
 * Notifie les contacts concernés par une action. Best-effort et non bloquant :
 * à appeler en `void notifierAction(...)` — un échec SMS ne doit jamais faire
 * échouer le démarrage ou la clôture.
 */
export async function notifierAction(evt: EvenementAction): Promise<void> {
  try {
    const technicien = await prisma.user.findUnique({
      where: { id: evt.technicienId },
      select: { nom: true, prenom: true, prestataireId: true, prestataire: { select: { nom: true } } },
    });
    if (!technicien) return;

    const contacts = await prisma.contact.findMany({
      where: {
        actif: true,
        ...(evt.evenement === 'DEMARRAGE' ? { notifDemarrage: true } : { notifCloture: true }),
        ...(evt.domaine === 'MAINTENANCE' ? { notifMaintenances: true } : { notifIncidents: true }),
      },
    });
    // Périmètre : « toutes sociétés », ou même société que le technicien
    // (contact interne ↔ technicien interne, prestataireId null des deux côtés).
    const cibles = contacts.filter(
      (c) => c.toutesSocietes || (c.prestataireId ?? null) === (technicien.prestataireId ?? null)
    );
    if (!cibles.length) return;

    const verbe = evt.evenement === 'DEMARRAGE' ? 'a démarré' : 'a clôturé';
    const objet = evt.domaine === 'MAINTENANCE' ? 'une maintenance' : 'une intervention incident';
    const heure = new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Lome' });
    const societe = technicien.prestataire?.nom ?? 'interne';
    const message =
      `[E&M OpS] ${technicien.prenom} ${technicien.nom} (${societe}) ${verbe} ${objet}` +
      `${evt.detail ? ` ${evt.detail}` : ''} sur ${evt.siteCode} à ${heure}.`;

    const evenement = `${evt.domaine}_${evt.evenement}`;
    const simule = !env.SMS_API_URL;

    await Promise.allSettled(
      cibles.map(async (c) => {
        const telephone = normaliserTelephone(c.telephone);
        let statut = simule ? 'SIMULE' : 'ENVOYE';
        let erreur: string | null = null;
        if (!simule) {
          try {
            await envoyerSms(telephone, message);
          } catch (e) {
            statut = 'ECHEC';
            erreur = e instanceof Error ? e.message.slice(0, 200) : 'Erreur inconnue';
          }
        }
        await prisma.smsLog.create({ data: { telephone, contactId: c.id, message, evenement, statut, erreur } });
      })
    );
    logger.info(`[sms] ${evenement} ${evt.siteCode} → ${cibles.length} contact(s)${simule ? ' (SIMULE)' : ''}`);
  } catch (err) {
    logger.warn('[sms] notification contacts échouée:', err);
  }
}
