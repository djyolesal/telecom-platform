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
 * La clé d'authentification passe en EN-TÊTE : Authorization: Bearer <clé>.
 * Destinataires en numéros LOCAUX (sans +228).
 * NB : si la passerelle attend d'autres noms de champs, seule cette fonction change.
 */
async function envoyerSmsBatch(telephonesLocaux: string[], message: string): Promise<string> {
  let res: Response;
  try {
    res = await fetch(env.SMS_API_URL!, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.SMS_API_KEY ?? ''}`,
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
  const body = await res.text();
  // Ne jamais inclure le corps ENVOYÉ dans l'erreur : il contient la clé API.
  if (!res.ok) throw new Error(`Passerelle SMS: HTTP ${res.status} ${body.slice(0, 120)}`);
  return body; // réponse de la passerelle (pour un statut par numéro éventuel)
}

/**
 * Extrait, quand la passerelle le fournit, la liste des numéros LOCAUX en échec
 * dans sa réponse JSON. Best-effort : on reconnaît les formes courantes
 * (`failed`/`invalid`/`errors`, ou `results:[{recipient,status}]`). Si le format
 * est inconnu, on renvoie un Set vide (statut global ENVOYE conservé).
 */
export function numerosEnEchec(reponse: string): Set<string> {
  const out = new Set<string>();
  let j: unknown;
  try { j = JSON.parse(reponse); } catch { return out; }
  const asStr = (v: unknown) => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : null);
  const push = (v: unknown) => { const s = asStr(v); if (s) out.add(telephoneLocal(s)); };
  const o = j as Record<string, unknown>;
  for (const cle of ['failed', 'invalid', 'errors', 'echecs']) {
    const arr = o?.[cle];
    if (Array.isArray(arr)) arr.forEach((x) => push(typeof x === 'object' && x ? (x as Record<string, unknown>).recipient ?? (x as Record<string, unknown>).to ?? (x as Record<string, unknown>).number : x));
  }
  const results = o?.results ?? o?.data;
  if (Array.isArray(results)) {
    for (const r of results as Record<string, unknown>[]) {
      const ok = r.success === true || String(r.status ?? '').toLowerCase().match(/sent|delivered|ok|success|accepted/);
      if (!ok) push(r.recipient ?? r.to ?? r.number ?? r.msisdn);
    }
  }
  return out;
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
  let statutLot: ResultatEnvoiManuel['statut'] = simule ? 'SIMULE' : 'ENVOYE';
  let erreurLot: string | null = null;
  let echecs = new Set<string>();
  if (!simule && destinataires.length) {
    try {
      const reponse = await envoyerSmsBatch(destinataires.map((d) => telephoneLocal(d.telephone)), message);
      echecs = numerosEnEchec(reponse); // numéros rejetés par la passerelle (si signalés)
    } catch (e) {
      statutLot = 'ECHEC';
      erreurLot = e instanceof Error ? e.message.slice(0, 200) : 'Erreur inconnue';
    }
  }
  const resultats: ResultatEnvoiManuel[] = [];
  for (const d of destinataires) {
    const telephone = normaliserTelephone(d.telephone);
    // Statut PAR numéro : le lot est ENVOYE, mais un numéro signalé en échec par
    // la passerelle est marqué ECHEC individuellement (fini le « tout envoyé »).
    const rejete = statutLot === 'ENVOYE' && echecs.has(telephoneLocal(d.telephone));
    const statut = rejete ? 'ECHEC' : statutLot;
    const erreur = rejete ? 'Rejeté par la passerelle' : erreurLot;
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
    let statutLot = simule ? 'SIMULE' : 'ENVOYE';
    let erreurLot: string | null = null;
    let echecs = new Set<string>();
    if (!simule) {
      try {
        const reponse = await envoyerSmsBatch(cibles.map((c) => telephoneLocal(c.telephone)), message);
        echecs = numerosEnEchec(reponse);
      } catch (e) {
        statutLot = 'ECHEC';
        erreurLot = e instanceof Error ? e.message.slice(0, 200) : 'Erreur inconnue';
      }
    }
    for (const c of cibles) {
      const rejete = statutLot === 'ENVOYE' && echecs.has(telephoneLocal(c.telephone));
      await prisma.smsLog.create({
        data: {
          telephone: normaliserTelephone(c.telephone), contactId: c.id, message, evenement,
          statut: rejete ? 'ECHEC' : statutLot,
          erreur: rejete ? 'Rejeté par la passerelle' : erreurLot,
        },
      });
    }
    logger.info(`[sms] ${evenement} ${evt.siteNom} → ${cibles.length} contact(s)${simule ? ' (SIMULE)' : ''}`);
  } catch (err) {
    logger.warn('[sms] notification contacts échouée:', err);
  }
}

/**
 * Notification SMS liée à une coupure réseau (incident auto créé/rouvert par le
 * NOC) : cible les contacts « incidents » du/des prestataires en charge du site
 * (assignations du lot), plus les contacts « toutes sociétés » (supervision interne).
 */
export async function notifierIncidentCoupure(siteId: string, message: string, evenement: string): Promise<void> {
  try {
    const site = await prisma.site.findUnique({
      where: { id: siteId },
      select: { lot: { select: { assignments: { select: { prestataireId: true } } } } },
    });
    const prestataires = new Set((site?.lot?.assignments ?? []).map((a) => a.prestataireId));

    const contacts = await prisma.contact.findMany({ where: { actif: true, notifIncidents: true } });
    const cibles = contacts.filter(
      (c) => c.toutesSocietes || (c.prestataireId != null && prestataires.has(c.prestataireId))
    );
    if (!cibles.length) return;

    const simule = !env.SMS_API_URL;
    let statutLot = simule ? 'SIMULE' : 'ENVOYE';
    let erreurLot: string | null = null;
    let echecs = new Set<string>();
    if (!simule) {
      try {
        const reponse = await envoyerSmsBatch(cibles.map((c) => telephoneLocal(c.telephone)), message);
        echecs = numerosEnEchec(reponse);
      } catch (e) {
        statutLot = 'ECHEC';
        erreurLot = e instanceof Error ? e.message.slice(0, 200) : 'Erreur inconnue';
      }
    }
    for (const c of cibles) {
      const rejete = statutLot === 'ENVOYE' && echecs.has(telephoneLocal(c.telephone));
      await prisma.smsLog.create({
        data: {
          telephone: normaliserTelephone(c.telephone), contactId: c.id, message, evenement,
          statut: rejete ? 'ECHEC' : statutLot,
          erreur: rejete ? 'Rejeté par la passerelle' : erreurLot,
        },
      });
    }
    logger.info(`[sms] ${evenement} → ${cibles.length} contact(s)${simule ? ' (SIMULE)' : ''}`);
  } catch (err) {
    logger.warn('[sms] notification incident-coupure échouée:', err);
  }
}
