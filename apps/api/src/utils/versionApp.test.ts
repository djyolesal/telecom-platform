import { Request } from 'express';
import { buildApp, appAuMoins, versionAffichable, estIdentifiantTelephone, BUILD_APPAREIL_UNIQUE } from './versionApp';

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

describe('décalage du versionCode par architecture', () => {
  // `flutter build apk --split-per-abi` : +1000 armeabi-v7a, +2000 arm64-v8a,
  // +4000 x86_64. PackageInfo rapporte le versionCode INSTALLÉ, décalage compris.
  it('retire le décalage : « +2049 » est le build 49', () => {
    expect(buildApp(req('1.8.0+1049'))).toBe(49);
    expect(buildApp(req('1.8.0+2049'))).toBe(49);
    expect(buildApp(req('1.8.0+4049'))).toBe(49);
    expect(buildApp(req('1.8.0+49'))).toBe(49);
  });

  // LE DÉFAUT CORRIGÉ : un b46 arm64 rapportait 2046, lu « ≥ 48 », et armait le
  // verrou sur le Build.ID partagé par tout un modèle de téléphone.
  it('un APK ancien découpé par architecture reste désarmé', () => {
    for (const v of ['1.8.0+1046', '1.8.0+2046', '1.8.0+2047', '1.8.0+4047', '1.7.0+2043']) {
      expect(appAuMoins(req(v), BUILD_APPAREIL_UNIQUE)).toBe(false);
    }
  });

  it('un APK récent découpé par architecture arme le verrou', () => {
    for (const v of ['1.8.0+1048', '1.8.0+2048', '1.8.0+2049', '1.8.0+4049']) {
      expect(appAuMoins(req(v), BUILD_APPAREIL_UNIQUE)).toBe(true);
    }
  });

  it('la porte de vérification d’identité (b47) se lit de la même façon', () => {
    expect(appAuMoins(req('1.8.0+2046'), 47)).toBe(false);
    expect(appAuMoins(req('1.8.0+2047'), 47)).toBe(true);
  });

  it('affiche le build réel, pas le code d’architecture', () => {
    expect(versionAffichable(req('1.8.0+2049'))).toBe('1.8.0+49');
    expect(versionAffichable(req('1.8.0+1046'))).toBe('1.8.0+46');
    expect(versionAffichable(req('1.8.0+49'))).toBe('1.8.0+49');
    expect(versionAffichable(req('1.8.0'))).toBe('1.8.0');
    expect(versionAffichable(req())).toBe('');
  });
});

describe('forme d’un identifiant d’appareil', () => {
  // Seconde protection, indépendante du numéro de build.
  it('reconnaît l’UUID tiré par l’app depuis b48', () => {
    expect(estIdentifiantTelephone('3f2504e0-4f89-41d3-9a0c-0305e82c3301')).toBe(true);
    expect(estIdentifiantTelephone('3F2504E0-4F89-41D3-9A0C-0305E82C3301')).toBe(true);
  });

  it('refuse le Build.ID des anciens APK et tout identifiant sans forme d’UUID', () => {
    for (const id of ['TP1A.220624.014', 'SP1A.210812.016', '', 'abc', '3f2504e0-4f89-41d3-9a0c', 'x'.repeat(36)]) {
      expect(estIdentifiantTelephone(id)).toBe(false);
    }
  });
});
