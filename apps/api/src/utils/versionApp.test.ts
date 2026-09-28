import { Request } from 'express';
import { buildApp, appAuMoins, BUILD_APPAREIL_UNIQUE } from './versionApp';

const req = (version?: string) => ({ headers: version ? { 'x-app-version': version } : {} }) as unknown as Request;

describe('version de l\'APK déclarée par X-App-Version', () => {
  it('lit le numéro de build', () => {
    expect(buildApp(req('1.8.0+48'))).toBe(48);
  });

  it('rend null quand l\'en-tête est absent ou illisible', () => {
    // Les APK anciens (b40, b43) ne déclarent rien : leur silence ne doit
    // jamais se lire comme une version récente.
    expect(buildApp(req())).toBeNull();
    expect(buildApp(req('1.8.0'))).toBeNull();
    expect(buildApp(req('bidon'))).toBeNull();
  });

  it('accepte le premier en-tête quand le client en envoie plusieurs', () => {
    const multiple = { headers: { 'x-app-version': ['1.8.0+48', '1.0.0+1'] } } as unknown as Request;
    expect(buildApp(multiple)).toBe(48);
  });

  it('compare au build demandé', () => {
    expect(appAuMoins(req('1.8.0+48'), 48)).toBe(true);
    expect(appAuMoins(req('1.8.0+49'), 48)).toBe(true);
    expect(appAuMoins(req('1.8.0+47'), 48)).toBe(false);
    expect(appAuMoins(req(), 48)).toBe(false);
  });
});

describe('verrou d\'appareil', () => {
  // GARDE-FOU DE NON-RÉGRESSION : jusqu'à b47 l'app envoyait Build.ID, le
  // numéro du firmware, identique sur tous les téléphones d'un même modèle.
  // Armer le verrou sur ces valeurs refuse la connexion à des techniciens qui
  // n'ont jamais partagé d'appareil. Le seuil ne doit pas redescendre.
  it('reste désarmé pour tout APK antérieur à b48', () => {
    expect(BUILD_APPAREIL_UNIQUE).toBe(48);
    for (const build of ['1.7.0+40', '1.7.0+43', '1.8.0+45', '1.8.0+47']) {
      expect(appAuMoins(req(build), BUILD_APPAREIL_UNIQUE)).toBe(false);
    }
    expect(appAuMoins(req(), BUILD_APPAREIL_UNIQUE)).toBe(false);
  });

  it('s\'arme dès b48', () => {
    expect(appAuMoins(req('1.8.0+48'), BUILD_APPAREIL_UNIQUE)).toBe(true);
  });
});
