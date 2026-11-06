import { prestatairesDuLot } from './sites.controller';

/** Colonnes « Prestataire passif / actif » de l'export des sites. */
jest.mock('../config/database', () => ({ prisma: {} }));

const a = (scope: string, nom: string) => ({ scope, prestataire: { nom } });

describe('prestatairesDuLot', () => {
  it('passif et actif chez deux sociétés différentes', () => {
    expect(prestatairesDuLot([a('PASSIVE', 'NETIS'), a('ACTIVE', 'ERICSSON')]))
      .toEqual({ prestatairePassif: 'NETIS', prestataireActif: 'ERICSSON' });
  });

  it('LES_DEUX remplit les deux colonnes', () => {
    expect(prestatairesDuLot([a('LES_DEUX', 'NETIS')]))
      .toEqual({ prestatairePassif: 'NETIS', prestataireActif: 'NETIS' });
  });

  it('le solaire est un contrat à part : il ne compte ni en passif ni en actif', () => {
    expect(prestatairesDuLot([a('SOLAIRE', 'SOLTECH')]))
      .toEqual({ prestatairePassif: '', prestataireActif: '' });
  });

  it('un lot sans attribution laisse les colonnes vides', () => {
    expect(prestatairesDuLot([])).toEqual({ prestatairePassif: '', prestataireActif: '' });
  });

  it('plusieurs sociétés sur un périmètre sont toutes citées, sans doublon', () => {
    expect(prestatairesDuLot([a('PASSIVE', 'NETIS'), a('PASSIVE', 'ERT'), a('LES_DEUX', 'NETIS')]).prestatairePassif)
      .toBe('NETIS / ERT');
  });
});
