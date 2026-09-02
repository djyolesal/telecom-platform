import express, { Router } from 'express';
import { authMiddleware } from '../middlewares/auth';
import { AppError } from '../utils/AppError';
import { rbac } from '../middlewares/rbac';
import { rateLimit } from '../middlewares/rateLimit';
import { validate } from '../middlewares/validate';
import {
  loginSchema, forgotPasswordSchema, resetPasswordSchema, refreshTokenSchema, updatePasswordSchema,
} from '../schemas/auth.schema';
import { prisma as _prisma } from '../config/database';

// Controllers
import * as authCtrl from '../controllers/auth.controller';
import * as sitesCtrl from '../controllers/sites.controller';
import * as contactsCtrl from '../controllers/contacts.controller';
import * as maintenanceCtrl from '../controllers/maintenances.controller';
import * as actifsCtrl from '../controllers/actifs.controller';
import * as depotagesCtrl from '../controllers/depotages.controller';
import * as relevesCtrl from '../controllers/releves.controller';
import * as relevesImportCtrl from '../controllers/relevesImport.controller';
import * as incidentsCtrl from '../controllers/incidents.controller';
import * as rapportsCtrl from '../controllers/rapports.controller';
import * as usersCtrl from '../controllers/users.controller';
import * as adminCtrl from '../controllers/admin.controller';
import * as notifCtrl from '../controllers/notifications.controller';
import * as uploadCtrl from '../controllers/upload.controller';
import * as prestatairesCtrl from '../controllers/prestataires.controller';
import * as lotsCtrl from '../controllers/lots.controller';
import * as tachesCtrl from '../controllers/taches.controller';
import * as configCtrl from '../controllers/config.controller';
import * as carburantCtrl from '../controllers/carburantLogistique.controller';
import * as refTransportCtrl from '../controllers/referentielTransport.controller';
import * as mouvementsCtrl from '../controllers/mouvementsCarburant.controller';
import * as coupuresCtrl from '../controllers/coupuresReseau.controller';
import { uploadMiddleware, uploadSpreadsheet, verifierSignature } from '../middlewares/upload';
import * as filesCtrl from '../controllers/files.controller';
import * as syncOssCtrl from '../controllers/syncOss.controller';
import * as dbAdminCtrl from '../controllers/dbAdmin.controller';

export const router = Router();

// ── Auth (public) ─────────────────────────────────────────────
// Anti-bruteforce : limite le débit des routes sensibles (par IP + email).
const loginLimit = rateLimit({ windowSec: 900, max: 10, ipMax: 60, keyPrefix: 'login', failClosed: true }); // 10/compte + 60/IP par 15 min (anti-spraying)
const resetLimit = rateLimit({ windowSec: 3600, max: 5, keyPrefix: 'pwreset', failClosed: true });      // 5 / h
// Génération lourde (PDF, exports xlsx/pdf, rapport mensuel) : plafond par IP anti-DoS applicatif.
const heavyLimit = rateLimit({ windowSec: 60, max: 20, keyPrefix: 'heavy' });
router.post('/auth/login', loginLimit, validate({ body: loginSchema }), authCtrl.login);
// Limiteur AUSSI sur le refresh : c'était la seule route d'auth sans plafond.
router.post('/auth/refresh-token', loginLimit, validate({ body: refreshTokenSchema }), authCtrl.refreshToken);
router.post('/auth/forgot-password', resetLimit, validate({ body: forgotPasswordSchema }), authCtrl.forgotPassword);
router.post('/auth/reset-password', resetLimit, validate({ body: resetPasswordSchema }), authCtrl.resetPassword);

// ── Synchronisation OSS (jeton machine, pas de session) ───────
// Le collecteur POSTe la sortie BRUTE de la commande d'état des eNodeB.
// Auth par jeton dédié vérifiée DANS le contrôleur (OSS_SYNC_TOKEN).
const ossLimit = rateLimit({ windowSec: 60, max: 10, keyPrefix: 'sync-oss' });
router.post(
  '/coupures-reseau/sync-oss',
  ossLimit,
  express.text({ type: () => true, limit: '4mb' }),
  syncOssCtrl.syncOss
);

// ── Passerelle fichiers (signature HMAC, pas de session) ──────
// Hors authMiddleware à dessein : une balise <img> ne peut pas poser d'en-tête
// Authorization. L'URL est signée et expire (cf. storage.service).
const fileLimit = rateLimit({ windowSec: 60, max: 300, keyPrefix: 'files' });
router.get('/files/*', fileLimit, filesCtrl.servirFichier);

// ── Auth (protégé) ────────────────────────────────────────────
router.use(authMiddleware); // Tout ce qui suit requiert un JWT valide

// ── Périmètre TRANSPORTEUR ────────────────────────────────────
// Un prestataire transporteur ne fait QUE l'appro carburant : consulter les
// bons de commande, saisir/suivre ses bons de livraison (avec photos des
// documents) — rien d'autre (sites, maintenances, incidents… interdits).
// Les écritures restent en plus soumises au rbac() de chaque route.
const TRANSPORTEUR_ALLOW: RegExp[] = [
  /^\/auth\//,                      // profil, mot de passe, logout, FCM
  /^\/bons-commande(\/|$)/,         // lecture pour rattacher un BL
  /^\/bons-livraison(\/|$)/,        // ses chargements (filtrés côté contrôleur)
  /^\/sites\/geojson$/,            // carte de SES livraisons (vue dédiée, sans données d'exploitation)
  /^\/vehicules(\/|$)/,            // son parc (filtré côté contrôleur)
  /^\/chauffeurs(\/|$)/,           // son effectif (filtré côté contrôleur)
  /^\/upload\/(image|document)$/,   // photos du BL et du bordereau
  /^\/notifications(\/|$)/,
];
router.use((req, _res, next) => {
  if (req.user?.role !== 'TRANSPORTEUR') return next();
  if (TRANSPORTEUR_ALLOW.some((re) => re.test(req.path))) return next();
  next(new AppError("Accès réservé : un compte transporteur est limité à l'appro carburant.", 403));
});

// Express route en casse-INSENSIBLE et tolère le slash final : sans
// normalisation, `/RAPPORTS/MENSUEL/` ou `/rapports/gardiennage/` échappaient à
// la deny-list tout en atteignant la route. On normalise donc avant de tester.
const cheminNormalise = (p: string) => p.toLowerCase().replace(/\/+$/, '') || '/';

// ── Périmètre NOC ─────────────────────────────────────────────
// Le centre de supervision réseau surveille et qualifie les indisponibilités :
// coupures et topologie en écriture, supervision en lecture. Il ne fait NI
// l'O&M terrain (maintenances, dépotages, relevés), NI l'administration.
// Sans cette liste, NOC héritait de toutes les routes dépourvues de rbac().
const NOC_ALLOW: RegExp[] = [
  /^\/auth\//,
  /^\/config$/,
  /^\/notifications(\/|$)/,
  /^\/sites(\/|$)/,                    // consultation du parc + import/export topologie
  /^\/coupures-reseau(\/|$)/,
  /^\/incidents(\/|$)/,                // suivi et déclaration ; la clôture reste terrain
  // Le stock carburant est HORS périmètre NOC (logistique, pas supervision).
  /^\/rapports\/(dashboard|disponibilite-reseau|incidents|pouls-24h|conformite-arcep)$/,
  /^\/rapports\/(disponibilite-reseau|conformite-arcep)\/export\/(xlsx|pdf)$/,
  /^\/types-pylone(\/|$)/,
  /^\/types-incident$/,               // libellés des types (déclaration/lecture)
  /^\/prestataires$/,                  // liste seule : options du filtre prestataire (page Sites)
];
router.use((req, _res, next) => {
  if (req.user?.role !== 'NOC') return next();
  if (NOC_ALLOW.some((re) => re.test(cheminNormalise(req.path)))) return next();
  next(new AppError('Accès réservé : un compte NOC est limité à la supervision réseau.', 403));
});

// ── Rapports agrégés du parc : équipes INTERNES uniquement ────
// Un utilisateur rattaché à un prestataire (superviseur ou technicien) n'a pas
// accès aux agrégats parc entier (logistique, anomalies, empreinte carbone…) :
// ses vues par site sont périmétrées, les totaux du parc restent internes.
const INTERNE_ONLY: RegExp[] = [
  /^\/rapports\/fiche-validation$/,
  /^\/rapports\/fiches-validation\/batch$/,
  /^\/rapports\/reapprovisionnement$/,
  /^\/rapports\/anomalies-conso$/,
  /^\/rapports\/anomalies-carburant$/,
  /^\/rapports\/synthese-appro$/,
  /^\/rapports\/parc-prestataires$/,
  /^\/rapports\/manquants-livraison(\/|$)/,
  /^\/rapports\/rapprochement(\/|$)/,
  // /rapports/bilan-carburant et /rapports/bilan-energie : OUVERTS aux
  // prestataires — le contrôleur applique le périmètre (chacun ne voit que les
  // sites de ses lots), comme /rapports/disponibilite-reseau.
  // Vue consolidée des transferts/purges/avoirs du parc : jamais pour un
  // compte prestataire, même superviseur (le contrôleur périmètre en plus).
  /^\/mouvements-carburant(\/|$)/,
  /^\/rapports\/correlation-carburant$/,
  /^\/rapports\/empreinte-carbone$/,
  /^\/rapports\/mensuel(\/|$)/,
  /^\/rapports\/gardiennage$/,
  // Rapports consolidés du parc : jamais accessibles à un compte prestataire,
  // même si son rôle (MANAGER/DIRECTION) figure dans le rbac de la route.
  /^\/rapports\/dashboard-direction$/,
  /^\/rapports\/fiabilite-ge$/,
  // /rapports/sla-prestataires : OUVERT aux prestataires — le contrôleur ne
  // leur renvoie que LEUR ligne (indicateurs et pénalités recalculés dessus).
  // /rapports/disponibilite-reseau : OUVERT aux prestataires depuis la phase D —
  // le contrôleur applique le périmètre (chacun ne voit que ses lots).
];
router.use(async (req, _res, next) => {
  try {
    if (!req.user || !INTERNE_ONLY.some((re) => re.test(cheminNormalise(req.path)))) return next();
    const me = await _prisma.user.findUnique({ where: { id: req.user.id }, select: { prestataireId: true } });
    if (me?.prestataireId) return next(new AppError('Rapport réservé aux équipes internes.', 403));
    next();
  } catch (e) { next(e); }
});

// Plafond anti-DoS applicatif sur la génération LOURDE (PDF, exports xlsx/pdf/csv,
// rapport mensuel) : un utilisateur ne peut pas boucler dessus et saturer le CPU.
const HEAVY_PATH = /(\/export\/(xlsx|pdf|csv)$|\.pdf$|\.xlsx$|^\/rapports\/(mensuel\/|disponibilite-reseau$|dashboard$|dashboard-direction$|stock-carburant$|sla-prestataires$|fiabilite-ge$|correlation-carburant$))/;
router.use((req, res, next) => {
  if (req.method === 'GET' && HEAVY_PATH.test(cheminNormalise(req.path))) return heavyLimit(req, res, next);
  next();
});

router.post('/auth/logout', authCtrl.logout);
router.get('/auth/me', authCtrl.getMe);
router.put('/auth/me/password', validate({ body: updatePasswordSchema }), authCtrl.updatePassword);
router.post('/auth/fcm-token', authCtrl.updateFcmToken);

// ── Sites ─────────────────────────────────────────────────────
router.get('/sites', sitesCtrl.getSites);
// TRANSPORTEUR : vue dédiée dans le contrôleur — ses seuls sites à livrer,
// sans aucune donnée d'exploitation (ni stock, ni autonomie, ni rupture).
router.get('/sites/geojson', rbac(['NOC','SUPERVISEUR','MANAGER','ADMIN','DIRECTION','TRANSPORTEUR']), sitesCtrl.getSitesGeoJSON);
// SUPERVISEUR inclus : un prestataire exporte SES sites (périmètre appliqué dans le contrôleur).
router.get('/sites/export/:format(xlsx|pdf)', rbac(['NOC','SUPERVISEUR','MANAGER','ADMIN']), sitesCtrl.exportSites);
router.get('/sites/import/template', rbac(['MANAGER','ADMIN']), sitesCtrl.sitesImportTemplate);
router.post('/sites/import', rbac(['ADMIN']), uploadSpreadsheet.single('file'), sitesCtrl.importSites);
// Topologie de transmission : rattachement en masse site → amont + type de liaison.
router.post('/sites/import-topologie', rbac(['NOC','ADMIN']), uploadSpreadsheet.single('file'), sitesCtrl.importTopologie);
// Rattachement INDIVIDUEL site → amont : la transmission est le domaine du NOC,
// sans lui ouvrir la modification complète de la fiche site.
router.put('/sites/:id/transmission', rbac(['NOC','MANAGER','ADMIN']), sitesCtrl.updateSiteTransmission);
// Export des liaisons (xlsx ré-importable / PDF tabulaire).
router.get('/sites/topologie/export/:format(xlsx|pdf)', rbac(['NOC','MANAGER','ADMIN']), sitesCtrl.exportTopologie);

// ── Config applicative (règles terrain exposées aux apps) ──
router.get('/config', configCtrl.getAppConfig);

// ── Tâches préventives contractuelles ─────────────────────
router.get('/taches-preventives', tachesCtrl.getCatalogue);
router.post('/taches-preventives/generer', rbac(['MANAGER', 'ADMIN']), tachesCtrl.genererPlanning);
router.get('/rapports/echeancier-preventif', rbac(['SUPERVISEUR', 'MANAGER', 'ADMIN', 'DIRECTION']), tachesCtrl.getEcheancier);
router.get('/rapports/fiche-validation', rbac(['SUPERVISEUR', 'MANAGER', 'ADMIN', 'DIRECTION']), tachesCtrl.getFicheValidation);
router.get('/rapports/fiches-validation/batch', rbac(['SUPERVISEUR', 'MANAGER', 'ADMIN', 'DIRECTION']), tachesCtrl.getFichesBatch);
router.post('/sites', rbac(['MANAGER','ADMIN']), sitesCtrl.createSite);
// Campagne « cuves calculables » : couverture + sites restant à configurer.
router.get('/sites/cuves/couverture', rbac(['NOC','SUPERVISEUR','MANAGER','ADMIN','DIRECTION']), sitesCtrl.getCouvertureCuves);
router.get('/sites/:id', sitesCtrl.getSiteById);
router.put('/sites/:id', rbac(['MANAGER','ADMIN']), sitesCtrl.updateSite);
router.put('/sites/:id/baremage', rbac(['MANAGER','ADMIN']), sitesCtrl.replaceBaremage);
// Campagne terrain : le technicien mesure la cuve à la première visite.
router.put('/sites/:id/cuve', rbac(['TECHNICIEN','SUPERVISEUR','MANAGER','ADMIN']), sitesCtrl.updateCuveSite);
router.put('/sites/:id/groupes', rbac(['MANAGER','ADMIN']), sitesCtrl.replaceSiteGroupes);
router.delete('/sites/:id', rbac(['ADMIN']), sitesCtrl.deleteSite);
router.get('/sites/:id/transmission', sitesCtrl.getSiteTransmission);
router.get('/sites/:id/taches-preventives', tachesCtrl.getTachesForSite);
router.get('/sites/:id/stock', sitesCtrl.getSiteStock);
router.get('/sites/:id/maintenances', sitesCtrl.getSiteMaintenances);
router.get('/sites/:id/depotages', sitesCtrl.getSiteDepotages);
router.get('/sites/:id/releves', sitesCtrl.getSiteReleves);
router.get('/sites/:id/incidents', sitesCtrl.getSiteIncidents);
router.get('/sites/:id/lignes-livraison', carburantCtrl.getLignesLivraisonForSite);
router.get('/sites/:id/etiquettes-qr.pdf', rbac(['SUPERVISEUR','MANAGER','ADMIN']), sitesCtrl.getEtiquettesQr);

// ── Coupures réseau (supervision NOC) ─────────────────────────
// Lecture large (supervision) ; ÉCRITURE réservée au NOC/manager/admin — les
// techniciens agissent via les incidents, jamais directement sur les coupures.
router.get('/coupures-reseau', rbac(['NOC','SUPERVISEUR','MANAGER','ADMIN','DIRECTION']), coupuresCtrl.getCoupures);
router.get('/coupures-reseau/stats', rbac(['NOC','SUPERVISEUR','MANAGER','ADMIN','DIRECTION']), coupuresCtrl.getCoupuresStats);
router.get('/coupures-reseau/export/:format(xlsx|pdf)', rbac(['NOC','SUPERVISEUR','MANAGER','ADMIN','DIRECTION']), coupuresCtrl.exportCoupures);
router.get('/coupures-reseau/:id/historique', rbac(['NOC','SUPERVISEUR','MANAGER','ADMIN','DIRECTION']), coupuresCtrl.getHistoriqueCoupure);
router.post('/coupures-reseau', rbac(['NOC','MANAGER','ADMIN']), coupuresCtrl.createCoupure);
router.post('/coupures-reseau/import', rbac(['NOC','MANAGER','ADMIN']), uploadSpreadsheet.single('file'), coupuresCtrl.importCoupures);
router.post('/coupures-reseau/:id/prise-en-charge', rbac(['NOC','MANAGER','ADMIN']), coupuresCtrl.prendreEnChargeCoupure);
router.post('/coupures-reseau/:id/annuler-prise-en-charge', rbac(['NOC','MANAGER','ADMIN']), coupuresCtrl.annulerPriseEnCharge);
router.put('/coupures-reseau/:id', rbac(['NOC','MANAGER','ADMIN']), coupuresCtrl.updateCoupure);
// Saisie erronée du NOC : suppression ouverte au NOC/manager mais limitée aux
// coupures MANUELLES (garde dans le contrôleur) ; l'ADMIN peut tout supprimer.
router.delete('/coupures-reseau/:id', rbac(['NOC','MANAGER','ADMIN']), coupuresCtrl.deleteCoupure);
router.get('/rapports/disponibilite-reseau', rbac(['NOC','SUPERVISEUR','MANAGER','ADMIN','DIRECTION']), coupuresCtrl.getDisponibiliteReseau);
router.get('/rapports/disponibilite-reseau/export/:format', rbac(['NOC','SUPERVISEUR','MANAGER','ADMIN','DIRECTION']), coupuresCtrl.exportDisponibiliteReseau);
// Conformité réglementaire ARCEP (DR1/DR2, arrêté n°005/MENTD/CAB) : mêmes
// rôles que la disponibilité — un prestataire ne voit que SES sites.
router.get('/rapports/conformite-arcep', rbac(['NOC','SUPERVISEUR','MANAGER','ADMIN','DIRECTION']), coupuresCtrl.getConformiteArcep);
router.get('/rapports/conformite-arcep/export/:format(xlsx|pdf)', rbac(['NOC','SUPERVISEUR','MANAGER','ADMIN','DIRECTION']), coupuresCtrl.exportConformiteArcep);

// ── Prestataires ──────────────────────────────────────────────
// « Ma société » : le superviseur d'un prestataire complète la fiche de SA société.
router.get('/ma-societe', prestatairesCtrl.getMaSociete);
router.put('/ma-societe', rbac(['SUPERVISEUR', 'MANAGER', 'ADMIN']), prestatairesCtrl.updateMaSociete);

// Lecture élargie aux internes (filtres des listes) ; un utilisateur rattaché
// à un prestataire n'y voit que SA société (garde dans le contrôleur).
router.get('/prestataires', rbac(['SUPERVISEUR','MANAGER','ADMIN','DIRECTION','NOC']), prestatairesCtrl.getPrestataires);
router.post('/prestataires', rbac(['MANAGER', 'ADMIN']), prestatairesCtrl.createPrestataire);

// ── Contacts à notifier (SMS) — gestion admin ──
router.get('/contacts', rbac(['ADMIN']), contactsCtrl.getContacts);
router.post('/contacts', rbac(['ADMIN']), contactsCtrl.createContact);
router.post('/contacts/import', rbac(['ADMIN']), uploadSpreadsheet.single('file'), contactsCtrl.importContacts);
router.get('/contacts/sms-logs', rbac(['ADMIN']), contactsCtrl.getSmsLogs);
router.get('/contacts/coherence', rbac(['ADMIN']), contactsCtrl.getCoherenceContacts);
// Envoi manuel de SMS — limité en débit (coût par SMS une fois la passerelle active).
router.post('/sms/send', rbac(['ADMIN']), rateLimit({ windowSec: 3600, max: 30, keyPrefix: 'smssend' }), contactsCtrl.sendSms);
router.put('/contacts/:id', rbac(['ADMIN']), contactsCtrl.updateContact);
router.delete('/contacts/:id', rbac(['ADMIN']), contactsCtrl.deleteContact);
router.get('/prestataires/:id', rbac(['MANAGER','ADMIN']), prestatairesCtrl.getPrestataireById);
router.put('/prestataires/:id', rbac(['MANAGER', 'ADMIN']), prestatairesCtrl.updatePrestataire);
router.post('/prestataires/:id/toggle-active', rbac(['MANAGER', 'ADMIN']), prestatairesCtrl.togglePrestataire);
router.delete('/prestataires/:id', rbac(['ADMIN']), prestatairesCtrl.deletePrestataire);

// ── Lots de maintenance ───────────────────────────────────────
router.get('/lots', rbac(['MANAGER','ADMIN']), lotsCtrl.getLots);
router.post('/lots', rbac(['MANAGER', 'ADMIN']), lotsCtrl.createLot);
router.get('/lots/:id', rbac(['MANAGER','ADMIN']), lotsCtrl.getLotById);
router.put('/lots/:id', rbac(['MANAGER', 'ADMIN']), lotsCtrl.updateLot);
router.delete('/lots/:id', rbac(['ADMIN']), lotsCtrl.deleteLot);
router.post('/lots/:id/assignments', rbac(['MANAGER', 'ADMIN']), lotsCtrl.addAssignment);
router.delete('/lots/:id/assignments/:assignmentId', rbac(['MANAGER', 'ADMIN']), lotsCtrl.removeAssignment);
router.post('/lots/:id/sites', rbac(['MANAGER', 'ADMIN']), lotsCtrl.assignSites);
router.delete('/lots/:id/sites/:siteId', rbac(['MANAGER', 'ADMIN']), lotsCtrl.removeSite);

// ── Maintenances ──────────────────────────────────────────────
router.get('/maintenances', maintenanceCtrl.getMaintenances);
router.get('/maintenances/planning', maintenanceCtrl.getPlanning);
router.get('/maintenances/techniciens-assignables', maintenanceCtrl.getTechniciensAssignablesSite);
router.get('/maintenances/export/:format(xlsx|pdf)', rbac(['SUPERVISEUR','MANAGER','ADMIN']), maintenanceCtrl.exportMaintenances);
router.post('/maintenances', rbac(['TECHNICIEN','SUPERVISEUR','MANAGER','ADMIN']), maintenanceCtrl.createMaintenance);
router.get('/maintenances/:id', maintenanceCtrl.getMaintenanceById);
router.put('/maintenances/:id', rbac(['SUPERVISEUR','MANAGER','ADMIN']), maintenanceCtrl.updateMaintenance);
router.delete('/maintenances/:id', rbac(['ADMIN']), maintenanceCtrl.deleteMaintenance);
router.post('/maintenances/:id/start', rbac(['TECHNICIEN','SUPERVISEUR','MANAGER','ADMIN']), maintenanceCtrl.startMaintenance);
router.post('/maintenances/:id/photos', rbac(['TECHNICIEN','SUPERVISEUR','MANAGER','ADMIN']), maintenanceCtrl.addMaintenancePhotos);
router.post('/maintenances/:id/suspend', rbac(['TECHNICIEN','SUPERVISEUR','MANAGER','ADMIN']), maintenanceCtrl.suspendMaintenance);
router.post('/maintenances/:id/resume', rbac(['TECHNICIEN','SUPERVISEUR','MANAGER','ADMIN']), maintenanceCtrl.resumeMaintenance);
router.post('/maintenances/:id/close', rbac(['TECHNICIEN','SUPERVISEUR','MANAGER','ADMIN']), maintenanceCtrl.closeMaintenance);
router.get('/maintenances/:id/pdf', maintenanceCtrl.getMaintenancePdf);
router.get('/maintenances/:id/bon-mouvement.pdf', maintenanceCtrl.getBonMouvementPdf);

// ── Actifs (parc GE / batteries / climatiseurs) ───────────────
router.get('/actifs', actifsCtrl.listActifs);
router.get('/actifs/export/:format(xlsx|pdf)', rbac(['SUPERVISEUR','MANAGER','ADMIN']), actifsCtrl.exportActifs);
router.post('/actifs', rbac(['MANAGER','ADMIN']), actifsCtrl.createActif);
router.get('/actifs/:type/:id', actifsCtrl.getActif);
router.delete('/actifs/:type/:id', rbac(['ADMIN']), actifsCtrl.deleteActif);

// ── Dépotages ─────────────────────────────────────────────────
router.get('/depotages', depotagesCtrl.getDepotages);
router.get('/depotages/export/:format(xlsx|pdf)', rbac(['SUPERVISEUR','MANAGER','ADMIN']), depotagesCtrl.exportDepotages);
router.post('/depotages', rbac(['TECHNICIEN','SUPERVISEUR','MANAGER','ADMIN']), depotagesCtrl.createDepotage);
router.get('/depotages/:id/bordereau.pdf', depotagesCtrl.exportDepotagePdf);
router.get('/depotages/:id', depotagesCtrl.getDepotageById);
router.put('/depotages/:id', rbac(['SUPERVISEUR','MANAGER','ADMIN']), depotagesCtrl.updateDepotage);
router.delete('/depotages/:id', rbac(['ADMIN']), depotagesCtrl.deleteDepotage);

// ── Logistique carburant : bons de commande ───────────────────
router.get('/bons-commande', carburantCtrl.getBonsCommande);
router.get('/bons-commande/export/:format(xlsx|pdf)', rbac(['MANAGER', 'ADMIN']), carburantCtrl.exportBonsCommande);
router.post('/bons-commande/analyser-pdf', rbac(['MANAGER', 'ADMIN']), heavyLimit, uploadMiddleware.single('file'), verifierSignature, carburantCtrl.analyserBonCommandePdf);
router.post('/bons-commande', rbac(['MANAGER', 'ADMIN']), carburantCtrl.createBonCommande);
router.get('/bons-commande/:id', carburantCtrl.getBonCommandeById);
router.put('/bons-commande/:id', rbac(['MANAGER', 'ADMIN']), carburantCtrl.updateBonCommande);
router.delete('/bons-commande/:id', rbac(['ADMIN']), carburantCtrl.deleteBonCommande);

// ── Logistique carburant : bons de livraison + plan ───────────
router.get('/bons-livraison', carburantCtrl.getBonsLivraison);
router.get('/bons-livraison/export/:format(xlsx|pdf)', rbac(['MANAGER', 'ADMIN']), carburantCtrl.exportBonsLivraison);
router.post('/bons-livraison/analyser-document', rbac(['MANAGER', 'ADMIN', 'TRANSPORTEUR']), heavyLimit, uploadMiddleware.single('file'), verifierSignature, carburantCtrl.analyserBonLivraisonDocument);
router.post('/bons-livraison', rbac(['MANAGER', 'ADMIN', 'TRANSPORTEUR']), carburantCtrl.createBonLivraison);
router.get('/bons-livraison/:id', carburantCtrl.getBonLivraisonById);
router.get('/bons-livraison/:id/plan.xlsx', carburantCtrl.exportPlanLivraisonXlsx);
router.get('/bons-livraison/:id/plan.pdf', carburantCtrl.exportPlanLivraisonPdf);
router.put('/bons-livraison/:id', rbac(['MANAGER', 'ADMIN', 'TRANSPORTEUR']), carburantCtrl.updateBonLivraison);
router.put('/bons-livraison/:id/plan', rbac(['MANAGER', 'ADMIN']), carburantCtrl.setPlanLivraison);
router.delete('/bons-livraison/:id', rbac(['MANAGER', 'ADMIN']), carburantCtrl.deleteBonLivraison); // MANAGER : brouillons uniquement (vérifié dans le contrôleur)
// ── Mouvements de carburant hors livraison ──
// Transfert entre sites (deux jambes), purge de cuve, avoir fournisseur : ces
// écritures font disparaître ou apparaître du carburant sans pièce de
// livraison, donc réservées au pilotage et toutes motivées.
router.get('/mouvements-carburant', rbac(['SUPERVISEUR', 'MANAGER', 'ADMIN', 'DIRECTION']), mouvementsCtrl.getMouvements);
router.post('/mouvements-carburant/transfert', rbac(['MANAGER', 'ADMIN']), mouvementsCtrl.createTransfert);
router.post('/mouvements-carburant/purge', rbac(['MANAGER', 'ADMIN']), mouvementsCtrl.createPurge);
router.post('/mouvements-carburant/avoir', rbac(['MANAGER', 'ADMIN']), mouvementsCtrl.createAvoir);
router.delete('/mouvements-carburant/:id', rbac(['ADMIN']), mouvementsCtrl.deleteMouvement);

// ── Référentiels transport (véhicules & chauffeurs) ──
// Ils se peuplent à l'usage ; ces routes servent à les enrichir (capacité de
// citerne, téléphone, permis). Un transporteur est enfermé dans son parc.
router.get('/vehicules', rbac(['MANAGER', 'ADMIN', 'DIRECTION', 'TRANSPORTEUR']), refTransportCtrl.getVehicules);
router.post('/vehicules', rbac(['MANAGER', 'ADMIN', 'TRANSPORTEUR']), refTransportCtrl.createVehicule);
router.put('/vehicules/:id', rbac(['MANAGER', 'ADMIN', 'TRANSPORTEUR']), refTransportCtrl.updateVehicule);
router.get('/chauffeurs', rbac(['MANAGER', 'ADMIN', 'DIRECTION', 'TRANSPORTEUR']), refTransportCtrl.getChauffeurs);
router.post('/chauffeurs', rbac(['MANAGER', 'ADMIN', 'TRANSPORTEUR']), refTransportCtrl.createChauffeur);
router.put('/chauffeurs/:id', rbac(['MANAGER', 'ADMIN', 'TRANSPORTEUR']), refTransportCtrl.updateChauffeur);

// Clôture comptable : ventilation du reste en citerne (le geste qui solde un camion).
router.post('/bons-livraison/:id/cloturer', rbac(['MANAGER', 'ADMIN']), carburantCtrl.cloturerBonLivraison);
router.post('/bons-livraison/:id/rouvrir', rbac(['ADMIN']), carburantCtrl.rouvrirBonLivraison);

// ── Rapport corrélation appro ↔ consommation énergie ──────────
router.get('/rapports/correlation-carburant', carburantCtrl.getCorrelationCarburant);

// ── Réapprovisionnement prédictif ─────────────────────────────
router.get('/rapports/reapprovisionnement', rbac(['MANAGER', 'ADMIN', 'SUPERVISEUR']), carburantCtrl.getReapprovisionnement);
router.get('/rapports/anomalies-conso', rbac(['MANAGER', 'ADMIN', 'SUPERVISEUR']), carburantCtrl.getAnomaliesConso);
router.get('/rapports/anomalies-carburant', rbac(['MANAGER', 'ADMIN', 'SUPERVISEUR', 'DIRECTION']), rapportsCtrl.getAnomaliesCarburant);
router.get('/rapports/dashboard-direction', rbac(['MANAGER', 'ADMIN', 'DIRECTION']), rapportsCtrl.getDashboardDirection);
router.get('/rapports/empreinte-carbone', rbac(['SUPERVISEUR', 'MANAGER', 'ADMIN', 'DIRECTION']), rapportsCtrl.getEmpreinteCarbone);
router.get('/rapports/fiabilite-ge', rbac(['MANAGER', 'ADMIN', 'DIRECTION']), rapportsCtrl.getFiabiliteGE);
router.get('/rapports/synthese-appro', rbac(['MANAGER', 'ADMIN', 'SUPERVISEUR']), carburantCtrl.getSyntheseAppro);
router.post('/bons-livraison/brouillon', rbac(['MANAGER', 'ADMIN']), carburantCtrl.createBrouillonLivraison);

// ── Rapport suivi des manquants de livraison (pilotage — pas les transporteurs) ──
router.get('/rapports/manquants-livraison', rbac(['SUPERVISEUR', 'MANAGER', 'ADMIN', 'DIRECTION']), carburantCtrl.getManquantsLivraison);
router.get('/rapports/manquants-livraison/export/:format(xlsx|pdf)', rbac(['MANAGER', 'ADMIN']), carburantCtrl.exportManquantsLivraison);
router.get('/rapports/manquants-livraison/site/:id', rbac(['SUPERVISEUR', 'MANAGER', 'ADMIN', 'DIRECTION']), carburantCtrl.getManquantsSite);
// Rapprochement trimestriel par bon de commande (bouclage comptable du carburant).
router.get('/rapports/rapprochement/:id', rbac(['SUPERVISEUR', 'MANAGER', 'ADMIN', 'DIRECTION']), carburantCtrl.getRapprochementBc);
router.get('/rapports/rapprochement/:id/export/:format(xlsx|pdf)', rbac(['MANAGER', 'ADMIN', 'DIRECTION']), carburantCtrl.exportRapprochementBc);

// ── Relevés énergie ───────────────────────────────────────────
router.get('/releves', relevesCtrl.getReleves);
router.get('/releves/export/:format(xlsx|pdf)', rbac(['SUPERVISEUR','MANAGER','ADMIN']), relevesCtrl.exportReleves);
router.post('/releves', rbac(['TECHNICIEN','SUPERVISEUR','MANAGER','ADMIN']), relevesCtrl.createReleve);
router.post('/releves/import', rbac(['ADMIN']), uploadSpreadsheet.single('file'), relevesImportCtrl.importReleves);
router.get('/releves/:id', relevesCtrl.getReleveById);

// ── Incidents ─────────────────────────────────────────────────
router.get('/incidents', incidentsCtrl.getIncidents);
router.get('/incidents/kpis', rbac(['SUPERVISEUR','MANAGER','ADMIN','DIRECTION','NOC']), incidentsCtrl.getIncidentKPIs);
router.get('/incidents/export/:format(xlsx|pdf)', rbac(['NOC','SUPERVISEUR','MANAGER','ADMIN']), incidentsCtrl.exportIncidents);
router.post('/incidents', rbac(['TECHNICIEN','SUPERVISEUR','MANAGER','ADMIN','NOC']), incidentsCtrl.createIncident);
router.get('/incidents/:id', incidentsCtrl.getIncidentById);
router.put('/incidents/:id', rbac(['SUPERVISEUR','MANAGER','ADMIN']), incidentsCtrl.updateIncident);
router.delete('/incidents/:id', rbac(['ADMIN']), incidentsCtrl.deleteIncident);
router.get('/incidents/:id/techniciens-assignables', rbac(['SUPERVISEUR','MANAGER','ADMIN']), incidentsCtrl.getTechniciensAssignables);
router.post('/incidents/:id/assign', rbac(['SUPERVISEUR','MANAGER','ADMIN']), incidentsCtrl.assignIncident);
router.post('/incidents/:id/demarrer', rbac(['TECHNICIEN','SUPERVISEUR','MANAGER','ADMIN']), incidentsCtrl.startIncident);
router.post('/incidents/:id/close', rbac(['TECHNICIEN','SUPERVISEUR','MANAGER','ADMIN']), incidentsCtrl.closeIncident);

// ── Rapports ──────────────────────────────────────────────────
router.get('/rapports/dashboard', rapportsCtrl.getDashboard);
// Ligne de vie (24 h) : tous rôles connectés — le périmètre est appliqué dedans.
router.get('/rapports/pouls-24h', rapportsCtrl.getPouls24h);
router.get('/rapports/stock-carburant', rbac(['SUPERVISEUR','MANAGER','ADMIN','DIRECTION']), rapportsCtrl.getStockCarburant);
router.get('/rapports/parc-prestataires', rbac(['SUPERVISEUR','MANAGER','ADMIN','DIRECTION']), rapportsCtrl.getParcPrestataires);
// Bilan carburant sur période : stock aux bornes + conso par conservation + courbe 12 mois.
router.get('/rapports/bilan-carburant', rbac(['SUPERVISEUR','MANAGER','ADMIN','DIRECTION']), rapportsCtrl.getBilanCarburant);
router.get('/rapports/bilan-carburant/export/:format(xlsx|pdf)', rbac(['SUPERVISEUR','MANAGER','ADMIN','DIRECTION']), rapportsCtrl.exportBilanCarburant);
// Bilan énergie CEET : même logique, l'index compteur joue le rôle de la jauge.
router.get('/rapports/bilan-energie', rbac(['SUPERVISEUR','MANAGER','ADMIN','DIRECTION']), rapportsCtrl.getBilanEnergie);
router.get('/rapports/bilan-energie/export/:format(xlsx|pdf)', rbac(['SUPERVISEUR','MANAGER','ADMIN','DIRECTION']), rapportsCtrl.exportBilanEnergie);
router.get('/rapports/conso-energie', rbac(['SUPERVISEUR','MANAGER','ADMIN','DIRECTION']), rapportsCtrl.getConsoEnergie);
router.get('/rapports/maintenance', rbac(['SUPERVISEUR','MANAGER','ADMIN','DIRECTION']), rapportsCtrl.getRapportMaintenance);
// NOC inclus : le suivi des incidents fait partie de sa supervision réseau, et
// NOC_ALLOW l'autorisait déjà — sans NOC ici l'entrée d'allowlist était morte
// (la route répondait 403 à un rôle pourtant censé y accéder).
router.get('/rapports/incidents', rbac(['SUPERVISEUR','MANAGER','ADMIN','DIRECTION','NOC']), rapportsCtrl.getRapportIncidents);
router.get('/rapports/conformite', rbac(['SUPERVISEUR','MANAGER','ADMIN','DIRECTION']), rapportsCtrl.getConformiteMaintenance);
router.get('/rapports/sla-prestataires', rbac(['SUPERVISEUR','MANAGER','ADMIN','DIRECTION']), rapportsCtrl.getSlaPrestataires);
router.get('/rapports/gardiennage', rbac(['SUPERVISEUR','MANAGER','ADMIN','DIRECTION']), rapportsCtrl.getRapportGardiennage);
router.get('/rapports/mensuel/:annee/:mois', rbac(['MANAGER','ADMIN','DIRECTION']), rapportsCtrl.getRapportMensuelPdf); // coûts complets non périmétrés : internes seulement
router.post('/rapports/mensuel/send', rbac(['MANAGER','ADMIN']), rapportsCtrl.sendRapportMensuel);

// ── Utilisateurs ──────────────────────────────────────────────
router.get('/users', rbac(['SUPERVISEUR','MANAGER','ADMIN']), usersCtrl.getUsers);
router.get('/users/export/:format(csv|xlsx|pdf)', rbac(['ADMIN']), usersCtrl.exportUsers);
router.post('/users', rbac(['ADMIN']), usersCtrl.createUser);
router.get('/users/:id', rbac(['SUPERVISEUR','MANAGER','ADMIN']), usersCtrl.getUserById);
router.put('/users/:id', rbac(['ADMIN']), usersCtrl.updateUser);
router.delete('/users/:id', rbac(['ADMIN']), usersCtrl.deleteUser);
router.post('/users/:id/toggle-active', rbac(['ADMIN']), usersCtrl.toggleActive);
router.post('/users/:id/reset-password', rbac(['ADMIN']), usersCtrl.resetUserPassword);
// Verrou d'appareil terrain : déliaison lors d'un remplacement de téléphone.
router.post('/users/:id/delier-appareil', rbac(['ADMIN']), usersCtrl.delierAppareil);

// ── Administration ────────────────────────────────────────────
// Référentiel types de pylône : lecture pour tous (formulaires), édition admin.
router.get('/types-pylone', adminCtrl.listTypesPylone);
router.get('/types-incident', adminCtrl.listTypesIncident);
router.get('/equipements', adminCtrl.listEquipements);
router.post('/admin/equipements', rbac(['ADMIN']), adminCtrl.upsertEquipement);
router.delete('/admin/equipements/:code', rbac(['ADMIN']), adminCtrl.deleteEquipement);
router.post('/admin/types-incident', rbac(['ADMIN']), adminCtrl.upsertTypeIncident);
router.delete('/admin/types-incident/:code', rbac(['ADMIN']), adminCtrl.deleteTypeIncident);
router.post('/admin/types-pylone', rbac(['ADMIN']), adminCtrl.upsertTypePylone);
router.delete('/admin/types-pylone/:code', rbac(['ADMIN']), adminCtrl.deleteTypePylone);
router.get('/admin/settings', rbac(['ADMIN']), adminCtrl.getSettings);
router.get('/admin/sms-templates', rbac(['ADMIN']), adminCtrl.getSmsTemplates);
router.get('/admin/settings/effectifs', rbac(['ADMIN']), adminCtrl.getEffectiveSettings);
router.put('/admin/settings', rbac(['ADMIN']), adminCtrl.updateSettings);
router.get('/admin/taches-preventives', rbac(['ADMIN']), adminCtrl.getTachePreventiveOverrides);
router.put('/admin/taches-preventives/:key', rbac(['ADMIN']), adminCtrl.updateTachePreventiveOverride);
router.delete('/admin/taches-preventives/:key', rbac(['ADMIN']), adminCtrl.deleteTachePreventiveOverride);
router.get('/admin/audit', rbac(['ADMIN']), adminCtrl.getAuditLogs);
router.post('/admin/test-email', rbac(['ADMIN']), adminCtrl.testEmail);
router.get('/admin/health', rbac(['ADMIN']), adminCtrl.getSystemHealth);
router.get('/admin/metrics', rbac(['ADMIN']), adminCtrl.getMetrics);

// ── Console base de données (ADMIN) ───────────────────────────
// CRUD générique sur les tables du modèle Prisma. Le nom de table est validé
// contre le catalogue dérivé du schéma (liste blanche) et chaque écriture part
// au journal d'audit — cf. services/dbAdmin.service.ts.
const dbAdmin = rbac(['ADMIN']);
router.get('/admin/db/tables', dbAdmin, dbAdminCtrl.listerTables);
router.get('/admin/db/tables/:modele', dbAdmin, dbAdminCtrl.decrireTable);
router.get('/admin/db/tables/:modele/lignes', dbAdmin, dbAdminCtrl.listerLignes);
router.get('/admin/db/tables/:modele/options', dbAdmin, dbAdminCtrl.optionsTable);
router.get('/admin/db/tables/:modele/export/:format(xlsx|pdf)', dbAdmin, heavyLimit, dbAdminCtrl.exporterTable);
router.get('/admin/db/tables/:modele/lignes/:id', dbAdmin, dbAdminCtrl.lireLigne);
router.get('/admin/db/tables/:modele/lignes/:id/impact', dbAdmin, dbAdminCtrl.impactLigne);
router.post('/admin/db/tables/:modele/lignes', dbAdmin, dbAdminCtrl.creerLigne);
router.patch('/admin/db/tables/:modele/lignes/:id', dbAdmin, dbAdminCtrl.modifierLigne);
router.delete('/admin/db/tables/:modele/lignes/:id', dbAdmin, dbAdminCtrl.supprimerLigne);

// ── Notifications ─────────────────────────────────────────────
router.get('/notifications', notifCtrl.getNotifications);
router.put('/notifications/:id/read', notifCtrl.markRead);
router.put('/notifications/read-all', notifCtrl.markAllRead);

// ── Upload ────────────────────────────────────────────────────
router.post('/upload/image', uploadMiddleware.single('file'), verifierSignature, uploadCtrl.uploadImage);
router.post('/upload/document', uploadMiddleware.single('file'), verifierSignature, uploadCtrl.uploadDocument);
