import { generateMaintenancesRecueilPdf, generateMaintenancePdf, MaintenancePdfData } from './pdf.service';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64');
const photos = (n: number) => Array.from({ length: n }, () => PNG);
const pages = (pdf: Buffer) => (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
const LONG = 'Entretien mensuel du groupe electrogene : vidange complete, controle des niveaux, nettoyage du filtre a air, '
  + 'verification du circuit de refroidissement et du serrage des cosses. Test de demarrage automatique sur coupure secteur '
  + 'concluant, bascule en 8 secondes. Nettoyage de la dalle et evacuation des dechets de vidange vers le depot. '
  + 'Aucune anomalie residuelle constatee a la remise en service.';

const charge = (i: number): MaintenancePdfData => ({
  id: `mnt-${i}`, reference: `MNT-2026-0041${i}`, type: 'PREVENTIVE', categorie: 'GE',
  equipement: 'Groupe electrogene n°1 - Perkins 60 kVA', statut: 'TERMINEE',
  datePlanifiee: new Date('2026-09-01T08:00:00Z'), dateDebut: new Date('2026-09-03T09:12:00Z'),
  dateFin: new Date('2026-09-03T11:05:00Z'), dureeMinutes: 113, dureeSuspendueMinutes: 12,
  nomAgentSecurite: 'Kossi AGBEKO',
  site: { nom: 'Site Tabligbo 3', code: 'MAR-TAB-03', region: 'Maritime' },
  technicien: { nom: 'KOSSI', prenom: 'Edem' }, prestataire: { nom: 'NETIS Maintenance' },
  description: LONG, observations: LONG, analyseEnergie: LONG,
  notePreuves: "Preuves reprises de l'incident INC-2026-00318.",
  pieces: Array.from({ length: 5 }, (_, k) => ({ nom: `Piece numero ${k + 1}`, reference: `REF-${k}`, quantite: k + 1 })),
  releves: [
    { source: 'GE', groupeNumero: 1, indexHeuresGE: 12450, heuresFonctGE: 310, volumeGasoilLitres: 1250, gasoilConsommeLitres: 940 },
    { source: 'GE', groupeNumero: 2, indexHeuresGE: 8120, heuresFonctGE: 96 },
    { source: 'CEET', indexCompteur: 88421, consommationKwh: 1320 },
    { source: 'SOLAIRE', puissanceKva: 12 },
  ],
  echantillon: true, photosAvant: photos(1), photosApres: photos(2), totalPhotosAvant: 5, totalPhotosApres: 8,
  signatureTechnicien: PNG, signatureAgent: PNG,
});

const GARDE = {
  titre: "Rapport mensuel d'activite", periode: 'Septembre 2026', perimetre: 'NETIS - Lot Maritime Sud',
  client: 'Moov Africa', reference: 'RMA-2026-09-001', nb: 3, preventives: 3, curatives: 0, sites: 2, heures: 6,
  manquantes: [], moisComplet: true, incidents: [], pieces: [],
  prestataire: { nom: 'NETIS Maintenance' },
};

describe('mesure', () => {
  it('recueil : 1 page de garde + 1 page par intervention', async () => {
    const liste = [charge(1), charge(2), charge(3)];
    const n = pages(await generateMaintenancesRecueilPdf(liste, { ...GARDE }));
    // eslint-disable-next-line no-console
    console.log(`RECUEIL 3 interventions chargees -> ${n} pages (cible 4)`);
    expect(n).toBe(4);
  });
  it('unitaire charge', async () => {
    const u = { ...charge(9), echantillon: false, photosAvant: photos(6), photosApres: photos(6) };
    // eslint-disable-next-line no-console
    console.log(`UNITAIRE 12 photos -> ${pages(await generateMaintenancePdf(u))} page(s)`);
  });
});
