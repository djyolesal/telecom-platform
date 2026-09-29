/**
 * QUI PEUT CLÔTURER, ET COMMENT L'IDENTITÉ A ÉTÉ PROUVÉE.
 *
 * Cette règle a enfermé un technicien sur un site : photos prises, signature
 * apposée, et aucun moyen de clôturer. Elle est donc sortie du contrôleur pour
 * être testée seule - une décision d'accès ne doit pas vivre uniquement dans
 * une fonction de 300 lignes qu'aucun test n'exerce.
 *
 * Quatre facteurs, qui ne veulent pas dire la même chose :
 *   BIOMETRIE  empreinte ou visage - ne se prête pas ;
 *   CODE       schéma ou PIN de l'appareil - se prête aussi bien que le téléphone ;
 *   AUCUN      l'appareil n'a pas de verrou d'écran, il le déclare ;
 *   ECHEC      la vérification a été TENTÉE et n'a pas abouti, le technicien
 *              l'assume pour pouvoir clôturer.
 *
 * AUCUN et ECHEC se comptent séparément : « cet appareil ne sait pas » n'est
 * pas « ça n'a pas marché ». C'est cette distinction qui dira s'il faut durcir.
 */

export type FacteurVerification = 'BIOMETRIE' | 'CODE' | 'AUCUN' | 'ECHEC';

export const FACTEURS: FacteurVerification[] = ['BIOMETRIE', 'CODE', 'AUCUN', 'ECHEC'];

export interface DeclarationCloture {
  verificationLocale?: boolean;
  verificationIndisponible?: boolean;
  verificationEchec?: boolean;
  verificationFacteur?: string;
}

export interface PolitiqueCloture {
  /** L'APK qui parle sait-il vérifier localement (b47+) ? */
  appSaitVerifier: boolean;
  /** `maintenance.verificationLocaleCloture` : 1 = vérification exigée. */
  exigeVerification: boolean;
  /** `maintenance.biometrieStricteCloture` : 1 = le code ne suffit plus. */
  exigeBiometrie: boolean;
}

export type DecisionCloture =
  | { autorisee: true; facteur: FacteurVerification; verifiee: boolean }
  | { autorisee: false; facteur: FacteurVerification; motif: 'VERIFICATION_REQUISE' | 'BIOMETRIE_REQUISE' };

/** Le facteur réellement déclaré, sans jamais présumer la biométrie. */
export function facteurDeclare(d: DeclarationCloture): FacteurVerification {
  const brut = String(d.verificationFacteur);
  if ((FACTEURS as string[]).includes(brut)) return brut as FacteurVerification;
  // APK qui ne déclare rien : s'il dit avoir vérifié, on retient CODE (le plus
  // faible des deux), jamais BIOMETRIE - on ne crédite pas ce qui n'est pas dit.
  return d.verificationLocale === true ? 'CODE' : 'AUCUN';
}

export function deciderCloture(d: DeclarationCloture, p: PolitiqueCloture): DecisionCloture {
  const facteur = facteurDeclare(d);
  const verifiee = d.verificationLocale === true;

  // Un APK antérieur ne sait pas vérifier : rien ne lui est demandé, sinon on
  // bloquerait tout le terrain sans qu'il ait le moyen de s'y conformer.
  if (!p.appSaitVerifier) return { autorisee: true, facteur, verifiee };

  if (p.exigeVerification && !verifiee
      && d.verificationIndisponible !== true
      && d.verificationEchec !== true) {
    return { autorisee: false, facteur, motif: 'VERIFICATION_REQUISE' };
  }

  // MODE STRICT : seule l'empreinte ou le visage passent. Il ne se contourne
  // ni par « appareil sans verrou », ni par « la vérification a échoué » -
  // sinon il ne serait strict que de nom.
  if (p.exigeBiometrie && facteur !== 'BIOMETRIE') {
    return { autorisee: false, facteur, motif: 'BIOMETRIE_REQUISE' };
  }

  return { autorisee: true, facteur, verifiee };
}
