// Énumérations métier alignées sur le schéma Prisma de l'API.
// On les manipule comme des String côté mobile pour rester souple,
// ces listes servent aux sélecteurs et aux libellés.

const List<String> kRegions = ['Maritime', 'Plateaux', 'Centrale', 'Kara', 'Savanes'];

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
