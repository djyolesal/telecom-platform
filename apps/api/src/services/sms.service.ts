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
  siteNom: string;
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

/** Numéro LOCAL togolais (8 chiffres, sans +228) — format attendu par la passerelle. */
export function telephoneLocal(tel: string): string {
  const digits = normaliserTelephone(tel).replace(/^\+/, '');
  return digits.startsWith('228') ? digits.slice(3) : digits;
}

/**
 * Envoi d'un SMS à PLUSIEURS destinataires en UNE requête :
 *   POST <SMS_API_URL>  (JSON)
 *   { "sender": <expéditeur>, "recipients": ["9XXXXXXX", …], "message": <texte> }
 * La clé d'authentification passe en EN-TÊTE — envoyée sous les deux formes
 * usuelles (Authorization: Bearer et X-API-Key), la passerelle ignore celle
 * qu'elle ne connaît pas. Destinataires en numéros LOCAUX (sans +228).
 * NB : si la passerelle attend d'autres noms de champs, seule cette fonction change.
 */
async function envoyerSmsBatch(telephonesLocaux: string[], message: string): Promise<void> {
  let res: Response;
  try {
    res = await fetch(env.SMS_API_URL!, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.SMS_API_KEY ?? ''}`,
        'X-API-Key': env.SMS_API_KEY ?? '',
      },
      body: JSON.stringify({
        sender: env.SMS_SENDER,
        recipients: telephonesLocaux,
        message,
      }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (e) {
    // « fetch failed » de Node masque la cause réseau réelle (ECONNREFUSED,
    // ETIMEDOUT, ENOTFOUND…) dans e.cause : on la remonte pour le diagnostic.
    const cause = (e as { cause?: { code?: string; message?: string } }).cause;
    const detail = cause?.code ?? cause?.message ?? (e instanceof Error && e.name === 'TimeoutError' ? 'délai dépassé (15 s)' : null);
    throw new Error(
      `Passerelle SMS injoignable${detail ? ` (${detail})` : ''} — vérifier SMS_API_URL et l'accès réseau depuis le conteneur API`
    );
  }
  // Ne jamais inclure le corps envoyé dans l'erreur : il contient la clé API.
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
  let statut: ResultatEnvoiManuel['statut'] = simule ? 'SIMULE' : 'ENVOYE';
  let erreur: string | null = null;
  if (!simule && destinataires.length) {
    try {
      await envoyerSmsBatch(destinataires.map((d) => telephoneLocal(d.telephone)), message);
    } catch (e) {
      statut = 'ECHEC';
      erreur = e instanceof Error ? e.message.slice(0, 200) : 'Erreur inconnue';
    }
  }
  const resultats: ResultatEnvoiManuel[] = [];
  for (const d of destinataires) {
    const telephone = normaliserTelephone(d.telephone);
    await prisma.smsLog.create({
      data: { telephone, contactId: d.contactId ?? null, message, evenement: 'MANUEL', statut, erreur },
    });
    resultats.push({ telephone, contactId: d.contactId ?? null, statut, erreur });
  }
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
      `${evt.detail ? ` ${evt.detail}` : ''} sur ${evt.siteNom} à ${heure}.`;

    const evenement = `${evt.domaine}_${evt.evenement}`;
    const simule = !env.SMS_API_URL;

    // Un seul POST pour tout le lot (l'API accepte la liste des destinataires).
    let statut = simule ? 'SIMULE' : 'ENVOYE';
    let erreur: string | null = null;
    if (!simule) {
      try {
        await envoyerSmsBatch(cibles.map((c) => telephoneLocal(c.telephone)), message);
      } catch (e) {
        statut = 'ECHEC';
        erreur = e instanceof Error ? e.message.slice(0, 200) : 'Erreur inconnue';
      }
    }
    for (const c of cibles) {
      await prisma.smsLog.create({
        data: { telephone: normaliserTelephone(c.telephone), contactId: c.id, message, evenement, statut, erreur },
      });
    }
    logger.info(`[sms] ${evenement} ${evt.siteNom} → ${cibles.length} contact(s)${simule ? ' (SIMULE)' : ''}`);
  } catch (err) {
    logger.warn('[sms] notification contacts échouée:', err);
  }
}
