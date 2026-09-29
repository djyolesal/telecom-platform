import { deciderCloture, facteurDeclare, PolitiqueCloture } from './verificationCloture';

const SOUPLE: PolitiqueCloture = { appSaitVerifier: true, exigeVerification: true, exigeBiometrie: false };
const STRICT: PolitiqueCloture = { appSaitVerifier: true, exigeVerification: true, exigeBiometrie: true };
const VIEIL_APK: PolitiqueCloture = { appSaitVerifier: false, exigeVerification: true, exigeBiometrie: false };

describe('facteurDeclare - on ne crédite jamais ce qui n’est pas dit', () => {
  it('retient le facteur annoncé', () => {
    expect(facteurDeclare({ verificationFacteur: 'BIOMETRIE' })).toBe('BIOMETRIE');
    expect(facteurDeclare({ verificationFacteur: 'ECHEC' })).toBe('ECHEC');
  });

  it('un APK muet qui dit avoir vérifié ne passe pas pour de la biométrie', () => {
    expect(facteurDeclare({ verificationLocale: true })).toBe('CODE');
  });

  it('rien du tout = AUCUN, et un facteur inventé n’est pas retenu', () => {
    expect(facteurDeclare({})).toBe('AUCUN');
    expect(facteurDeclare({ verificationFacteur: 'MAGIE' })).toBe('AUCUN');
  });
});

describe('deciderCloture - politique souple (état actuel : on collecte les chiffres)', () => {
  it('empreinte : clôture vérifiée', () => {
    expect(deciderCloture({ verificationLocale: true, verificationFacteur: 'BIOMETRIE' }, SOUPLE))
      .toEqual({ autorisee: true, facteur: 'BIOMETRIE', verifiee: true });
  });

  it('code de l’appareil : accepté, mais enregistré comme tel', () => {
    expect(deciderCloture({ verificationLocale: true, verificationFacteur: 'CODE' }, SOUPLE))
      .toEqual({ autorisee: true, facteur: 'CODE', verifiee: true });
  });

  it('appareil sans verrou, déclaré : accepté, non vérifié', () => {
    expect(deciderCloture({ verificationIndisponible: true, verificationFacteur: 'AUCUN' }, SOUPLE))
      .toEqual({ autorisee: true, facteur: 'AUCUN', verifiee: false });
  });

  it('ÉCHEC DÉCLARÉ : accepté, non vérifié - le technicien n’est plus enfermé', () => {
    // C'est le cas qui a bloqué quelqu'un sur un site, photos et signature
    // déjà faites. Il doit rester passant tant que le mode strict est à 0.
    expect(deciderCloture({ verificationEchec: true, verificationFacteur: 'ECHEC' }, SOUPLE))
      .toEqual({ autorisee: true, facteur: 'ECHEC', verifiee: false });
  });

  it('rien déclaré du tout : refusé - sinon la règle serait décorative', () => {
    expect(deciderCloture({ verificationLocale: false }, SOUPLE))
      .toEqual({ autorisee: false, facteur: 'AUCUN', motif: 'VERIFICATION_REQUISE' });
  });

  it('APK antérieur à b47 : rien ne lui est demandé', () => {
    expect(deciderCloture({}, VIEIL_APK)).toEqual({ autorisee: true, facteur: 'AUCUN', verifiee: false });
  });

  it('exigence levée par réglage : tout passe', () => {
    const sansExigence = { ...SOUPLE, exigeVerification: false };
    expect(deciderCloture({}, sansExigence).autorisee).toBe(true);
  });
});

describe('deciderCloture - mode strict : il doit être strict pour de bon', () => {
  it('seule la biométrie passe', () => {
    expect(deciderCloture({ verificationLocale: true, verificationFacteur: 'BIOMETRIE' }, STRICT).autorisee).toBe(true);
  });

  it('le code ne suffit plus', () => {
    expect(deciderCloture({ verificationLocale: true, verificationFacteur: 'CODE' }, STRICT))
      .toEqual({ autorisee: false, facteur: 'CODE', motif: 'BIOMETRIE_REQUISE' });
  });

  it('l’échec déclaré ne contourne PAS le mode strict', () => {
    // Le repli qui débloque le terrain ne doit pas devenir la porte de sortie
    // universelle : en mode strict, il est refusé comme le reste.
    expect(deciderCloture({ verificationEchec: true, verificationFacteur: 'ECHEC' }, STRICT))
      .toEqual({ autorisee: false, facteur: 'ECHEC', motif: 'BIOMETRIE_REQUISE' });
  });

  it('un appareil sans verrou ne contourne pas non plus le mode strict', () => {
    expect(deciderCloture({ verificationIndisponible: true, verificationFacteur: 'AUCUN' }, STRICT))
      .toEqual({ autorisee: false, facteur: 'AUCUN', motif: 'BIOMETRIE_REQUISE' });
  });
});
