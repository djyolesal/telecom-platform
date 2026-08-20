import { fmtDateTime } from '@/lib/utils';

/**
 * Types partagés de la console base de données. Ils reflètent le catalogue
 * dérivé de schema.prisma côté API (services/dbAdmin.service.ts) : la console
 * ne connaît AUCUNE table en dur, elle se construit à partir de ces métadonnées.
 */

export interface ChampMeta {
  nom: string;
  /** String, Int, DateTime, Decimal, Json… ou le nom de l'enum. */
  type: string;
  kind: 'scalar' | 'enum' | 'relation';
  obligatoire: boolean;
  estId: boolean;
  unique: boolean;
  defaut: string | null;
  colonne: string | null;
  longueurMax: number | null;
  aide: string | null;
  /** Clé étrangère : modèle visé (sélecteur au lieu d'un uuid à recopier). */
  fkVers: string | null;
  modifiable: boolean;
  creable: boolean;
  secret: boolean;
}

export interface TableMeta {
  modele: string;
  table: string;
  libelle: string;
  groupe: string;
  idChamp: string;
  lectureSeule: boolean;
  enums: Record<string, string[]>;
  champs: ChampMeta[];
  referencePar: Array<{ modele: string; libelle: string; champ: string; action: string }>;
}

export interface TableResume {
  modele: string;
  table: string;
  libelle: string;
  groupe: string;
  lectureSeule: boolean;
  lignes: number;
  octets: number | null;
  colonnes: number;
}

/** Conséquence d'une suppression sur une table qui référence la ligne visée. */
export interface ImpactSuppression {
  modele: string;
  libelle: string;
  champ: string;
  /** Cascade = supprimées avec elle · SetNull = déliées · Restrict = suppression refusée. */
  action: string;
  lignes: number;
}

export type Ligne = Record<string, unknown>;
/** { champFK : { valeur : libellé lisible } } — fourni par l'API avec les lignes. */
export type Relations = Record<string, Record<string, string>>;

/** Champs affichables dans le tableau (les relations et secrets n'en sont pas). */
export function champsAffichables(meta: TableMeta): ChampMeta[] {
  return meta.champs.filter((c) => c.kind !== 'relation' && !c.secret);
}

export function octetsLisibles(n: number | null): string {
  if (n == null) return '—';
  if (n < 1024) return `${n} o`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} Ko`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} Mo`;
  return `${(n / 1024 ** 3).toFixed(2)} Go`;
}

/**
 * Rendu d'une valeur dans le tableau. Toute la lisibilité de la console tient
 * ici : une date ISO, un booléen et un uuid de clé étrangère ne se lisent pas
 * de la même façon qu'en base.
 */
export function afficher(champ: ChampMeta, valeur: unknown, relations?: Relations): string {
  if (valeur === null || valeur === undefined || valeur === '') return '—';
  if (champ.fkVers) {
    const libelle = relations?.[champ.nom]?.[String(valeur)];
    return libelle ?? String(valeur).slice(0, 8);
  }
  if (champ.type === 'Boolean') return valeur ? 'Oui' : 'Non';
  if (champ.type === 'DateTime') return fmtDateTime(String(valeur));
  if (champ.type === 'Json') {
    const texte = typeof valeur === 'string' ? valeur : JSON.stringify(valeur);
    return texte.length > 80 ? `${texte.slice(0, 80)}…` : texte;
  }
  if (champ.estId) return String(valeur).slice(0, 8);
  return String(valeur);
}

/** `DateTime` ISO → valeur d'un `<input type="datetime-local">` (heure locale). */
export function versInputDate(valeur: unknown): string {
  if (!valeur) return '';
  const d = new Date(String(valeur));
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Valeur d'un champ telle qu'elle doit apparaître dans le formulaire. */
export function versFormulaire(champ: ChampMeta, valeur: unknown): string {
  if (valeur === null || valeur === undefined) return '';
  if (champ.type === 'DateTime') return versInputDate(valeur);
  if (champ.type === 'Boolean') return valeur ? 'true' : 'false';
  if (champ.type === 'Json') return typeof valeur === 'string' ? valeur : JSON.stringify(valeur, null, 2);
  return String(valeur);
}
