import { Request, Response, NextFunction } from 'express';
import ExcelJS from 'exceljs';
import { prisma } from '../config/database';
import { env } from '../config/env';
import { AppError } from '../utils/AppError';
import { auditLog } from '../services/audit.service';
import { normaliserTelephone, envoyerSmsManuel, smsEnvoyesAujourdhui } from '../services/sms.service';
import { getNum } from '../services/settings.service';

/**
 * Carnet de contacts à notifier par SMS (personnel interne, prestataires,
 * techniciens). CRUD réservé à l'admin + import du fichier Excel existant.
 */

// Préférences booléennes éditables (liste blanche anti mass-assignment).
const PREF_KEYS = ['actif', 'notifDemarrage', 'notifCloture', 'notifMaintenances', 'notifIncidents', 'notifCoupures', 'notifSituations', 'toutesSocietes'] as const;

const normNom = (s: string) => s.toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Z0-9]/g, '');

/** Résout la société saisie vers un prestataire connu (par nom normalisé). */
async function resolvePrestataireId(societe: string): Promise<string | null> {
  if (!societe || normNom(societe) === 'INTERNE') return null;
  const prestataires = await prisma.prestataire.findMany({ select: { id: true, nom: true } });
  return prestataires.find((p) => normNom(p.nom) === normNom(societe))?.id ?? null;
}

function pickPrefs(body: Record<string, unknown>) {
  const out: Record<string, boolean> = {};
  for (const k of PREF_KEYS) if (typeof body[k] === 'boolean') out[k] = body[k] as boolean;
  return out;
}

export async function getContacts(req: Request, res: Response, next: NextFunction) {
  try {
    const { search, societe } = req.query as Record<string, string>;
    const where: Record<string, unknown> = {};
    if (societe) where.societe = societe;
    if (search) where.OR = [
      { nom: { contains: search, mode: 'insensitive' } },
      { prenom: { contains: search, mode: 'insensitive' } },
      { telephone: { contains: search } },
    ];
    const contacts = await prisma.contact.findMany({
      where,
      orderBy: [{ societe: 'asc' }, { nom: 'asc' }],
      include: { prestataire: { select: { nom: true } } },
    });
    const societes = await prisma.contact.groupBy({ by: ['societe'], orderBy: { societe: 'asc' } });
    res.json({ success: true, data: contacts, societes: societes.map((s) => s.societe) });
  } catch (err) { next(err); }
}

export async function createContact(req: Request, res: Response, next: NextFunction) {
  try {
    const { nom, prenom, telephone, email, societe } = req.body as Record<string, string>;
    if (!nom || !prenom || !telephone || !societe) {
      throw new AppError('nom, prénom, téléphone et société sont requis', 400);
    }
    const contact = await prisma.contact.create({
      data: {
        nom: nom.trim(), prenom: prenom.trim(),
        telephone: normaliserTelephone(telephone),
        email: email?.trim() || null,
        societe: societe.trim(),
        prestataireId: await resolvePrestataireId(societe),
        toutesSocietes: normNom(societe) === 'INTERNE', // les internes voient tout par défaut
        ...pickPrefs(req.body),
      },
    });
    await auditLog(req.user!.id, 'CREATE', 'contacts', contact.id, { nom, telephone }, req);
    res.status(201).json({ success: true, data: contact });
  } catch (err) {
    if ((err as { code?: string }).code === 'P2002') return next(new AppError('Un contact avec ce téléphone existe déjà', 409));
    next(err);
  }
}

export async function updateContact(req: Request, res: Response, next: NextFunction) {
  try {
    const existing = await prisma.contact.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new AppError('Contact introuvable', 404);
    const { nom, prenom, telephone, email, societe } = req.body as Record<string, string>;
    const updated = await prisma.contact.update({
      where: { id: req.params.id },
      data: {
        ...(nom ? { nom: nom.trim() } : {}),
        ...(prenom ? { prenom: prenom.trim() } : {}),
        ...(telephone ? { telephone: normaliserTelephone(telephone) } : {}),
        ...(email !== undefined ? { email: email?.trim() || null } : {}),
        ...(societe ? { societe: societe.trim(), prestataireId: await resolvePrestataireId(societe) } : {}),
        ...pickPrefs(req.body),
      },
    });
    await auditLog(req.user!.id, 'UPDATE', 'contacts', existing.id, req.body, req);
    res.json({ success: true, data: updated });
  } catch (err) {
    if ((err as { code?: string }).code === 'P2002') return next(new AppError('Un contact avec ce téléphone existe déjà', 409));
    next(err);
  }
}

export async function deleteContact(req: Request, res: Response, next: NextFunction) {
  try {
    const existing = await prisma.contact.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new AppError('Contact introuvable', 404);
    await prisma.contact.delete({ where: { id: req.params.id } });
    await auditLog(req.user!.id, 'DELETE', 'contacts', existing.id, { nom: existing.nom, telephone: existing.telephone }, req);
    res.json({ success: true, message: 'Contact supprimé' });
  } catch (err) { next(err); }
}

/**
 * Import du fichier Excel (colonnes : nom, prénom, telephone, email, employe).
 * Upsert par téléphone : les contacts existants sont mis à jour (nom/société),
 * leurs préférences déjà réglées sont conservées.
 */
export async function importContacts(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.file) throw new AppError('Fichier .xlsx requis (champ « file »)', 400);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(req.file.buffer as unknown as ArrayBuffer, {
      // Les nœuds de présentation (styles, images, mises en forme) représentent
      // l'essentiel de la mémoire d'un .xlsx : 10 Mo de fichier donnaient
      // 300-600 Mo de heap pour un conteneur limité à 1 Go.
      ignoreNodes: ['dataValidations', 'drawing', 'hyperlinks', 'picture', 'styles', 'conditionalFormatting'],
    });
    const ws = wb.worksheets[0];
    if (!ws) throw new AppError('Classeur vide', 400);

    // En-têtes (ligne 1) normalisés → index de colonne.
    const normHeader = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
    const colIdx: Record<string, number> = {};
    ws.getRow(1).eachCell((cell, col) => { colIdx[normHeader(String(cell.value ?? ''))] = col; });
    for (const requis of ['nom', 'prenom', 'telephone']) {
      if (!colIdx[requis]) throw new AppError(`Colonne « ${requis} » introuvable dans le fichier`, 400);
    }

    const prestataires = await prisma.prestataire.findMany({ select: { id: true, nom: true } });
    const parNom = new Map(prestataires.map((p) => [normNom(p.nom), p.id]));

    let crees = 0, maj = 0, ignores = 0;
    for (let r = 2; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const val = (key: string) => String(row.getCell(colIdx[key] ?? 0).value ?? '').trim();
      const nom = val('nom'), prenom = val('prenom'), telephone = val('telephone');
      if (!nom || !telephone) { if (nom || prenom || telephone) ignores++; continue; }
      const societe = val('employe') || val('societe') || 'INTERNE';
      const email = colIdx.email ? val('email') : '';
      const tel = normaliserTelephone(telephone);
      const prestataireId = parNom.get(normNom(societe)) ?? null;

      const existing = await prisma.contact.findUnique({ where: { telephone: tel } });
      if (existing) {
        await prisma.contact.update({
          where: { telephone: tel },
          data: { nom, prenom, email: email || null, societe, prestataireId },
        });
        maj++;
      } else {
        await prisma.contact.create({
          data: {
            nom, prenom, telephone: tel, email: email || null, societe, prestataireId,
            toutesSocietes: normNom(societe) === 'INTERNE',
          },
        });
        crees++;
      }
    }
    await auditLog(req.user!.id, 'CREATE', 'contacts', 'import-xlsx', { crees, maj, ignores }, req);
    res.json({ success: true, data: { crees, maj, ignores } });
  } catch (err) { next(err); }
}

/**
 * Envoi manuel d'un SMS (admin) : à des contacts du carnet (contactIds) et/ou
 * des numéros libres (telephones). Un même numéro présent deux fois n'est
 * envoyé qu'une fois. Journalisé dans sms_logs (événement MANUEL) ; en mode
 * SIMULE (passerelle non configurée), rien ne part mais tout est tracé.
 */
export async function sendSms(req: Request, res: Response, next: NextFunction) {
  try {
    const { message, contactIds, telephones } = req.body as {
      message?: string;
      contactIds?: string[];
      telephones?: string[];
    };
    const texte = typeof message === 'string' ? message.trim() : '';
    if (!texte) throw new AppError('message est requis', 400);
    if (texte.length > 320) throw new AppError('message trop long (320 caractères maximum)', 400);

    // Destinataires dédupliqués par numéro normalisé.
    const destinataires = new Map<string, { telephone: string; contactId?: string }>();
    if (Array.isArray(contactIds) && contactIds.length) {
      const contacts = await prisma.contact.findMany({ where: { id: { in: contactIds } } });
      if (contacts.length !== new Set(contactIds).size) {
        throw new AppError('Un ou plusieurs contacts sont introuvables', 404);
      }
      for (const c of contacts) {
        destinataires.set(normaliserTelephone(c.telephone), { telephone: c.telephone, contactId: c.id });
      }
    }
    for (const t of Array.isArray(telephones) ? telephones : []) {
      const tel = normaliserTelephone(String(t));
      if (!/^\+\d{8,15}$/.test(tel)) throw new AppError(`Numéro invalide : ${t}`, 400);
      if (!destinataires.has(tel)) destinataires.set(tel, { telephone: tel });
    }
    if (!destinataires.size) {
      throw new AppError('Au moins un destinataire est requis (contactIds ou telephones)', 400);
    }
    if (destinataires.size > 100) throw new AppError('100 destinataires maximum par envoi', 400);

    const { simule, resultats } = await envoyerSmsManuel([...destinataires.values()], texte);
    const echecs = resultats.filter((r) => r.statut === 'ECHEC').length;
    await auditLog(req.user!.id, 'CREATE', 'sms', 'envoi-manuel',
      { destinataires: resultats.length, echecs, simule }, req);
    res.json({
      success: true,
      data: { simule, total: resultats.length, envoyes: resultats.length - echecs, echecs, resultats },
    });
  } catch (err) { next(err); }
}

/** Journal des derniers SMS (envoyés, simulés ou en échec) pour vérification. */
export async function getSmsLogs(req: Request, res: Response, next: NextFunction) {
  try {
    const logs = await prisma.smsLog.findMany({ orderBy: { createdAt: 'desc' }, take: 100 });
    // Consommation du jour vs plafond (garde-fou budgétaire paramétrable).
    const [envoyesJour, plafond] = [await smsEnvoyesAujourdhui(), getNum('sms.plafondJournalier', 200)];
    res.json({ success: true, data: logs, smsActive: !!env.SMS_API_URL, jour: { envoyes: envoyesJour, plafond } });
  } catch (err) { next(err); }
}
