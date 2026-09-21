import ExcelJS from 'exceljs';
import { buildConformiteXlsx, DonneesConformite } from './conformiteExport.service';

/**
 * La matrice sites × tâches se lit par POSITION : décaler les colonnes
 * d'identité (ajout de la configuration d'énergie) décale toutes les tâches.
 * Un OK affiché sous la mauvaise tâche est invisible à l'œil et fausserait un
 * rapport contractuel — d'où la vérification du contenu cellule par cellule.
 */
const donnees = (): DonneesConformite => ({
  labelMois: 'septembre 2026',
  parPrestataire: [{
    prestataireNom: 'Prestataire A', dues: 4, realisees: 3, tauxContractuel: 75,
    sitesAvecDu: 2, sitesConformes: 1, invalidees: 0,
    evolution: [{ mois: '2026-09', label: 'sept.', dues: 4, realisees: 3, taux: 75 }],
  }],
  taches: [
    { numero: 1, key: 'desherbage', libelle: 'Désherbage' },
    { numero: 9, key: 'ge_production', libelle: 'Vidange GE production' },
    { numero: 10, key: 'ge_secours', libelle: 'Vidange GE secours' },
  ],
  sites: [
    {
      site: 'Site GE seul', region: 'Centrale', prestataireId: 'p1',
      energie: 'GE uniquement', ge: 'GE permanent',
      statuts: { desherbage: 'OK', ge_production: 'NOK', ge_secours: 'NA' }, conforme: false,
    },
    {
      site: 'Site CEET+GE', region: 'Maritime', prestataireId: 'p1',
      energie: 'CEET + GE', ge: 'GE secours',
      statuts: { desherbage: 'OK', ge_production: 'NA', ge_secours: 'OK' }, conforme: true,
    },
  ],
  nomsPrestataires: new Map([['p1', 'Prestataire A']]),
});

describe('export xlsx de la conformité des maintenances', () => {
  let ws: ExcelJS.Worksheet;

  beforeAll(async () => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await buildConformiteXlsx(donnees()) as unknown as ArrayBuffer);
    ws = wb.getWorksheet('Conformité')!;
  });

  const ligneEntete = () => {
    for (let r = 1; r <= ws.rowCount; r++) {
      if (ws.getRow(r).getCell(1).value === 'Site') return r;
    }
    throw new Error('en-tête de la matrice introuvable');
  };

  it('nomme la configuration d\'énergie et le statut GE avec les mots du portail', () => {
    const e = ws.getRow(ligneEntete());
    expect([1, 2, 3, 4, 5].map((c) => e.getCell(c).value))
      .toEqual(['Site', 'Région', 'Prestataire', 'Config. énergie', 'Statut GE']);
  });

  it('porte la configuration de CHAQUE site, sans décaler les tâches', () => {
    const r1 = ws.getRow(ligneEntete() + 1);
    const r2 = ws.getRow(ligneEntete() + 2);
    expect([r1.getCell(4).value, r1.getCell(5).value]).toEqual(['GE uniquement', 'GE permanent']);
    expect([r2.getCell(4).value, r2.getCell(5).value]).toEqual(['CEET + GE', 'GE secours']);
    // Les tâches commencent en colonne 6 et gardent leur ordre : le GE de
    // production est dû sur le site GE seul, N/A sur le site à GE de secours.
    expect([6, 7, 8].map((c) => r1.getCell(c).value)).toEqual(['OK', 'NOK', '–']);
    expect([6, 7, 8].map((c) => r2.getCell(c).value)).toEqual(['OK', '–', 'OK']);
    // Verdict du site : toujours la dernière colonne, après les 3 tâches.
    expect(r1.getCell(9).value).toBe('NOK');
    expect(r2.getCell(9).value).toBe('OK');
  });

  it('laisse filtrer sur l\'énergie (le filtre couvre les colonnes d\'identité)', () => {
    // Relu depuis le fichier, le filtre est une plage : A9:E9 = Site → Statut GE.
    expect(String(ws.autoFilter)).toMatch(/^A\d+:E\d+$/);
  });
});
