import { buildFicheValidationPdf } from './pdf.service';
import { lignesFiche, FicheValidationData } from './ficheValidation.service';
import { SiteEligibilite } from '../utils/tachesPreventives';

const site = (o: Partial<SiteEligibilite> = {}): SiteEligibilite => ({
  typePylone: 'PYLONE_TREILLIS', hasClimatiseur: true, hasExtincteurs: true,
  powerConfig: 'CEET_GE', statutGE: 'GE_SECOURS', cuveVolumeLitres: 1000, ...o,
});

const sites = [site(), site(), site({ hasClimatiseur: false }), site({ statutGE: 'PAS_DE_GE', cuveVolumeLitres: null })];

const data: FicheValidationData = {
  prestataire: {
    // Nom volontairement long : il passe à la ligne dans le cadre de visa.
    nom: 'ENTREPRISE GÉNÉRALE DE MAINTENANCE ET DE TRAVAUX DIVERS DU TOGO',
    adresse: '123 rue des Télécoms, Lomé', rccm: 'TG-LOM-2019-B-1234', nif: '1000987654',
    contactCommercial: '+228 90 00 00 01', contactTechnique: '+228 90 00 00 02',
  },
  client: { nom: 'Moov Africa Togo', adresse: ['Bld de la paix', 'BP 14511 LOME - TOGO'] },
  zone: 'LOT 3 (Savanes)', nbSites: sites.length, annee: 2026, mois: 8,
  sites, realisesParKey: { desherbage: 4, clim: 1, depotage: 2 }, contrat: 'PASSIF',
};

const nbPages = (pdf: Buffer) => pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g)?.length ?? 0;

describe('fiche de validation PDF', () => {
  it('tient sur UNE page et ne laisse pas de page blanche derrière elle', async () => {
    // Régression : le pied de page était écrit SOUS la marge basse, ce que
    // PDFKit traite comme un débordement — chaque pied ouvrait une page, qui
    // recevait son pied à son tour. La fiche sortait avec deux pages blanches
    // et sans numérotation.
    const pdf = await buildFicheValidationPdf(data);
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(nbPages(pdf)).toBe(1);
  });

  it('la fiche SOLAIRE (3 lignes) tient aussi sur une page', async () => {
    const pdf = await buildFicheValidationPdf({ ...data, contrat: 'SOLAIRE' });
    expect(nbPages(pdf)).toBe(1);
  });

  it('PDF et xlsx partagent le MÊME calcul de lignes', () => {
    // La fiche est signée : les deux formats ne peuvent pas se contredire.
    const lignes = lignesFiche(data);
    expect(lignes).toHaveLength(12);
    const clim = lignes.find((l) => l.description.startsWith('Maintenance climatiseur'))!;
    expect(clim.concernes).toBe(3); // un site sans climatiseur
    expect(clim.realises).toBe(1);
    const desherbage = lignes.find((l) => l.description.startsWith('Sarclage'))!;
    expect(desherbage.concernes).toBe(4);
    expect(desherbage.realises).toBe(4);
    // Tâche jamais exécutée : la ligne existe quand même, à zéro.
    expect(lignes.find((l) => l.numero === 1)!.realises).toBe(0);
  });

  it('la fiche SOLAIRE reprend les 3 opérations contractuelles', () => {
    const lignes = lignesFiche({ ...data, contrat: 'SOLAIRE' });
    expect(lignes.map((l) => l.numero)).toEqual([1, 2, 3]);
  });
});
