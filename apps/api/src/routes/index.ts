import { Router } from 'express';
import { authMiddleware } from '../middlewares/auth';
import { rbac } from '../middlewares/rbac';

// Controllers
import * as authCtrl from '../controllers/auth.controller';
import * as sitesCtrl from '../controllers/sites.controller';
import * as maintenanceCtrl from '../controllers/maintenances.controller';
import * as depotagesCtrl from '../controllers/depotages.controller';
import * as relevesCtrl from '../controllers/releves.controller';
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
import { uploadMiddleware, uploadSpreadsheet } from '../middlewares/upload';

export const router = Router();

// ── Auth (public) ─────────────────────────────────────────────
router.post('/auth/login', authCtrl.login);
router.post('/auth/refresh-token', authCtrl.refreshToken);
router.post('/auth/forgot-password', authCtrl.forgotPassword);
router.post('/auth/reset-password', authCtrl.resetPassword);

// ── Auth (protégé) ────────────────────────────────────────────
router.use(authMiddleware); // Tout ce qui suit requiert un JWT valide

router.post('/auth/logout', authCtrl.logout);
router.get('/auth/me', authCtrl.getMe);
router.put('/auth/me/password', authCtrl.updatePassword);
router.post('/auth/fcm-token', authCtrl.updateFcmToken);

// ── Sites ─────────────────────────────────────────────────────
router.get('/sites', sitesCtrl.getSites);
router.get('/sites/geojson', sitesCtrl.getSitesGeoJSON);
router.get('/sites/export/xlsx', rbac(['MANAGER','ADMIN']), sitesCtrl.exportSites);
router.get('/sites/import/template', rbac(['MANAGER','ADMIN']), sitesCtrl.sitesImportTemplate);
router.post('/sites/import', rbac(['ADMIN']), uploadSpreadsheet.single('file'), sitesCtrl.importSites);

// ── Config applicative (règles terrain exposées aux apps) ──
router.get('/config', configCtrl.getAppConfig);

// ── Tâches préventives contractuelles ─────────────────────
router.get('/taches-preventives', tachesCtrl.getCatalogue);
router.post('/taches-preventives/generer', rbac(['MANAGER', 'ADMIN']), tachesCtrl.genererPlanning);
router.get('/rapports/echeancier-preventif', rbac(['SUPERVISEUR', 'MANAGER', 'ADMIN', 'DIRECTION']), tachesCtrl.getEcheancier);
router.get('/rapports/fiche-validation', rbac(['SUPERVISEUR', 'MANAGER', 'ADMIN', 'DIRECTION']), tachesCtrl.getFicheValidation);
router.post('/sites', rbac(['MANAGER','ADMIN']), sitesCtrl.createSite);
router.get('/sites/:id', sitesCtrl.getSiteById);
router.put('/sites/:id', rbac(['MANAGER','ADMIN']), sitesCtrl.updateSite);
router.put('/sites/:id/groupes', rbac(['MANAGER','ADMIN']), sitesCtrl.replaceSiteGroupes);
router.delete('/sites/:id', rbac(['ADMIN']), sitesCtrl.deleteSite);
router.get('/sites/:id/taches-preventives', tachesCtrl.getTachesForSite);
router.get('/sites/:id/stock', sitesCtrl.getSiteStock);
router.get('/sites/:id/maintenances', sitesCtrl.getSiteMaintenances);
router.get('/sites/:id/depotages', sitesCtrl.getSiteDepotages);
router.get('/sites/:id/releves', sitesCtrl.getSiteReleves);
router.get('/sites/:id/incidents', sitesCtrl.getSiteIncidents);

// ── Prestataires ──────────────────────────────────────────────
router.get('/prestataires', prestatairesCtrl.getPrestataires);
router.post('/prestataires', rbac(['MANAGER', 'ADMIN']), prestatairesCtrl.createPrestataire);
router.get('/prestataires/:id', prestatairesCtrl.getPrestataireById);
router.put('/prestataires/:id', rbac(['MANAGER', 'ADMIN']), prestatairesCtrl.updatePrestataire);
router.post('/prestataires/:id/toggle-active', rbac(['MANAGER', 'ADMIN']), prestatairesCtrl.togglePrestataire);
router.delete('/prestataires/:id', rbac(['ADMIN']), prestatairesCtrl.deletePrestataire);

// ── Lots de maintenance ───────────────────────────────────────
router.get('/lots', lotsCtrl.getLots);
router.post('/lots', rbac(['MANAGER', 'ADMIN']), lotsCtrl.createLot);
router.get('/lots/:id', lotsCtrl.getLotById);
router.put('/lots/:id', rbac(['MANAGER', 'ADMIN']), lotsCtrl.updateLot);
router.delete('/lots/:id', rbac(['ADMIN']), lotsCtrl.deleteLot);
router.post('/lots/:id/assignments', rbac(['MANAGER', 'ADMIN']), lotsCtrl.addAssignment);
router.delete('/lots/:id/assignments/:assignmentId', rbac(['MANAGER', 'ADMIN']), lotsCtrl.removeAssignment);
router.post('/lots/:id/sites', rbac(['MANAGER', 'ADMIN']), lotsCtrl.assignSites);
router.delete('/lots/:id/sites/:siteId', rbac(['MANAGER', 'ADMIN']), lotsCtrl.removeSite);

// ── Maintenances ──────────────────────────────────────────────
router.get('/maintenances', maintenanceCtrl.getMaintenances);
router.get('/maintenances/planning', maintenanceCtrl.getPlanning);
router.get('/maintenances/export/xlsx', rbac(['MANAGER','ADMIN']), maintenanceCtrl.exportMaintenances);
router.post('/maintenances', maintenanceCtrl.createMaintenance);
router.get('/maintenances/:id', maintenanceCtrl.getMaintenanceById);
router.put('/maintenances/:id', maintenanceCtrl.updateMaintenance);
router.delete('/maintenances/:id', rbac(['ADMIN','MANAGER']), maintenanceCtrl.deleteMaintenance);
router.post('/maintenances/:id/start', maintenanceCtrl.startMaintenance);
router.post('/maintenances/:id/close', maintenanceCtrl.closeMaintenance);
router.get('/maintenances/:id/pdf', maintenanceCtrl.getMaintenancePdf);

// ── Dépotages ─────────────────────────────────────────────────
router.get('/depotages', depotagesCtrl.getDepotages);
router.get('/depotages/export/xlsx', rbac(['MANAGER','ADMIN']), depotagesCtrl.exportDepotages);
router.post('/depotages', depotagesCtrl.createDepotage);
router.get('/depotages/:id', depotagesCtrl.getDepotageById);
router.put('/depotages/:id', depotagesCtrl.updateDepotage);
router.delete('/depotages/:id', rbac(['ADMIN']), depotagesCtrl.deleteDepotage);

// ── Relevés énergie ───────────────────────────────────────────
router.get('/releves', relevesCtrl.getReleves);
router.get('/releves/export/xlsx', rbac(['MANAGER','ADMIN']), relevesCtrl.exportReleves);
router.post('/releves', relevesCtrl.createReleve);
router.get('/releves/:id', relevesCtrl.getReleveById);

// ── Incidents ─────────────────────────────────────────────────
router.get('/incidents', incidentsCtrl.getIncidents);
router.get('/incidents/kpis', incidentsCtrl.getIncidentKPIs);
router.get('/incidents/export/xlsx', rbac(['MANAGER','ADMIN']), incidentsCtrl.exportIncidents);
router.post('/incidents', incidentsCtrl.createIncident);
router.get('/incidents/:id', incidentsCtrl.getIncidentById);
router.put('/incidents/:id', incidentsCtrl.updateIncident);
router.delete('/incidents/:id', rbac(['ADMIN']), incidentsCtrl.deleteIncident);
router.post('/incidents/:id/assign', rbac(['SUPERVISEUR','MANAGER','ADMIN']), incidentsCtrl.assignIncident);
router.post('/incidents/:id/close', incidentsCtrl.closeIncident);

// ── Rapports ──────────────────────────────────────────────────
router.get('/rapports/dashboard', rapportsCtrl.getDashboard);
router.get('/rapports/stock-carburant', rapportsCtrl.getStockCarburant);
router.get('/rapports/conso-energie', rapportsCtrl.getConsoEnergie);
router.get('/rapports/maintenance', rapportsCtrl.getRapportMaintenance);
router.get('/rapports/incidents', rapportsCtrl.getRapportIncidents);
router.get('/rapports/conformite', rapportsCtrl.getConformiteMaintenance);
router.get('/rapports/mensuel/:annee/:mois', rbac(['MANAGER','ADMIN','DIRECTION']), rapportsCtrl.getRapportMensuelPdf);
router.post('/rapports/mensuel/send', rbac(['MANAGER','ADMIN']), rapportsCtrl.sendRapportMensuel);

// ── Utilisateurs ──────────────────────────────────────────────
router.get('/users', rbac(['SUPERVISEUR','MANAGER','ADMIN']), usersCtrl.getUsers);
router.get('/users/export/csv', rbac(['ADMIN']), usersCtrl.exportUsers);
router.post('/users', rbac(['ADMIN']), usersCtrl.createUser);
router.get('/users/:id', rbac(['SUPERVISEUR','MANAGER','ADMIN']), usersCtrl.getUserById);
router.put('/users/:id', rbac(['ADMIN']), usersCtrl.updateUser);
router.delete('/users/:id', rbac(['ADMIN']), usersCtrl.deleteUser);
router.post('/users/:id/toggle-active', rbac(['ADMIN']), usersCtrl.toggleActive);
router.post('/users/:id/reset-password', rbac(['ADMIN']), usersCtrl.resetUserPassword);

// ── Administration ────────────────────────────────────────────
router.get('/admin/settings', rbac(['ADMIN']), adminCtrl.getSettings);
router.put('/admin/settings', rbac(['ADMIN']), adminCtrl.updateSettings);
router.get('/admin/audit', rbac(['ADMIN']), adminCtrl.getAuditLogs);
router.get('/admin/health', rbac(['ADMIN']), adminCtrl.getSystemHealth);
router.get('/admin/metrics', rbac(['ADMIN']), adminCtrl.getMetrics);

// ── Notifications ─────────────────────────────────────────────
router.get('/notifications', notifCtrl.getNotifications);
router.put('/notifications/:id/read', notifCtrl.markRead);
router.put('/notifications/read-all', notifCtrl.markAllRead);

// ── Upload ────────────────────────────────────────────────────
router.post('/upload/image', uploadMiddleware.single('file'), uploadCtrl.uploadImage);
router.post('/upload/document', uploadMiddleware.single('file'), uploadCtrl.uploadDocument);
