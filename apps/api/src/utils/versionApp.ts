import { Request } from 'express';

/**
 * Un `versionCode` Android découpé par architecture porte un DÉCALAGE.
 *
 * `flutter build apk --split-per-abi` ajoute +1000 à l'armeabi-v7a, +2000 à
 * l'arm64-v8a et +4000 à l'x86_64 : le b49 est installé comme 1049 ou 2049, et
 * `PackageInfo.buildNumber` (donc `X-App-Version`) rapporte « 1.8.0+2049 », pas
 * « 1.8.0+49 ». Lu tel quel, TOUT APK découpé passait pour « ≥ 48 » - y compris
 * un b46, qui envoie encore le `Build.ID` partagé par tout un modèle : le
 * verrou d'appareil s'armait sur des identifiants qui ne désignent aucun
 * téléphone, et le second technicien d'un même modèle était refusé.
 *
 * Le numéro de build réel est ce qui reste sous 1000. Conséquence assumée : les
 * builds doivent rester sous 1000 (à un build par semaine, cela laisse des
 * années) ; au-delà, ce décodage devra être revu.
 */
const DECALAGE_ABI = 1000;
const buildReel = (n: number): number => (n >= DECALAGE_ABI ? n % DECALAGE_ABI : n);

/**
 * Numéro de build de l'APK qui parle, tiré de `X-App-Version` (« 1.8.0+48 »),
 * DÉCALAGE PAR ARCHITECTURE RETIRÉ (« 1.8.0+2048 » vaut 48).
 *
 * `null` quand l'en-tête est absent ou illisible : les APK anciens (b40, b43)
 * ne le déclarent pas, et leur silence ne doit jamais se lire comme une
 * version élevée.
 */
export function buildApp(req: Request): number | null {
  const brut = req.headers['x-app-version'];
  const version = String(Array.isArray(brut) ? brut[0] : brut ?? '');
  const build = Number(version.split('+')[1]);
  return Number.isFinite(build) && build >= 0 ? buildReel(build) : null;
}

/**
 * La version à ENREGISTRER et à afficher : « 1.8.0+2049 » devient « 1.8.0+49 ».
 * L'administrateur lit un numéro de build, pas un code interne à l'architecture
 * du téléphone. Un en-tête sans numéro de build est conservé tel quel.
 */
export function versionAffichable(req: Request): string {
  const brut = req.headers['x-app-version'];
  const version = String(Array.isArray(brut) ? brut[0] : brut ?? '').trim().slice(0, 40);
  const [nom, brutBuild] = version.split('+');
  const build = buildApp(req);
  return build !== null && brutBuild !== undefined ? `${nom}+${build}` : version;
}

/** L'APK qui parle est-il au moins ce build ? Un APK muet répond non. */
export function appAuMoins(req: Request, build: number): boolean {
  const vu = buildApp(req);
  return vu !== null && vu >= build;
}

/**
 * Premier build qui envoie un identifiant d'appareil PROPRE À UN TÉLÉPHONE.
 *
 * Jusqu'à b47, l'app envoyait `Build.ID` d'Android - le numéro du firmware,
 * identique sur tous les exemplaires d'un même modèle. Le verrou d'appareil
 * liait donc un modèle : cinq « appareils » regroupaient trente-deux comptes,
 * et le verrou bilatéral (un appareil, un compte) aurait refusé la connexion à
 * une trentaine de techniciens qui n'ont jamais partagé quoi que ce soit.
 *
 * En dessous de ce build, le verrou est donc DÉSARMÉ : ce que l'app envoie ne
 * désigne aucun téléphone, on ne lie rien et on ne refuse personne.
 */
export const BUILD_APPAREIL_UNIQUE = 48;

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * L'identifiant d'appareil désigne-t-il UN téléphone ?
 *
 * Depuis b48 l'app envoie un UUID tiré au sort par exemplaire. Avant, elle
 * envoyait `Build.ID` (« TP1A.220624.014 »), jamais un UUID. Cette forme sert de
 * SECONDE protection, indépendante du numéro de build : elle tient même si le
 * build est mal lu, comme il l'a été à cause du décalage par architecture. Un
 * identifiant qui n'est pas un UUID ne lie rien et ne refuse personne.
 */
export const estIdentifiantTelephone = (id: string): boolean => UUID_V4.test(id);
