import fs from 'fs';
import path from 'path';
import bcrypt from 'bcrypt';
import { prisma } from '../config/database';
import { AppError } from '../utils/AppError';

/**
 * Console d'administration de la base — métadonnées.
 *
 * Le catalogue des tables N'EST PAS écrit à la main : il est dérivé de
 * `prisma/schema.prisma` au premier appel. Toute évolution du modèle (nouveau
 * champ, nouvelle table, nouvel enum) apparaît donc automatiquement dans la
 * console, sans code à maintenir en double — et sans risque d'écart entre ce
 * que la console propose et ce que la base accepte réellement.
 *
 * Le DMMF exposé par `@prisma/client` (Prisma 7) est volontairement allégé au
 * runtime : il ne porte plus ni l'obligation des champs, ni les valeurs
 * d'enum, ni les relations. D'où cette lecture directe du schéma, présent dans
 * l'image Docker (`COPY prisma ./prisma/`).
 */

const SCALAIRES = new Set(['String', 'Int', 'BigInt', 'Float', 'Decimal', 'Boolean', 'DateTime', 'Json']);

export type KindChamp = 'scalar' | 'enum' | 'relation';

export interface ChampDb {
  nom: string;
  /** String, Int, DateTime… ou le nom de l'enum / du modèle cible. */
  type: string;
  kind: KindChamp;
  liste: boolean;
  obligatoire: boolean;
  estId: boolean;
  unique: boolean;
  defaut?: string;
  autoUpdate: boolean;
  /** Nom de la colonne SQL (@map) quand il diffère du champ Prisma. */
  colonne?: string;
  /** @db.VarChar(n) → longueur maximale acceptée. */
  longueurMax?: number;
  /** Commentaire de fin de ligne du schéma — sert d'aide à la saisie. */
  aide?: string;
  /** Champ scalaire porteur d'une clé étrangère → modèle visé (sélecteur). */
  fkVers?: string;
  /** Relation (kind = relation) : modèle cible et champs porteurs. */
  cible?: string;
  porteurs?: string[];
  /**
   * Ce que devient CETTE ligne quand la ligne visée est supprimée
   * (Cascade = supprimée avec elle, SetNull = déliée, Restrict = bloque).
   * Défauts Prisma : Restrict si la relation est obligatoire, SetNull sinon.
   */
  surSuppression?: 'Cascade' | 'SetNull' | 'Restrict' | 'NoAction' | 'SetDefault';
  /** Modifiable depuis la console. */
  modifiable: boolean;
  /** Renseignable à la création (un id auto-généré ne l'est pas). */
  creable: boolean;
  /** Jamais renvoyé au client (empreinte de mot de passe). */
  secret: boolean;
}

export interface ModeleDb {
  nom: string;
  table: string;
  libelle: string;
  groupe: string;
  champs: ChampDb[];
  idChamp: string;
  /** Champs utilisés pour construire le libellé lisible d'une ligne. */
  champsLibelle: string[];
  /** true = consultation seule (journal d'audit : preuve, non éditable). */
  lectureSeule: boolean;
}

interface Catalogue {
  modeles: Map<string, ModeleDb>;
  enums: Map<string, string[]>;
}

// ── Habillage métier ─────────────────────────────────────────
// Le schéma donne la structure ; ces tables donnent le vocabulaire du métier
// (le portail est en français) et le rangement par domaine.
const LIBELLES: Record<string, string> = {
  User: 'Utilisateurs',
  Site: 'Sites',
  GroupeElectrogene: 'Groupes électrogènes',
  EquipementActif: 'Équipements actifs',
  Maintenance: 'Maintenances',
  PieceRechange: 'Pièces de rechange',
  Photo: 'Photos',
  Depotage: 'Dépotages',
  DepotageHeureGE: 'Heures GE au dépotage',
  ReleveEnergie: 'Relevés d’énergie',
  Incident: 'Incidents',
  AuditLog: 'Journal d’audit',
  TypePyloneRef: 'Types de pylône',
  SystemSettings: 'Paramètres système',
  TachePreventiveOverride: 'Tâches préventives (surcharges)',
  Notification: 'Notifications',
  Prestataire: 'Prestataires',
  Contact: 'Contacts SMS',
  SmsLog: 'Journal SMS',
  Lot: 'Lots de maintenance',
  LotAssignment: 'Attributions de lots',
  MouvementCarburant: 'Mouvements carburant',
  Vehicule: 'Véhicules',
  Chauffeur: 'Chauffeurs',
  BonCommande: 'Bons de commande',
  VolumeMensuel: 'Volumes mensuels',
  BonLivraison: 'Bons de livraison',
  LigneLivraison: 'Lignes de livraison',
  CoupureReseau: 'Coupures réseau',
};

const GROUPES: Record<string, string> = {
  User: 'acces',
  Site: 'referentiel',
  Prestataire: 'referentiel',
  Contact: 'referentiel',
  Lot: 'referentiel',
  LotAssignment: 'referentiel',
  TypePyloneRef: 'referentiel',
  Vehicule: 'referentiel',
  Chauffeur: 'referentiel',
  GroupeElectrogene: 'parc',
  EquipementActif: 'parc',
  Maintenance: 'exploitation',
  PieceRechange: 'exploitation',
  Photo: 'exploitation',
  Incident: 'exploitation',
  ReleveEnergie: 'exploitation',
  CoupureReseau: 'exploitation',
  Depotage: 'carburant',
  DepotageHeureGE: 'carburant',
  MouvementCarburant: 'carburant',
  BonCommande: 'carburant',
  BonLivraison: 'carburant',
  LigneLivraison: 'carburant',
  VolumeMensuel: 'carburant',
  AuditLog: 'systeme',
  SystemSettings: 'systeme',
  TachePreventiveOverride: 'systeme',
  Notification: 'systeme',
  SmsLog: 'systeme',
};

export const LIBELLES_GROUPES: Array<{ cle: string; libelle: string }> = [
  { cle: 'referentiel', libelle: 'Référentiel' },
  { cle: 'parc', libelle: 'Parc technique' },
  { cle: 'exploitation', libelle: 'Exploitation' },
  { cle: 'carburant', libelle: 'Carburant' },
  { cle: 'acces', libelle: 'Accès' },
  { cle: 'systeme', libelle: 'Système' },
];

/**
 * Le journal d'audit est une PREUVE : la console le montre mais ne le touche
 * pas. Une console capable de réécrire l'audit ne prouve plus rien.
 */
const LECTURE_SEULE = new Set(['AuditLog']);

/** Empreintes et jetons : jamais renvoyés au navigateur. */
const SECRETS = new Set(['User.passwordHash']);

/** Champs pilotés par l'application : afficher, mais ne pas laisser modifier. */
const NON_MODIFIABLES = new Set(['createdAt', 'updatedAt']);

/** Candidats au libellé lisible d'une ligne, par ordre de préférence. */
const CANDIDATS_LIBELLE = ['nom', 'libelle', 'reference', 'numero', 'numeroBL', 'code', 'titre', 'title', 'email', 'key', 'message'];

/**
 * Libellé d'une table qui n'a aucun des champs candidats (tables de liaison,
 * lignes de détail) : le premier texte propre à la ligne vaut mieux qu'un uuid
 * tronqué dans un sélecteur de clé étrangère.
 */
function libelleDeRepli(champs: ChampDb[]): string[] {
  const repli = champs.find((c) => c.kind === 'scalar' && c.type === 'String' && !c.estId && !c.fkVers && !c.secret);
  return repli ? [repli.nom] : [];
}

// ── Lecture du schéma ────────────────────────────────────────

function localiserSchema(): string {
  const candidats = [
    // dist/services → /app/prisma (image Docker) ; src/services → apps/api/prisma (dev)
    path.join(__dirname, '..', '..', 'prisma', 'schema.prisma'),
    path.join(process.cwd(), 'prisma', 'schema.prisma'),
  ];
  const trouve = candidats.find((p) => fs.existsSync(p));
  if (!trouve) throw new AppError('Schéma Prisma introuvable : console base de données indisponible', 500);
  return trouve;
}

/** `champ Type[]? @attr…  // commentaire` → parties exploitables. */
const RE_CHAMP = /^(\w+)\s+(\w+)(\[\])?(\?)?\s*(.*)$/;

function parserSchema(): Catalogue {
  const source = fs.readFileSync(localiserSchema(), 'utf8');
  const modeles = new Map<string, ModeleDb>();
  const enums = new Map<string, string[]>();

  let bloc: { type: 'model' | 'enum'; nom: string } | null = null;
  let champs: ChampDb[] = [];
  let valeurs: string[] = [];
  let table = '';

  for (const brute of source.split('\n')) {
    const ligne = brute.trim();
    if (!bloc) {
      const m = /^(model|enum)\s+(\w+)\s*\{/.exec(ligne);
      if (m) {
        bloc = { type: m[1] as 'model' | 'enum', nom: m[2] };
        champs = [];
        valeurs = [];
        table = m[2];
      }
      continue;
    }

    if (ligne === '}') {
      if (bloc.type === 'enum') enums.set(bloc.nom, valeurs);
      else {
        const idChamp = champs.find((c) => c.estId)?.nom ?? 'id';
        modeles.set(bloc.nom, {
          nom: bloc.nom,
          table,
          libelle: LIBELLES[bloc.nom] ?? bloc.nom,
          groupe: GROUPES[bloc.nom] ?? 'systeme',
          champs,
          idChamp,
          champsLibelle: CANDIDATS_LIBELLE.filter((c) => champs.some((f) => f.nom === c && f.kind !== 'relation')).slice(0, 2),
          // (complété au 2ᵉ passage : le repli a besoin des clés étrangères résolues)
          lectureSeule: LECTURE_SEULE.has(bloc.nom),
        });
      }
      bloc = null;
      continue;
    }

    // Commentaire de fin de ligne : retenu comme aide à la saisie.
    const commentaire = /\/\/\s?(.*)$/.exec(ligne);
    const corps = ligne.replace(/\s*\/\/.*$/, '').trim();
    if (!corps) continue;

    if (bloc.type === 'enum') {
      if (/^\w+$/.test(corps)) valeurs.push(corps);
      continue;
    }

    if (corps.startsWith('@@')) {
      const m = /^@@map\("([^"]+)"\)/.exec(corps);
      if (m) table = m[1];
      continue;
    }

    const m = RE_CHAMP.exec(corps);
    if (!m) continue;
    const [, nom, type, liste, optionnel, attrs = ''] = m;

    const estId = /@id\b/.test(attrs);
    const defaut = /@default\((.+?)\)(?=\s|$)/.exec(attrs)?.[1];
    const relation = /@relation\(([^)]*)\)/.exec(attrs)?.[1];
    const porteurs = relation ? /fields:\s*\[([^\]]*)\]/.exec(relation)?.[1].split(',').map((x) => x.trim()).filter(Boolean) : undefined;
    const onDelete = relation ? /onDelete:\s*(\w+)/.exec(relation)?.[1] : undefined;
    const kind: KindChamp = SCALAIRES.has(type) ? 'scalar' : 'relation'; // enums résolus au 2ᵉ passage
    const auto = /@updatedAt/.test(attrs);

    champs.push({
      nom,
      type,
      kind,
      liste: !!liste,
      obligatoire: !optionnel && !liste,
      estId,
      unique: /@unique/.test(attrs),
      defaut,
      autoUpdate: auto,
      colonne: /@map\("([^"]+)"\)/.exec(attrs)?.[1],
      longueurMax: Number(/@db\.VarChar\((\d+)\)/.exec(attrs)?.[1]) || undefined,
      aide: commentaire?.[1]?.trim() || undefined,
      cible: SCALAIRES.has(type) ? undefined : type,
      porteurs,
      surSuppression: (onDelete as ChampDb['surSuppression']) ?? (relation ? (optionnel ? 'SetNull' : 'Restrict') : undefined),
      modifiable: false, // fixé au 2ᵉ passage
      creable: false,
      secret: SECRETS.has(`${bloc.nom}.${nom}`),
    });
  }

  // 2ᵉ passage : enums, clés étrangères et droits d'écriture.
  for (const modele of modeles.values()) {
    for (const champ of modele.champs) {
      if (champ.kind === 'relation' && enums.has(champ.type)) {
        champ.kind = 'enum';
        champ.cible = undefined;
      }
      // Le champ scalaire porteur d'une FK apprend le modèle qu'il vise :
      // la console offre alors un sélecteur au lieu d'un uuid à recopier.
      if (champ.kind === 'relation' && champ.porteurs?.length) {
        for (const porteur of champ.porteurs) {
          const scalaire = modele.champs.find((c) => c.nom === porteur);
          if (!scalaire) continue;
          scalaire.fkVers = champ.type;
          scalaire.surSuppression = champ.surSuppression;
        }
      }
    }
    if (!modele.champsLibelle.length) modele.champsLibelle = libelleDeRepli(modele.champs);
    for (const champ of modele.champs) {
      const editableParNature =
        champ.kind !== 'relation' &&
        !champ.liste &&
        !champ.autoUpdate &&
        !NON_MODIFIABLES.has(champ.nom) &&
        !modele.lectureSeule;
      champ.modifiable = editableParNature && !champ.estId;
      // Un id sans @default (code, clé) doit être saisi ; un uuid auto ne l'est jamais.
      champ.creable = editableParNature && (!champ.estId || !champ.defaut);
    }
  }

  return { modeles, enums };
}

let cache: Catalogue | null = null;

export function catalogue(): Catalogue {
  if (!cache) cache = parserSchema();
  return cache;
}

/** Réinitialise le cache (tests). */
export function reinitialiserCatalogue(): void {
  cache = null;
}

export function modeleOuErreur(nom: string): ModeleDb {
  const modele = catalogue().modeles.get(nom);
  // Liste blanche stricte : seul un nom du schéma atteint un delegate Prisma.
  if (!modele) throw new AppError(`Table inconnue : ${nom}`, 404);
  return modele;
}

export function valeursEnum(nom: string): string[] {
  return catalogue().enums.get(nom) ?? [];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Delegate = any;

/** Delegate Prisma d'un modèle (`GroupeElectrogene` → `prisma.groupeElectrogene`). */
export function delegate(modele: ModeleDb): Delegate {
  const cle = modele.nom.charAt(0).toLowerCase() + modele.nom.slice(1);
  const d = (prisma as unknown as Record<string, Delegate>)[cle];
  if (!d?.findMany) throw new AppError(`Table non exposée : ${modele.nom}`, 500);
  return d;
}

/** Champs renvoyés en lecture : tout sauf les relations, les listes et les secrets. */
export function champsLisibles(modele: ModeleDb): ChampDb[] {
  return modele.champs.filter((c) => c.kind !== 'relation' && !c.liste && !c.secret);
}

export function selectionLecture(modele: ModeleDb): Record<string, boolean> {
  const select: Record<string, boolean> = {};
  for (const champ of champsLisibles(modele)) select[champ.nom] = true;
  return select;
}

/** Libellé lisible d'une ligne (« Lomé-Centre », « BC-2026-0012 »… sinon l'id). */
export function libelleLigne(modele: ModeleDb, ligne: Record<string, unknown>): string {
  const parts = modele.champsLibelle.map((c) => ligne[c]).filter((v) => v != null && v !== '');
  if (parts.length) return parts.map(String).join(' — ');
  return String(ligne[modele.idChamp] ?? '').slice(0, 8);
}

// ── Conversion des valeurs saisies ───────────────────────────

/**
 * Convertit une valeur JSON reçue du navigateur vers le type attendu par
 * Prisma, et REFUSE tout ce qui ne correspond pas : la console est la dernière
 * barrière avant l'écriture en base, il n'y a pas de schéma Zod par table.
 */
export async function convertir(modele: ModeleDb, champ: ChampDb, valeur: unknown): Promise<unknown> {
  const vide = valeur === null || valeur === undefined || valeur === '';
  if (vide) {
    if (champ.obligatoire) throw new AppError(`Le champ « ${champ.nom} » est obligatoire`, 422);
    return null;
  }

  if (champ.kind === 'enum') {
    const valeursOk = valeursEnum(champ.type);
    if (!valeursOk.includes(String(valeur))) {
      throw new AppError(`Valeur invalide pour « ${champ.nom} » : ${valeur} (attendu : ${valeursOk.join(', ')})`, 422);
    }
    return String(valeur);
  }

  switch (champ.type) {
    case 'String': {
      const s = String(valeur);
      if (champ.longueurMax && s.length > champ.longueurMax) {
        throw new AppError(`« ${champ.nom} » dépasse ${champ.longueurMax} caractères`, 422);
      }
      // Mot de passe : la console reçoit le mot de passe EN CLAIR et n'écrit
      // jamais que son empreinte (même coût que l'inscription).
      return champ.secret ? bcrypt.hash(s, 10) : s;
    }
    case 'Int':
    case 'BigInt': {
      const n = Number(valeur);
      if (!Number.isInteger(n)) throw new AppError(`« ${champ.nom} » attend un entier`, 422);
      return champ.type === 'BigInt' ? BigInt(n) : n;
    }
    case 'Float': {
      const n = Number(valeur);
      if (!Number.isFinite(n)) throw new AppError(`« ${champ.nom} » attend un nombre`, 422);
      return n;
    }
    case 'Decimal': {
      const n = Number(valeur);
      if (!Number.isFinite(n)) throw new AppError(`« ${champ.nom} » attend un nombre`, 422);
      return String(valeur); // Prisma accepte la chaîne : aucune perte de précision
    }
    case 'Boolean': {
      if (typeof valeur === 'boolean') return valeur;
      if (valeur === 'true' || valeur === 'false') return valeur === 'true';
      throw new AppError(`« ${champ.nom} » attend vrai ou faux`, 422);
    }
    case 'DateTime': {
      const d = new Date(String(valeur));
      if (Number.isNaN(d.getTime())) throw new AppError(`« ${champ.nom} » attend une date valide`, 422);
      return d;
    }
    case 'Json': {
      if (typeof valeur !== 'string') return valeur;
      try { return JSON.parse(valeur); } catch { throw new AppError(`« ${champ.nom} » attend du JSON valide`, 422); }
    }
    default:
      throw new AppError(`Type non pris en charge : ${champ.type} (${modele.nom}.${champ.nom})`, 400);
  }
}

/**
 * Compose le `data` d'un create/update à partir du corps de la requête.
 * Seuls les champs présents dans le corps ET autorisés sont retenus — un champ
 * inconnu ou verrouillé est ignoré silencieusement plutôt que de faire échouer
 * l'enregistrement complet.
 */
export async function construireData(
  modele: ModeleDb,
  corps: Record<string, unknown>,
  mode: 'create' | 'update'
): Promise<Record<string, unknown>> {
  if (modele.lectureSeule) throw new AppError(`« ${modele.libelle} » est en consultation seule`, 403);

  const data: Record<string, unknown> = {};
  for (const champ of modele.champs) {
    const autorise = mode === 'create' ? champ.creable : champ.modifiable;
    if (!autorise || !(champ.nom in corps)) continue;
    const valeur = corps[champ.nom];
    // Un secret laissé vide en modification = « ne pas changer ».
    if (champ.secret && (valeur === null || valeur === undefined || valeur === '')) continue;
    data[champ.nom] = await convertir(modele, champ, valeur);
  }

  if (mode === 'create') {
    for (const champ of modele.champs) {
      const manquant = champ.obligatoire && !champ.defaut && champ.creable && !(champ.nom in data);
      if (manquant) throw new AppError(`Le champ « ${champ.nom} » est obligatoire`, 422);
    }
  }
  if (!Object.keys(data).length) throw new AppError('Aucun champ modifiable fourni', 422);
  return data;
}

/** Sérialise les types non-JSON (Decimal, BigInt, Date) pour le navigateur. */
export function serialiser(valeur: unknown): unknown {
  if (valeur === null || valeur === undefined) return null;
  if (typeof valeur === 'bigint') return valeur.toString();
  if (valeur instanceof Date) return valeur.toISOString();
  // Prisma.Decimal expose toString() ; on renvoie une chaîne numérique.
  if (typeof valeur === 'object' && valeur !== null && 'toFixed' in (valeur as object)) return String(valeur);
  return valeur;
}

export function serialiserLigne(ligne: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(ligne)) out[k] = serialiser(v);
  return out;
}

// ── Impact d'une suppression ─────────────────────────────────

export interface ImpactSuppression {
  modele: string;
  libelle: string;
  champ: string;
  action: string;
  lignes: number;
}

/**
 * Ce qu'emporte la suppression d'une ligne : les tables qui la référencent, le
 * nombre de lignes concernées et le sort qui les attend (`Cascade` = supprimées
 * avec elle, `SetNull` = déliées, `Restrict` = la suppression sera refusée).
 *
 * Sans cet inventaire, supprimer une maintenance effacerait silencieusement ses
 * pièces de rechange, et supprimer un bon de livraison ses lignes : la console
 * doit l'annoncer AVANT, pas le constater après.
 */
export async function impactSuppression(modele: ModeleDb, id: string): Promise<ImpactSuppression[]> {
  const impacts: ImpactSuppression[] = [];

  await Promise.all(
    [...catalogue().modeles.values()].flatMap((source) =>
      source.champs
        .filter((c) => c.fkVers === modele.nom && !c.liste)
        .map(async (champ) => {
          const lignes = await delegate(source).count({ where: { [champ.nom]: id } }).catch(() => 0);
          if (!lignes) return;
          impacts.push({
            modele: source.nom,
            libelle: source.libelle,
            champ: champ.nom,
            action: champ.surSuppression ?? 'Restrict',
            lignes,
          });
        })
    )
  );

  // Les suppressions en chaîne d'abord : c'est ce qui doit sauter aux yeux.
  const poids = (a: ImpactSuppression) => (a.action === 'Cascade' ? 0 : a.action === 'SetNull' ? 1 : 2);
  return impacts.sort((a, b) => poids(a) - poids(b) || b.lignes - a.lignes);
}
