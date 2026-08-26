-- Contrat de maintenance SOLAIRE : troisième scope contractuel (à côté de la
-- passive et de l'active), avec sa catégorie d'équipement et son équipe de
-- techniciens. Les valeurs d'enum s'ajoutent sans toucher à l'existant.
ALTER TYPE "ScopeMaintenance" ADD VALUE IF NOT EXISTS 'SOLAIRE';
ALTER TYPE "CategorieEquipement" ADD VALUE IF NOT EXISTS 'SOLAIRE';
ALTER TYPE "EquipeMaintenance" ADD VALUE IF NOT EXISTS 'SOLAIRE';
