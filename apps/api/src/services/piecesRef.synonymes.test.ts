import { rapprocherPieces, rapprocherHistorique, validerSynonymes } from './piecesRef.service';
import { prisma } from '../config/database';

/**
 * Synonymes du catalogue : « Batterie 100 Ah », écrite sans tension par le
 * terrain, est la batterie 12V 100 Ah - pour l'historique comme pour les
 * saisies à venir.
 */

jest.mock('../config/database', () => ({
  prisma: { pieceRef: { findMany: jest.fn() }, pieceRechange: { findMany: jest.fn(), updateMany: jest.fn() } },
}));

const p = prisma as unknown as {
  pieceRef: { findMany: jest.Mock };
  pieceRechange: { findMany: jest.Mock; updateMany: jest.Mock };
};

const CATALOGUE = [
  { id: 'b100', code: 'BATTERIE_12V_100AH', libelle: 'Batterie 12V 100 Ah', synonymes: ['Batterie 100 Ah'] },
  { id: 'b70', code: 'BATTERIE_12V_70AH', libelle: 'Batterie 12V 70 Ah', synonymes: [] },
];

beforeEach(() => {
  jest.clearAllMocks();
  p.pieceRef.findMany.mockResolvedValue(CATALOGUE);
});

describe('rapprochement par synonyme', () => {
  it('une saisie terrain « batterie 100ah » se rattache à la 12V 100 Ah', async () => {
    const [l] = await rapprocherPieces([{ nom: 'batterie 100ah', quantite: 1 }]);
    expect(l.pieceRefId).toBe('b100');
  });

  it("l'historique libre se rattache aussi", async () => {
    p.pieceRechange.findMany.mockResolvedValue([{ id: 'x1', nom: 'Batterie 100 Ah', reference: null }, { id: 'x2', nom: 'Cadenas', reference: null }]);
    const bilan = await rapprocherHistorique();
    expect(bilan).toEqual({ examinees: 2, rapprochees: 1 });
    expect(p.pieceRechange.updateMany).toHaveBeenCalledWith({ where: { id: { in: ['x1'] } }, data: { pieceRefId: 'b100' } });
  });

  it('un synonyme revendiqué par deux pièces est ambigu : jamais deviné', async () => {
    p.pieceRef.findMany.mockResolvedValue([
      CATALOGUE[0],
      { ...CATALOGUE[1], synonymes: ['Batterie 100 Ah'] },
    ]);
    const [l] = await rapprocherPieces([{ nom: 'Batterie 100 Ah' }]);
    expect(l.pieceRefId).toBeNull();
  });
});

describe('saisie des synonymes', () => {
  it('nettoie, dédoublonne et ignore le libellé de la pièce elle-même', async () => {
    p.pieceRef.findMany.mockResolvedValue([]);
    const s = await validerSynonymes('Batterie 100 Ah, batterie 100ah ,\nBatterie 12V 100 Ah', { id: 'b100', code: 'BATTERIE_12V_100AH', libelle: 'Batterie 12V 100 Ah' });
    expect(s).toEqual(['Batterie 100 Ah']);
  });

  it("refuse un synonyme qui désigne déjà une autre pièce", async () => {
    p.pieceRef.findMany.mockResolvedValue([CATALOGUE[0]]);
    await expect(validerSynonymes(['Batterie 100 Ah'], { id: 'b70', code: 'BATTERIE_12V_70AH', libelle: 'Batterie 12V 70 Ah' }))
      .rejects.toThrow(/déjà la pièce « Batterie 12V 100 Ah »/);
  });
});
