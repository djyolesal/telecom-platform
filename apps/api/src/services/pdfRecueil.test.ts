import { generateMaintenancesRecueilPdf, nombreFr } from './pdf.service';

// PNG 1×1 : suffit à exercer la mise en page des cadres photo.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

const TEXTE_LONG = 'Intervention préventive complète sur le groupe électrogène : vidange moteur, remplacement des filtres à huile, à gasoil et à air, contrôle des courroies et du circuit de refroidissement, nettoyage du préfiltre décanteur, resserrage des cosses de batterie, essai en charge de trente minutes, contrôle du niveau de la cuve et de l’étanchéité du bac de rétention, nettoyage complet du local technique et évacuation des déchets vers le centre agréé. '.repeat(3);

const intervention = (i: number) => ({
  id: `00000000-0000-0000-0000-00000000000${i}`,
  reference: `MNT-2026-0000${i}`,
  type: 'PREVENTIVE',
  categorie: 'GE',
  equipement: 'Groupe électrogène PERKINS 22 kVA n°2 avec un libellé délibérément interminable',
  statut: 'TERMINEE',
  datePlanifiee: new Date(2026, 7, 10),
  dateDebut: new Date(2026, 7, 10, 9),
  dateFin: new Date(2026, 7, 10, 11, 30),
  dureeMinutes: 150,
  dureeSuspendueMinutes: 20,
  description: TEXTE_LONG,
  observations: TEXTE_LONG,
  analyseEnergie: TEXTE_LONG,
  nomAgentSecurite: 'Kodjo AGBEKO',
  site: { nom: 'Site de recette avec un nom très long pour déborder', code: 'SAV-015', region: 'Savanes' },
  technicien: { nom: 'Kossi', prenom: 'Edem' },
  prestataire: { nom: 'ENTREPRISE GÉNÉRALE DE MAINTENANCE ET DE TRAVAUX DIVERS DU TOGO' },
  pieces: Array.from({ length: 8 }, (_, k) => ({ nom: `Pièce numéro ${k + 1}`, reference: `REF-${k}`, quantite: k + 1 })),
  releves: [
    { source: 'GE', groupeNumero: 1, indexHeuresGE: 12480.5, heuresFonctGE: 96.5, volumeGasoilLitres: 820, gasoilConsommeLitres: 310 },
    { source: 'GE', groupeNumero: 2, indexHeuresGE: 8210, heuresFonctGE: 40 },
    { source: 'CEET', indexCompteur: 448210, consommationKwh: 3120 },
    { source: 'SOLAIRE', puissanceKva: 12 },
  ],
  photosAvant: [PNG, PNG],
  photosApres: [PNG, PNG, PNG],
  totalPhotosAvant: 4,
  totalPhotosApres: 7,
  echantillon: true,
  signatureTechnicien: PNG,
  signatureAgent: null,
}) as unknown as Parameters<typeof generateMaintenancesRecueilPdf>[0][number];

const garde = {
  titre: "Rapport mensuel d'activité",
  prestataire: { nom: 'ENTREPRISE GÉNÉRALE DE MAINTENANCE DU TOGO', logo: null },
  periode: 'août 2026', perimetre: 'lot L3', nb: 3, preventives: 3, curatives: 0, sites: 3, heures: 7,
  client: 'Moov Africa Togo', reference: 'RMA-2026-08-0001', manquantes: [], moisComplet: true,
  incidents: [], pieces: [],
};

const nbPages = (pdf: Buffer) => pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g)?.length ?? 0;

describe("rapport mensuel d'activité", () => {
  it('donne UNE page par intervention, même saturée de contenu', async () => {
    // Un dossier de trente interventions se feuillette en attendant une page
    // chacune : une intervention à cheval sur deux pages fait lire la
    // signature du suivant comme la sienne.
    const liste = [1, 2, 3].map(intervention);
    const pdf = await generateMaintenancesRecueilPdf(liste, garde);
    expect(nbPages(pdf)).toBe(1 + liste.length); // couverture + une page chacune
  });

  it('tient aussi sur une page quand l’intervention est vide', async () => {
    const nu = { ...intervention(1), description: null, observations: null, analyseEnergie: null,
      pieces: [], releves: [], photosAvant: [], photosApres: [], totalPhotosAvant: 0, totalPhotosApres: 0,
      nomAgentSecurite: null, signatureAgent: null } as unknown as Parameters<typeof generateMaintenancesRecueilPdf>[0][number];
    expect(nbPages(await generateMaintenancesRecueilPdf([nu], garde))).toBe(2);
  });
});

describe('nombres du PDF', () => {
  it('sépare les milliers par une espace que la police contient', () => {
    // Régression : toLocaleString('fr-FR') emploie U+202F, absente de
    // Helvetica/WinAnsi - « 12 480 » s'imprimait « 12/480 ».
    expect(nombreFr(12480.5)).toBe('12 480,5');
    expect(nombreFr(448210)).toBe('448 210');
    expect(/[  ]/.test(nombreFr(1234567))).toBe(false);
  });
});
