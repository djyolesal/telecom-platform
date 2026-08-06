import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, PowerConfig, StatutGE, RoleUser } from '@prisma/client';
import bcrypt from 'bcrypt';
import crypto from 'crypto';

// Prisma 7 : le client ne lit plus l'URL dans le schéma — adapter pg explicite.
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});
const SALT_ROUNDS = 12;

// Régions du Togo et préfixes de codes site
const REGIONS = [
  { nom: 'Maritime', prefix: 'MAR', villes: ['Lomé', 'Tsévié', 'Aného', 'Tabligbo', 'Vogan'], poids: 0.32 },
  { nom: 'Plateaux', prefix: 'PLT', villes: ['Atakpamé', 'Kpalimé', 'Notsé', 'Badou', 'Amlamé'], poids: 0.24 },
  { nom: 'Centrale', prefix: 'CEN', villes: ['Sokodé', 'Tchamba', 'Sotouboua', 'Blitta'], poids: 0.16 },
  { nom: 'Kara', prefix: 'KAR', villes: ['Kara', 'Niamtougou', 'Bassar', 'Pagouda', 'Kandé'], poids: 0.16 },
  { nom: 'Savanes', prefix: 'SAV', villes: ['Dapaong', 'Mango', 'Cinkassé', 'Tandjoaré'], poids: 0.12 },
];

const POWER_CONFIGS: PowerConfig[] = [
  'CEET_GE', 'CEET_UNIQUEMENT', 'GE_UNIQUEMENT', 'HYBRIDE_GE', 'SOLAIRE_UNIQUEMENT', 'HYBRIDE_CEET_GE',
];

// Générateur pseudo-aléatoire déterministe (seed fixe → données reproductibles)
let seed = 42;
function rng(): number {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
}
function pick<T>(arr: T[]): T {
  return arr[Math.floor(rng() * arr.length)];
}

// Bornes géographiques approximatives du Togo
const LAT = { min: 6.1, max: 11.0 };
const LNG = { min: 0.0, max: 1.8 };

function statutForConfig(cfg: PowerConfig): StatutGE {
  if (cfg === 'CEET_UNIQUEMENT' || cfg === 'SOLAIRE_UNIQUEMENT') return 'PAS_DE_GE';
  if (cfg === 'GE_UNIQUEMENT' || cfg === 'HYBRIDE_GE') return 'GE_PERMANENT';
  return 'GE_SECOURS';
}

async function main() {
  console.log('🌱 Seed démarré...');

  // ── Utilisateurs ───────────────────────────────────────────
  // JAMAIS de mot de passe en dur : SEED_PASSWORD si fourni, sinon un secret
  // aléatoire imprimé UNE SEULE FOIS. Un mot de passe versionné dans le dépôt
  // donnait un accès ADMIN public à toute instance installée par `make install`.
  const motDePasse = process.env.SEED_PASSWORD || crypto.randomBytes(12).toString('base64url');
  const password = await bcrypt.hash(motDePasse, SALT_ROUNDS);
  const users: Array<{ nom: string; prenom: string; email: string; role: RoleUser; region?: string }> = [
    { nom: 'Admin', prenom: 'Système', email: 'admin@telecom.tg', role: 'ADMIN' },
    { nom: 'Mensah', prenom: 'Koffi', email: 'manager@telecom.tg', role: 'MANAGER' },
    { nom: 'Doe', prenom: 'Ama', email: 'direction@telecom.tg', role: 'DIRECTION' },
    { nom: 'Agbeko', prenom: 'Yawo', email: 'superviseur.maritime@telecom.tg', role: 'SUPERVISEUR', region: 'Maritime' },
    { nom: 'Tchalla', prenom: 'Essodina', email: 'superviseur.kara@telecom.tg', role: 'SUPERVISEUR', region: 'Kara' },
    { nom: 'Kossi', prenom: 'Edem', email: 'technicien1@telecom.tg', role: 'TECHNICIEN', region: 'Maritime' },
    { nom: 'Lawson', prenom: 'Komla', email: 'technicien2@telecom.tg', role: 'TECHNICIEN', region: 'Plateaux' },
  ];

  for (const u of users) {
    await prisma.user.upsert({
      where: { email: u.email },
      update: {},
      create: { ...u, passwordHash: password, telephone: '+228 90 00 00 00' },
    });
  }
  console.log(`✅ ${users.length} utilisateurs créés.`);
  console.log(`🔑 Mot de passe initial (à changer à la première connexion) : ${motDePasse}`);
  console.log('   ⚠️  Notez-le maintenant : il n\'est stocké nulle part en clair.');

  // ── Sites (~559) ───────────────────────────────────────────
  const TOTAL = 559;
  const existing = await prisma.site.count();
  if (existing >= TOTAL) {
    console.log(`ℹ️  ${existing} sites déjà présents — seed sites ignoré`);
  } else {
    let created = 0;
    for (const region of REGIONS) {
      const nbSites = Math.round(TOTAL * region.poids);
      for (let i = 1; i <= nbSites && created < TOTAL; i++) {
        const cfg = pick(POWER_CONFIGS);
        const statutGE = statutForConfig(cfg);
        const code = `${region.prefix}-${String(i).padStart(3, '0')}`;
        const puissance = statutGE === 'PAS_DE_GE' ? 0 : pick([15, 20, 30, 45, 60, 80, 100, 125]);

        await prisma.site.upsert({
          where: { code },
          update: {},
          create: {
            nom: `Site ${pick(region.villes)} ${i}`,
            code,
            region: region.nom,
            ville: pick(region.villes),
            latitude: Number((LAT.min + rng() * (LAT.max - LAT.min)).toFixed(6)),
            longitude: Number((LNG.min + rng() * (LNG.max - LNG.min)).toFixed(6)),
            powerConfig: cfg,
            statutGE,
            puissanceGEkva: puissance,
          },
        });
        created++;
      }
    }
    console.log(`✅ ${created} sites créés`);
  }

  // ── Paramètres système par défaut ──────────────────────────
  const settings = [
    { key: 'ge.prixLitreFCFA', value: 850, description: 'Prix du litre de gasoil (FCFA)' },
    { key: 'ge.seuilCritiqueLitres', value: 300, description: 'Seuil stock critique (litres)' },
    { key: 'ge.seuilFaibleLitres', value: 700, description: 'Seuil stock faible (litres)' },
    { key: 'ceet.tarifKwhFCFA', value: 105, description: 'Tarif CEET (FCFA/kWh)' },
  ];
  for (const s of settings) {
    await prisma.systemSettings.upsert({
      where: { key: s.key },
      update: {},
      create: { key: s.key, value: s.value, description: s.description },
    });
  }
  console.log(`✅ ${settings.length} paramètres système initialisés`);

  console.log('🌱 Seed terminé.');
}

main()
  .catch((e) => {
    console.error('❌ Erreur seed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
