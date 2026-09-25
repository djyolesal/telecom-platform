import { prisma } from '../config/database';
import { env } from '../config/env';
import { logger } from '../utils/logger';
import { getNum, getRaw } from './settings.service';

// ── Modèles de SMS éditables ────────────────────────────────────────────────
// Chaque message automatique part d'un gabarit à variables {xxx}. L'admin peut
// le personnaliser (Administration → Paramètres → Modèles de SMS) : la valeur
// est stockée dans system_settings sous la clé du gabarit — vide = défaut.
export const SMS_TEMPLATES: Array<{ key: string; label: string; defaut: string; variables: string[] }> = [
  {
    key: 'sms.tpl.demarrage',
    label: "Démarrage d'intervention",
    defaut: '[E&M OpS] {technicien} ({societe}) a démarré {objet}{detail} sur {site} à {heure}.',
    variables: ['technicien', 'societe', 'objet', 'detail', 'site', 'heure'],
  },
  {
    key: 'sms.tpl.cloture',
    label: "Clôture d'intervention",
    defaut: '[E&M OpS] {technicien} ({societe}) a clôturé {objet}{detail} sur {site} à {heure}.',
    variables: ['technicien', 'societe', 'objet', 'detail', 'site', 'heure'],
  },
  {
    key: 'sms.tpl.siteHorsService',
    label: 'Site entièrement hors service (incident créé par le NOC)',
    // {impactes} arrive PRÉ-FORMATÉ (« (+3 sites aval impactés) ») ou vide :
    // le gabarit n'a pas à gérer le singulier/pluriel ni le cas zéro.
    // {technicien} arrive lui aussi PRÉ-FORMATÉ (« Technicien contacté : X. »)
    // ou vide : renseigné par le NOC, il dit au destinataire que quelqu'un est
    // déjà sur le coup — et qui rappeler.
    defaut: '[E&M OpS] NOC : site {site} entièrement hors service{impactes}. Incident {reference} - intervention terrain requise.{technicien}',
    variables: ['site', 'reference', 'impactes', 'technicien'],
  },
  {
    key: 'sms.tpl.siteRetabli',
    label: 'Site rétabli de lui-même (fin d\'alerte, avant intervention terrain)',
    // Symétrique du SMS « hors service » : mêmes destinataires, envoyé quand la
    // détection automatique voit le site remonter AVANT toute intervention.
    // {impactes} arrive PRÉ-FORMATÉ (« (+3 sites aval également rétablis) »)
    // ou vide - même convention que le gabarit d'alerte.
    defaut: '[E&M OpS] NOC : site {site} rétabli après {duree} de coupure{impactes}. Incident {reference} résolu - intervention terrain plus nécessaire.{technicien}',
    variables: ['site', 'reference', 'duree', 'impactes', 'technicien'],
  },
  {
    key: 'sms.tpl.coupurePartielle',
    label: 'Coupure partielle (équipes actives)',
    defaut: '[E&M OpS] NOC : coupure {technos} sur {site} (site alimenté) - à traiter côté actif (radio/transmission).{technicien}',
    variables: ['site', 'technos', 'technicien'],
  },
  {
    key: 'sms.tpl.partielleTerrain',
    label: 'Coupure partielle escaladée au terrain',
    defaut: '[E&M OpS] NOC : coupure {technos} toujours en cours sur {site} (site alimenté) - incident {reference}, intervention terrain requise.{technicien}',
    variables: ['site', 'technos', 'reference', 'technicien'],
  },
  {
    key: 'sms.tpl.incidentRouvert',
    label: 'Incident rouvert par le NOC',
    defaut: '[E&M OpS] NOC : coupure toujours constatée sur {site} - incident {reference} ROUVERT, merci de repasser.{technicien}',
    variables: ['site', 'reference', 'technicien'],
  },
  {
    key: 'sms.tpl.planLivraison',
    label: 'Plan de livraison transmis au transporteur',
    defaut: '[E&M OpS] Plan de livraison BL {numeroBL} ({volume} L, camion {camion}) : {nbSites} site(s) - {sites}. Bonne tournee.',
    variables: ['numeroBL', 'volume', 'camion', 'nbSites', 'sites'],
  },
  {
    key: 'sms.tpl.depotage',
    label: 'Dépotage carburant enregistré (contacts du périmètre du site)',
    // {stock} arrive PRÉ-FORMATÉ (« Stock : 1 250 L.») ou vide - même
    // convention que {impactes} : le gabarit n'a pas à gérer le cas absent.
    defaut: '[E&M OpS] Dépotage de {litres} L sur {site} par {technicien} (chauffeur : {chauffeur}). {stock}',
    variables: ['site', 'litres', 'technicien', 'chauffeur', 'stock'],
  },
  {
    key: 'sms.tpl.affectationIncident',
    label: 'Affectation d\'un incident (SMS au technicien)',
    defaut: '[E&M OpS] Incident {reference} - {site} vous est assigné ({severite}). Merci d\'intervenir.',
    variables: ['site', 'reference', 'severite'],
  },
  {
    key: 'sms.tpl.affectationMaintenance',
    label: 'Affectation d\'une maintenance (SMS au technicien)',
    defaut: '[E&M OpS] Maintenance {reference} - {site} : {equipement}, planifiée le {date}.',
    variables: ['site', 'reference', 'equipement', 'date'],
  },
  {
    key: 'notif.tpl.incidentResoluAuto',
    label: 'Notification - incident résolu sans intervention (techniciens)',
    defaut: 'Incident {reference} - {site} rétabli, résolution constatée par le NOC. Intervention terrain inutile.',
    variables: ['site', 'reference'],
  },
];

/**
 * CANAUX SMS : sur un téléphone, c'est l'EXPÉDITEUR qui crée le fil de
 * discussion. Un expéditeur unique = tout s'empile au même endroit, et plus
 * personne ne s'y retrouve. Deux leviers, indépendants et cumulables :
 *
 *  - l'ÉTIQUETTE, qui remplace le préfixe générique du message : elle rend la
 *    lecture rapide et la recherche du téléphone utilisables, tout de suite et
 *    sans rien demander à l'opérateur ;
 *  - l'EXPÉDITEUR, qui sépare réellement les fils — mais il doit être déclaré
 *    au contrat Moov. Laissé VIDE, le canal retombe sur SMS_SENDER : aucun
 *    changement tant que l'exploitant n'a pas renseigné ses identifiants.
 *
 * Les deux sont des réglages (Administration → Paramètres), donc modifiables
 * sans redéploiement — un identifiant expéditeur qui change ne doit pas
 * attendre une livraison de code.
 */
export const CANAUX_SMS: Array<{ code: string; label: string; etiquetteDefaut: string }> = [
  { code: 'INCIDENT', label: 'Incidents terrain', etiquetteDefaut: 'EMOPS INC' },
  { code: 'COUPURE', label: 'Coupures réseau', etiquetteDefaut: 'EMOPS COUP' },
  { code: 'MAINTENANCE', label: 'Maintenances préventives', etiquetteDefaut: 'EMOPS MAINT' },
  { code: 'LOGISTIQUE', label: 'Carburant : livraisons, dépotages, plans', etiquetteDefaut: 'EMOPS LIVR' },
  { code: 'SITUATION', label: 'Situations périodiques', etiquetteDefaut: 'EMOPS SITU' },
];

/**
 * Canal d'un événement. L'ordre compte : « INCIDENT_COUPURE_NOC » relève de la
 * coupure, pas de l'incident terrain — il faut donc tester COUPURE en premier.
 */
export function canalDe(evenement: string): string {
  const e = evenement.toUpperCase();
  if (e.includes('COUPURE')) return 'COUPURE';
  if (e.includes('SITUATION')) return 'SITUATION';
  if (e.includes('MAINTENANCE')) return 'MAINTENANCE';
  if (e.includes('LIVRAISON') || e.includes('DEPOTAGE') || e.includes('CHARGEMENT')) return 'LOGISTIQUE';
  if (e.includes('INCIDENT')) return 'INCIDENT';
  return 'INCIDENT';
}

/** Expéditeur du canal ; vide → celui du contrat par défaut. */
export function expediteurDe(canal: string): string | undefined {
  const brut = getRaw(`sms.canal.${canal}.expediteur`);
  const v = typeof brut === 'string' ? brut.trim() : '';
  return v || env.SMS_SENDER;
}

/**
 * Applique l'étiquette du canal en REMPLAÇANT le préfixe entre crochets du
 * gabarit (« [E&M OpS] … »). Remplacer plutôt qu'ajouter évite le doublon
 * « [EMOPS INC] [E&M OpS] … » et fonctionne aussi sur un gabarit personnalisé.
 * Idempotent. Étiquette vide = message inchangé.
 */
export function etiqueter(message: string, canal: string): string {
  const meta = CANAUX_SMS.find((c) => c.code === canal);
  const brut = getRaw(`sms.canal.${canal}.etiquette`);
  const tag = (typeof brut === 'string' ? brut : meta?.etiquetteDefaut ?? '').trim();
  if (!tag) return message;
  return `[${tag}] ${message.replace(/^\s*\[[^\]]{0,24}\]\s*/, '')}`;
}

/** Rend un gabarit : personnalisation admin si présente, sinon le défaut ;
 *  les {variables} inconnues sont effacées plutôt qu'affichées brutes. */
export function rendreTemplate(key: string, vars: Record<string, string>): string {
  const meta = SMS_TEMPLATES.find((t) => t.key === key);
  const brut = getRaw(key);
  const tpl = typeof brut === 'string' && brut.trim() ? brut : (meta?.defaut ?? '');
  return tpl.replace(/\{(\w+)\}/g, (_, v: string) => vars[v] ?? '');
}

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
// ── Translittération GSM-7 ──────────────────────────────────────────────────
// L'alphabet SMS de base (GSM-7, 160 car./segment) contient é è à ù ç mais PAS
// ê â î ô û ë ï œ, ni l'apostrophe typographique ni « » - … · . UN SEUL
// caractère hors alphabet bascule tout le message en UCS-2 (70 car./segment) :
// coût ×2-3, et certaines passerelles affichent « ? ». On translittère donc
// vers l'équivalent GSM-7 le plus proche avant chaque envoi réel.
const GSM7 = new Set(
  ('@£$¥èéùìòÇØøÅåÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡' +
    'ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑܧ¿abcdefghijklmnopqrstuvwxyzäöñüà\n\r' +
    '^{}\\[~]|€').split('')
);
const TRANSLIT: Record<string, string> = {
  'â': 'a', 'ê': 'e', 'î': 'i', 'ô': 'o', 'û': 'u', 'ë': 'e', 'ï': 'i', 'ÿ': 'y',
  'Â': 'A', 'Ê': 'E', 'Î': 'I', 'Ô': 'O', 'Û': 'U', 'Ë': 'E', 'Ï': 'I',
  'À': 'A', 'È': 'E', 'Ì': 'I', 'Ò': 'O', 'Ù': 'U', 'Ý': 'Y', 'ý': 'y',
  'œ': 'oe', 'Œ': 'OE', '’': "'", '‘': "'", '“': '"', '”': '"',
  '«': '"', '»': '"', '–': '-', '-': '-', '…': '...', '·': '-',
  ' ': ' ', ' ': ' ',
};
/** Ramène un texte dans l'alphabet GSM-7 (accents natifs conservés). */
export function translittererGsm7(texte: string): string {
  let sortie = '';
  for (const c of texte) {
    if (GSM7.has(c)) { sortie += c; continue; }
    if (TRANSLIT[c] !== undefined) { sortie += TRANSLIT[c]; continue; }
    // Dernier recours : décomposer l'accent (ą→a) ; sinon « ? ».
    const nu = c.normalize('NFD').replace(/[̀-ͯ]/g, '');
    sortie += nu.length === 1 && GSM7.has(nu) ? nu : '?';
  }
  return sortie;
}

async function envoyerSmsBatch(telephonesLocaux: string[], message: string, sender?: string): Promise<string> {
  let res: Response;
  try {
    res = await fetch(env.SMS_API_URL!, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.SMS_API_KEY ?? ''}`,
      },
      body: JSON.stringify({
        sender: sender ?? env.SMS_SENDER,
        recipients: telephonesLocaux,
        message: translittererGsm7(message),
      }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (e) {
    // « fetch failed » de Node masque la cause réseau réelle (ECONNREFUSED,
    // ETIMEDOUT, ENOTFOUND…) dans e.cause : on la remonte pour le diagnostic.
    const cause = (e as { cause?: { code?: string; message?: string } }).cause;
    const detail = cause?.code ?? cause?.message ?? (e instanceof Error && e.name === 'TimeoutError' ? 'délai dépassé (15 s)' : null);
    throw new Error(
      `Passerelle SMS injoignable${detail ? ` (${detail})` : ''} - vérifier SMS_API_URL et l'accès réseau depuis le conteneur API`
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
  // Même plafond journalier que les notifications automatiques.
  if (!simule && destinataires.length) {
    const blocage = await verifierPlafond(destinataires.length);
    if (blocage) throw new Error(blocage);
  }
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

    const objet = evt.domaine === 'MAINTENANCE' ? 'une maintenance' : 'une intervention incident';
    const heure = new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Lome' });
    const societe = technicien.prestataire?.nom ?? 'interne';
    const message = rendreTemplate(evt.evenement === 'DEMARRAGE' ? 'sms.tpl.demarrage' : 'sms.tpl.cloture', {
      technicien: `${technicien.prenom} ${technicien.nom}`,
      societe,
      objet,
      detail: evt.detail ? ` ${evt.detail}` : '',
      site: evt.siteNom,
      heure,
    });

    await envoyerLotContacts(cibles, message, `${evt.domaine}_${evt.evenement}`);
  } catch (err) {
    logger.warn('[sms] notification contacts échouée:', err);
  }
}

/** SMS réellement partis depuis minuit (heure de Lomé = UTC) — pour le plafond. */
export async function smsEnvoyesAujourdhui(): Promise<number> {
  const minuit = new Date();
  minuit.setUTCHours(0, 0, 0, 0);
  return prisma.smsLog.count({ where: { statut: 'ENVOYE', createdAt: { gte: minuit } } });
}

/**
 * Garde-fou budgétaire : plafond de SMS réels par jour (paramétrable, 0 =
 * illimité). Retourne le motif de blocage, ou null si l'envoi peut partir.
 * Le mode SIMULE n'est jamais ni compté ni bloqué.
 */
async function verifierPlafond(nbAEnvoyer: number): Promise<string | null> {
  const plafond = getNum('sms.plafondJournalier', 200);
  if (plafond <= 0) return null;
  const envoyes = await smsEnvoyesAujourdhui();
  if (envoyes + nbAEnvoyer > plafond) {
    return `Plafond journalier SMS atteint (${envoyes}/${plafond}) - envoi de ${nbAEnvoyer} SMS bloqué.`;
  }
  return null;
}

/**
 * Envoi groupé + journalisation pour une liste de contacts DÉJÀ ciblée
 * (un seul POST passerelle pour le lot, un SmsLog par contact).
 */
export async function envoyerLotContacts(
  cibles: { id: string | null; telephone: string }[],
  message: string,
  evenement: string
): Promise<void> {
  if (!cibles.length) return;
  // Canal déduit de l'événement : l'étiquette part avec le message et le
  // journal conserve le texte RÉELLEMENT envoyé, étiquette comprise.
  const canal = canalDe(evenement);
  message = etiqueter(message, canal);
  const expediteur = expediteurDe(canal);
  const simule = !env.SMS_API_URL;

  // Plafond journalier : le lot est journalisé PLAFOND (visible dans le journal
  // et l'audit) mais rien ne part — protection contre les rafales et la facture.
  if (!simule) {
    const blocage = await verifierPlafond(cibles.length);
    if (blocage) {
      logger.warn(`[sms] ${evenement} bloqué : ${blocage}`);
      for (const c of cibles) {
        await prisma.smsLog.create({
          data: {
            telephone: normaliserTelephone(c.telephone), contactId: c.id || null, message, evenement,
            statut: 'PLAFOND', erreur: blocage,
          },
        });
      }
      return;
    }
  }
  let statutLot = simule ? 'SIMULE' : 'ENVOYE';
  let erreurLot: string | null = null;
  let echecs = new Set<string>();
  if (!simule) {
    try {
      const reponse = await envoyerSmsBatch(cibles.map((c) => telephoneLocal(c.telephone)), message, expediteur);
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
        telephone: normaliserTelephone(c.telephone), contactId: c.id || null, message, evenement,
        statut: rejete ? 'ECHEC' : statutLot,
        erreur: rejete ? 'Rejeté par la passerelle' : erreurLot,
      },
    });
  }
  logger.info(`[sms] ${evenement} → ${cibles.length} contact(s)${simule ? ' (SIMULE)' : ''}`);
}

/**
 * PLAN DE LIVRAISON transmis : le transporteur apprend SA tournée.
 *
 * Le moment n'est pas le statut « PLANIFIE » du bon de livraison — qui signifie
 * au contraire « camion à charger, AUCUN plan » (cf. syncStatutBonLivraison) —
 * mais celui où les lignes du plan sont posées : c'est là que le transporteur
 * apprend quels sites desservir, information qu'il n'a pas autrement.
 *
 * Destinataires : les contacts DU TRANSPORTEUR ayant coché « Livraisons », et
 * eux seuls — un plan ne regarde pas les autres sociétés. Sans contact opt-in,
 * rien n'est envoyé (et c'est dit dans le journal, sans quoi l'absence de SMS
 * ressemblerait à une panne).
 *
 * Jamais bloquant : un échec passerelle ne doit pas faire échouer la pose du
 * plan. Hérite du plafond journalier, du mode SIMULE et du journal SMS.
 */
export async function notifierPlanLivraison(bonLivraisonId: string): Promise<void> {
  try {
    const bl = await prisma.bonLivraison.findUnique({
      where: { id: bonLivraisonId },
      select: {
        id: true, numeroBL: true, immatriculation: true, volumeChargeLitres: true,
        isBrouillon: true, transporteurId: true,
        lignes: { select: { site: { select: { code: true, nom: true } } } },
      },
    });
    // Brouillon = plan prévisionnel, numéro provisoire : rien à annoncer.
    if (!bl || bl.isBrouillon || !bl.lignes.length) return;
    if (!bl.transporteurId) {
      logger.info(`[sms] plan BL ${bl.numeroBL} : aucun transporteur rattaché, pas de SMS`);
      return;
    }
    const cibles = await prisma.contact.findMany({
      where: { actif: true, notifLivraisons: true, prestataireId: bl.transporteurId },
      select: { id: true, telephone: true },
    });
    if (!cibles.length) {
      logger.info(`[sms] plan BL ${bl.numeroBL} : aucun contact « Livraisons » chez le transporteur`);
      return;
    }
    const noms = bl.lignes.map((l) => l.site?.code || l.site?.nom || '?').filter(Boolean);
    // Un SMS reste court : au-delà de 6 sites on compte au lieu d'énumérer.
    const liste = noms.length <= 6 ? noms.join(', ') : `${noms.slice(0, 6).join(', ')}…`;
    const message = rendreTemplate('sms.tpl.planLivraison', {
      numeroBL: bl.numeroBL,
      volume: Math.round(Number(bl.volumeChargeLitres)).toLocaleString('fr-FR'),
      camion: bl.immatriculation,
      nbSites: String(noms.length),
      sites: liste,
    });
    await envoyerLotContacts(cibles, message, 'plan-livraison');
  } catch (err) {
    logger.warn('[sms] notification plan de livraison échouée:', err);
  }
}

/**
 * SMS direct à un UTILISATEUR (technicien affecté à un incident ou une
 * maintenance) - troisième canal après l'in-app et le push. Hérite du
 * plafond journalier, de la translittération GSM-7, du mode SIMULE et du
 * journal (contactId null = destinataire hors référentiel contacts).
 * Interrupteur admin : sms.affectations (1 = actif, 0 = coupé).
 */
export async function envoyerSmsUtilisateur(userId: string, message: string, evenement: string): Promise<void> {
  try {
    if (getNum('sms.affectations', 1) !== 1) return;
    const u = await prisma.user.findUnique({ where: { id: userId }, select: { telephone: true, isActive: true } });
    if (!u?.isActive || !u.telephone?.trim()) return;
    await envoyerLotContacts([{ id: null, telephone: u.telephone }], message, evenement);
  } catch (err) {
    logger.warn('[sms] envoi utilisateur échoué:', err);
  }
}

/**
 * Notification SMS liée à une coupure réseau : cible les contacts abonnés
 * (`notifIncidents` pour un incident terrain, `notifCoupures` pour une coupure
 * partielle) des prestataires du lot du site selon le PÉRIMÈTRE CONTRACTUEL —
 * PASSIVE (site entier tombé → énergie, intervention terrain) ou ACTIVE
 * (coupure partielle → radio/transmission) — plus les contacts « toutes
 * sociétés » (supervision interne).
 */
export async function notifierIncidentCoupure(
  siteId: string,
  message: string,
  evenement: string,
  scope: 'PASSIVE' | 'ACTIVE' = 'PASSIVE',
  pref: 'incidents' | 'coupures' | 'livraisons' = 'incidents'
): Promise<void> {
  try {
    const site = await prisma.site.findUnique({
      where: { id: siteId },
      select: { lot: { select: { assignments: { select: { prestataireId: true, scope: true } } } } },
    });
    const prestataires = new Set(
      (site?.lot?.assignments ?? [])
        .filter((a) => a.scope === scope || a.scope === 'LES_DEUX')
        .map((a) => a.prestataireId)
    );

    const contacts = await prisma.contact.findMany({
      where: {
        actif: true,
        ...(pref === 'coupures' ? { notifCoupures: true }
          : pref === 'livraisons' ? { notifLivraisons: true }
          : { notifIncidents: true }),
      },
    });
    const cibles = contacts.filter(
      (c) => c.toutesSocietes || (c.prestataireId != null && prestataires.has(c.prestataireId))
    );
    await envoyerLotContacts(cibles, message, evenement);
  } catch (err) {
    logger.warn('[sms] notification incident-coupure échouée:', err);
  }
}
