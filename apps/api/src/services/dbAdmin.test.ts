import {
  catalogue,
  champsLisibles,
  construireData,
  convertir,
  libelleLigne,
  modeleOuErreur,
  selectionLecture,
  serialiserLigne,
  valeursEnum,
} from './dbAdmin.service';
import { AppError } from '../utils/AppError';

/**
 * Le catalogue est dérivé de schema.prisma : ces tests vérifient que la lecture
 * du schéma reste fidèle (types, obligation, enums, clés étrangères) et que la
 * conversion des valeurs refuse ce que la base refuserait.
 */

describe('catalogue dérivé du schéma Prisma', () => {
  it('expose toutes les tables du modèle avec leur nom SQL', () => {
    const { modeles } = catalogue();
    expect(modeles.size).toBeGreaterThan(20);
    expect(modeles.get('Site')?.table).toBe('sites');
    expect(modeles.get('User')?.table).toBe('users');
  });

  it('reconnaît obligation, valeur par défaut et longueur maximale', () => {
    const site = modeleOuErreur('Site');
    const nom = site.champs.find((c) => c.nom === 'nom');
    expect(nom).toMatchObject({ type: 'String', obligatoire: true, longueurMax: 100 });
    const ville = site.champs.find((c) => c.nom === 'ville');
    expect(ville?.obligatoire).toBe(false);
  });

  it('distingue les enums des scalaires et en donne les valeurs', () => {
    const maintenance = modeleOuErreur('Maintenance');
    const statut = maintenance.champs.find((c) => c.nom === 'statut');
    expect(statut?.kind).toBe('enum');
    expect(valeursEnum(statut!.type)).toContain('TERMINEE');
  });

  it('rattache chaque clé étrangère à sa table cible', () => {
    const maintenance = modeleOuErreur('Maintenance');
    expect(maintenance.champs.find((c) => c.nom === 'siteId')?.fkVers).toBe('Site');
    expect(maintenance.champs.find((c) => c.nom === 'technicienId')?.fkVers).toBe('User');
  });

  it('retient la règle de suppression de chaque clé étrangère', () => {
    // Déclarée au schéma : les pièces meurent avec leur maintenance.
    expect(modeleOuErreur('PieceRechange').champs.find((c) => c.nom === 'maintenanceId')?.surSuppression).toBe('Cascade');
    // Défauts Prisma quand onDelete n'est pas écrit : Restrict si obligatoire, SetNull sinon.
    const maintenance = modeleOuErreur('Maintenance');
    expect(maintenance.champs.find((c) => c.nom === 'siteId')?.surSuppression).toBe('Restrict');
    expect(maintenance.champs.find((c) => c.nom === 'technicienId')?.surSuppression).toBe('SetNull');
  });

  it('refuse une table hors catalogue (liste blanche)', () => {
    expect(() => modeleOuErreur('pg_user')).toThrow(AppError);
  });

  it('verrouille le journal d’audit en consultation seule', () => {
    expect(modeleOuErreur('AuditLog').lectureSeule).toBe(true);
    const champs = modeleOuErreur('AuditLog').champs.filter((c) => c.modifiable || c.creable);
    expect(champs).toHaveLength(0);
  });

  it('n’expose jamais l’empreinte du mot de passe en lecture', () => {
    const user = modeleOuErreur('User');
    expect(user.champs.find((c) => c.nom === 'passwordHash')?.secret).toBe(true);
    expect(champsLisibles(user).some((c) => c.nom === 'passwordHash')).toBe(false);
    expect(selectionLecture(user).passwordHash).toBeUndefined();
  });

  it('interdit la modification d’un identifiant et des horodatages système', () => {
    const site = modeleOuErreur('Site');
    expect(site.champs.find((c) => c.estId)?.modifiable).toBe(false);
    expect(site.champs.find((c) => c.nom === 'createdAt')?.modifiable).toBe(false);
    expect(site.champs.find((c) => c.nom === 'updatedAt')?.modifiable).toBe(false);
  });

  it('exige la saisie d’un identifiant naturel (sans valeur par défaut)', () => {
    const code = modeleOuErreur('TypePyloneRef').champs.find((c) => c.estId);
    expect(code?.creable).toBe(true); // le code est saisi
    const id = modeleOuErreur('Site').champs.find((c) => c.estId);
    expect(id?.creable).toBe(false); // uuid généré par la base
  });
});

describe('conversion des valeurs saisies', () => {
  const site = () => modeleOuErreur('Site');
  const champ = (nom: string) => site().champs.find((c) => c.nom === nom)!;

  it('refuse une valeur vide sur un champ obligatoire', async () => {
    await expect(convertir(site(), champ('nom'), '')).rejects.toThrow(AppError);
  });

  it('accepte le vide sur un champ optionnel et le convertit en NULL', async () => {
    await expect(convertir(site(), champ('ville'), '')).resolves.toBeNull();
  });

  it('refuse un texte trop long pour la colonne', async () => {
    await expect(convertir(site(), champ('code'), 'X'.repeat(50))).rejects.toThrow(/dépasse/);
  });

  it('refuse une valeur hors de l’enum', async () => {
    await expect(convertir(site(), champ('powerConfig'), 'DIESEL')).rejects.toThrow(/Valeur invalide/);
    await expect(convertir(site(), champ('powerConfig'), 'CEET_GE')).resolves.toBe('CEET_GE');
  });

  it('convertit dates, booléens et nombres', async () => {
    const maintenance = modeleOuErreur('Maintenance');
    const date = maintenance.champs.find((c) => c.nom === 'datePlanifiee')!;
    await expect(convertir(maintenance, date, '2026-08-20T08:30')).resolves.toBeInstanceOf(Date);
    await expect(convertir(maintenance, date, 'pas une date')).rejects.toThrow(AppError);

    const duree = maintenance.champs.find((c) => c.nom === 'dureeMinutes')!;
    await expect(convertir(maintenance, duree, '90')).resolves.toBe(90);
    await expect(convertir(maintenance, duree, '90,5')).rejects.toThrow(/entier/);

    const sync = maintenance.champs.find((c) => c.nom === 'isSynced')!;
    await expect(convertir(maintenance, sync, 'true')).resolves.toBe(true);
  });

  it('hache le mot de passe au lieu de l’écrire en clair', async () => {
    const user = modeleOuErreur('User');
    const hash = await convertir(user, user.champs.find((c) => c.nom === 'passwordHash')!, 'motdepasse123');
    expect(typeof hash).toBe('string');
    expect(hash).not.toBe('motdepasse123');
    expect(String(hash)).toMatch(/^\$2[aby]\$/);
  });
});

describe('construction du payload d’écriture', () => {
  it('ignore les champs inconnus ou verrouillés', async () => {
    const site = modeleOuErreur('Site');
    const data = await construireData(site, { nom: 'Agoè-Nyivé', id: 'forcé', createdAt: '2020-01-01', inconnu: 1 }, 'update');
    expect(data).toEqual({ nom: 'Agoè-Nyivé' });
  });

  it('refuse toute écriture sur une table en consultation seule', async () => {
    await expect(construireData(modeleOuErreur('AuditLog'), { action: 'CREATE' }, 'update')).rejects.toThrow(/consultation seule/);
  });

  it('refuse un enregistrement vide', async () => {
    await expect(construireData(modeleOuErreur('Site'), { inconnu: 'x' }, 'update')).rejects.toThrow(/Aucun champ/);
  });

  it('exige les champs obligatoires sans défaut à la création', async () => {
    await expect(construireData(modeleOuErreur('Site'), { nom: 'Test' }, 'create')).rejects.toThrow(/obligatoire/);
  });

  it('laisse un mot de passe vide signifier « ne pas changer »', async () => {
    const data = await construireData(modeleOuErreur('User'), { passwordHash: '', nom: 'Kossi' }, 'update');
    expect(data).toEqual({ nom: 'Kossi' });
  });
});

describe('rendu des lignes', () => {
  it('sérialise dates et décimaux pour le navigateur', () => {
    const out = serialiserLigne({ d: new Date('2026-08-20T10:00:00Z'), n: null, b: BigInt(12) });
    expect(out.d).toBe('2026-08-20T10:00:00.000Z');
    expect(out.n).toBeNull();
    expect(out.b).toBe('12');
  });

  it('donne un libellé lisible plutôt qu’un uuid', () => {
    const site = modeleOuErreur('Site');
    expect(libelleLigne(site, { id: 'abcdef1234', nom: 'Lomé-Centre', code: 'LOM01' })).toBe('Lomé-Centre — LOM01');
    expect(libelleLigne(site, { id: 'abcdef1234' })).toBe('abcdef12');
  });
});
