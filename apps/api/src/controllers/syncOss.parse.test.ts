import { parserSortieOss, variantesNom } from './syncOss.controller';

// Extrait réel (anonymisé) de la sortie de la commande d'état des eNodeB.
const EXTRAIT = `
ps Class           Identifiers                  | name               ens           date                 eqp   sctpInst  aid   no    egnc
-----------------------------------------------------------------------------------------------------------------------------------------
A  global_enodeb   -geni  615-03-Macro-2848     | GLTOKOI            connected     2026-07-02,10:54:56  1.21  6         2249  6     no
A  global_enodeb   -geni  615-03-Macro-3207     | LWARKA             disconnected  2026-08-12,06:45:21  0.0   NULL      NULL  NULL  no
A  global_enodeb   -geni  615-03-Macro-41523    | undefined          disconnected  2026-08-11,16:26:12  0.0   NULL      NULL  NULL  no
A  global_enodeb   -geni  615-03-Macro-34511    | undefined          connected     2026-08-06,05:09:02  1.3   1         7617  6     no
ligne de bruit qui ne matche pas
`;

describe('parserSortieOss', () => {
  it('extrait nodeId, name, état et horodatage de chaque ligne eNodeB', () => {
    const lignes = parserSortieOss(EXTRAIT);
    expect(lignes).toHaveLength(4);
    expect(lignes[0]).toMatchObject({ nodeId: '2848', name: 'GLTOKOI', etat: 'connected' });
    expect(lignes[0].quand.toISOString()).toBe('2026-07-02T10:54:56.000Z');
  });

  it('repère les disconnected avec leur heure de coupure', () => {
    const down = parserSortieOss(EXTRAIT).filter((l) => l.etat === 'disconnected');
    expect(down.map((l) => l.nodeId)).toEqual(['3207', '41523']);
    expect(down[0].quand.toISOString()).toBe('2026-08-12T06:45:21.000Z');
  });

  it('ignore les en-têtes et le bruit sans lever', () => {
    expect(parserSortieOss('rien de valable\n---\n')).toEqual([]);
  });
});

/**
 * Rapprochement du NOM OSS (incident du 15/09/2026, site GAME) : la plateforme
 * affichait « site entier » coupé depuis 1 h 33 alors que l'OSS listait
 * « LGAME connected ». Le déprefixage `^GL?` n'enlevait que « G » ou « GL », si
 * bien qu'un nom en « L » seul — forme courante du flux réel, déjà présente
 * dans l'échantillon ci-dessus avec LWARKA — n'était jamais rapproché : jamais
 * détecté en panne, et jamais clôturé si le site avait été mappé par ailleurs.
 */
describe('variantesNom - rapprochement du nom OSS', () => {
  it('retire le préfixe « L » SEUL (le cas qui a produit la coupure fantôme)', () => {
    expect(variantesNom('LGAME')).toContain('GAME');
    expect(variantesNom('LWARKA')).toContain('WARKA');
  });

  it('retire toujours le préfixe « GL »', () => {
    expect(variantesNom('GLTOKOI')).toContain('TOKOI');
  });

  it('propose le nom EXACT en premier : un site vraiment nommé « LGAME » gagne', () => {
    expect(variantesNom('LGAME')[0]).toBe('LGAME');
    expect(variantesNom('GLTOKOI')[0]).toBe('GLTOKOI');
  });

  it('normalise casse, espaces et tirets', () => {
    expect(variantesNom('l game')).toContain('GAME');
    expect(variantesNom('GL-TOKOI')).toContain('TOKOI');
  });

  it('ne réduit jamais un nom à du vide', () => {
    for (const n of ['L', 'G', 'GL', '']) {
      expect(variantesNom(n).every((v) => v === '' || v.length > 0)).toBe(true);
      expect(variantesNom(n).filter((v) => v === '').length).toBeLessThanOrEqual(1);
    }
  });
});
