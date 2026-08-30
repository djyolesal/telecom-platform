// Énumérations métier alignées sur le schéma Prisma de l'API.
// On les manipule comme des String côté mobile pour rester souple,
// ces listes servent aux sélecteurs et aux libellés.

const List<String> kRegions = [
  'Maritime',
  'Plateaux',
  'Centrale',
  'Kara',
  'Savanes'
];

const Map<String, String> kTypeMaintenance = {
  'PREVENTIVE': 'Préventive',
  'CURATIVE': 'Curative',
};

const Map<String, String> kNatureTravaux = {
  'ENTRETIEN': 'Entretien',
  'INSTALLATION': 'Installation',
  'DESINSTALLATION': 'Désinstallation',
  'DEPLACEMENT': 'Déplacement',
};

const Map<String, String> kStatutMaintenance = {
  'PLANIFIEE': 'Planifiée',
  'EN_COURS': 'En cours',
  'SUSPENDUE': 'Suspendue',
  'TERMINEE': 'Terminée',
  'ANNULEE': 'Annulée',
};

const Map<String, String> kCategorieEquipement = {
  'GE': 'Groupe électrogène',
  'BATTERIE': 'Batterie',
  'CLIMATISEUR': 'Climatiseur',
  'ANTENNE': 'Antenne',
  'CABLE': 'Câble',
  'RESEAU': 'Réseau',
  'AUTRE': 'Autre',
};

const Map<String, String> kSourceEnergie = {
  'CEET': 'CEET',
  'GE': 'Groupe électrogène',
  'SOLAIRE': 'Solaire',
};

const Map<String, String> kTypeIncident = {
  'ALARME': 'Alarme',
  'COUPURE_CEET': 'Coupure CEET',
  'COUPURE_TOTALE': 'Coupure totale',
  'PANNE_GE': 'Panne GE',
  'INTRUSION': 'Intrusion',
  'VANDALISME': 'Vandalisme',
  'AUTRE': 'Autre',
};

const Map<String, String> kSeverite = {
  'CRITIQUE': 'Critique',
  'MAJEUR': 'Majeur',
  'MINEUR': 'Mineur',
  'INFORMATIF': 'Informatif',
};

const Map<String, String> kStatutIncident = {
  'OUVERT': 'Ouvert',
  'EN_COURS': 'En cours',
  'RESOLU': 'Résolu',
  'CLOS': 'Clos',
};

// Rôle utilisateur : jamais le code brut à l'écran (accueil).
const Map<String, String> kRoles = {
  'TECHNICIEN': 'Technicien',
  'SUPERVISEUR': 'Superviseur',
  'MANAGER': 'Chef de parc',
  'ADMIN': 'Administrateur',
  'DIRECTION': 'Direction',
  'TRANSPORTEUR': 'Transporteur',
  'NOC': 'Supervision réseau',
};

// Configuration électrique du site (fiche site).
const Map<String, String> kPowerConfig = {
  'CEET_GE': 'CEET + groupe de secours',
  'CEET_UNIQUEMENT': 'CEET seule',
  'GE_UNIQUEMENT': 'Groupe seul',
  'HYBRIDE_GE': 'Hybride avec groupe',
  'SOLAIRE_UNIQUEMENT': 'Solaire seul',
  'HYBRIDE_CEET_GE': 'Hybride CEET + groupe',
};

const Map<String, String> kStatutGe = {
  'GE_PERMANENT': 'Groupe permanent',
  'GE_SECOURS': 'Groupe de secours',
  'PAS_DE_GE': 'Pas de groupe',
};

// Niveau d'alerte du stock carburant (fiche site).
const Map<String, String> kNiveauStock = {
  'VIDE': 'Cuve vide',
  'CRITIQUE': 'Critique',
  'FAIBLE': 'Faible',
  'OK': 'Suffisant',
  'NA': 'Non évalué',
};

// Statuts logistiques (bons de livraison et lignes du plan).
const Map<String, String> kStatutBl = {
  'PLANIFIE': 'Planifié',
  'CHARGE': 'En livraison',
  'LIVRE': 'Livré',
  'ANNULE': 'Annulé',
};

const Map<String, String> kStatutLigneLivraison = {
  'PREVU': 'Prévu',
  'PARTIEL': 'Partiel',
  'LIVRE': 'Livré',
  'ANNULE': 'Annulé',
};
