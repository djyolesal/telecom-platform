import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Politique de confidentialité — E&M OpS',
  description:
    "Politique de confidentialité de l'application mobile E&M OpS : données collectées, finalités, partage, sécurité et droits des utilisateurs.",
};

/**
 * Page PUBLIQUE (exclue de l'authentification dans le middleware) : c'est
 * l'URL de politique de confidentialité exigée par Google Play pour l'app
 * mobile. Ne rien afficher ici qui dépende d'une session.
 */

const MAJ = '14 août 2026';
const CONTACT = 'support@emops.uk';

function H2({ children }: { children: React.ReactNode }) {
  return <h2 className="mt-8 mb-3 text-xl font-bold text-brand">{children}</h2>;
}
function P({ children }: { children: React.ReactNode }) {
  return <p className="mb-3 leading-relaxed text-gray-700">{children}</p>;
}
function LI({ children }: { children: React.ReactNode }) {
  return <li className="mb-1.5 leading-relaxed text-gray-700">{children}</li>;
}

export default function ConfidentialitePage() {
  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-gradient-to-br from-[#1B3F6B] to-[#0E7C6B] px-4 py-10 text-white">
        <div className="mx-auto max-w-3xl">
          <p className="text-sm font-semibold uppercase tracking-widest text-white/70">E&M OpS</p>
          <h1 className="mt-1 text-3xl font-bold">Politique de confidentialité</h1>
          <p className="mt-2 text-white/80">
            Application mobile E&M OpS — Dernière mise à jour : {MAJ}
          </p>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-8">
        <P>
          L'application mobile <strong>E&M OpS</strong> est un outil professionnel de gestion de la
          maintenance d'infrastructures télécoms (sites BTS et équipements d'énergie). Elle est
          réservée aux employés et aux prestataires autorisés de l'exploitant : il n'existe pas
          d'inscription publique, les comptes sont créés par un administrateur dans un cadre
          contractuel. La présente politique décrit les données traitées par l'application, leurs
          finalités et vos droits.
        </P>

        <H2>1. Responsable du traitement</H2>
        <P>
          Le traitement est opéré par la Direction Technique de l'exploitant de la plateforme E&M
          OpS. Pour toute question relative à cette politique ou à vos données :{' '}
          <a className="font-medium text-brand underline" href={`mailto:${CONTACT}`}>
            {CONTACT}
          </a>
          .
        </P>

        <H2>2. Données collectées</H2>
        <ul className="mb-3 list-disc pl-6">
          <LI>
            <strong>Données de compte</strong> : nom, prénom, adresse e-mail professionnelle,
            numéro de téléphone, rôle, région d'affectation et société de rattachement. Ces données
            sont fournies par votre employeur lors de la création du compte.
          </LI>
          <LI>
            <strong>Identifiant d'appareil</strong> : un identifiant technique et le modèle du
            téléphone sont enregistrés à la première connexion pour lier le compte à un appareil
            unique (mesure de sécurité contre le partage de comptes).
          </LI>
          <LI>
            <strong>Jeton de notification</strong> : un jeton Firebase Cloud Messaging (Google) est
            utilisé pour vous envoyer les notifications liées à votre activité (affectation
            d'interventions, alertes).
          </LI>
          <LI>
            <strong>Localisation ponctuelle</strong> : la position GPS est relevée au moment des
            saisies terrain (interventions, relevés) afin de géolocaliser l'opération et de
            retrouver le site le plus proche. L'application n'effectue{' '}
            <strong>aucun suivi de localisation en arrière-plan</strong>.
          </LI>
          <LI>
            <strong>Photos</strong> : les photos prises via l'application (caméra ou galerie) sont
            jointes aux comptes rendus d'intervention, relevés et incidents. Elles sont horodatées.
          </LI>
          <LI>
            <strong>Signatures</strong> : la signature électronique de l'agent présent sur site est
            recueillie sur l'écran du téléphone pour attester le passage.
          </LI>
          <LI>
            <strong>Données d'activité professionnelle</strong> : interventions, relevés
            (carburant, énergie), incidents déclarés, ainsi que les journaux techniques de
            connexion et d'audit nécessaires à la sécurité et à la traçabilité.
          </LI>
          <LI>
            <strong>Biométrie</strong> : le déverrouillage biométrique (empreinte, visage) est une
            option traitée <strong>localement par Android</strong>. L'application ne collecte, ne
            stocke ni ne transmet aucune donnée biométrique.
          </LI>
        </ul>

        <H2>3. Finalités du traitement</H2>
        <ul className="mb-3 list-disc pl-6">
          <LI>Gestion et traçabilité des opérations de maintenance des sites télécoms ;</LI>
          <LI>Planification, suivi et validation contractuelle des prestations ;</LI>
          <LI>Sécurité des comptes et prévention des usages frauduleux ;</LI>
          <LI>Envoi de notifications professionnelles liées à votre activité ;</LI>
          <LI>Production de rapports d'exploitation (SLA, disponibilité, consommations).</LI>
        </ul>
        <P>Aucune donnée n'est utilisée à des fins publicitaires ou commerciales.</P>

        <H2>4. Partage des données</H2>
        <P>
          Vos données ne sont <strong>ni vendues, ni louées, ni cédées</strong> à des tiers. Elles
          sont accessibles, selon leur rôle, aux personnels autorisés de l'exploitant et de votre
          employeur (superviseurs, managers, administrateurs), dans le cadre strictement
          professionnel décrit ci-dessus. Deux catégories de sous-traitants techniques
          interviennent : l'hébergement sécurisé de la plateforme et Google Firebase Cloud
          Messaging pour l'acheminement des notifications.
        </P>

        <H2>5. Sécurité</H2>
        <P>
          Les échanges entre l'application et les serveurs sont chiffrés (HTTPS/TLS). L'accès aux
          données est contrôlé par rôles, avec session unique par utilisateur, verrouillage du
          compte sur un appareil et journalisation des accès. Les mots de passe sont stockés sous
          forme hachée et les serveurs font l'objet de sauvegardes et de mesures de durcissement.
        </P>

        <H2>6. Conservation</H2>
        <P>
          Les données d'exploitation (interventions, relevés, photos, signatures) sont conservées
          pendant la durée d'exploitation de la plateforme et des relations contractuelles, puis
          archivées ou supprimées conformément aux obligations légales et contractuelles
          applicables. Les comptes désactivés ne peuvent plus accéder au service ; les journaux
          techniques sont conservés pour des durées limitées à des fins de sécurité.
        </P>

        <H2>7. Vos droits</H2>
        <P>
          Conformément à la loi togolaise n° 2019-014 relative à la protection des données à
          caractère personnel, vous disposez de droits d'accès, de rectification et de suppression
          de vos données personnelles. Pour les exercer, adressez-vous à votre administrateur ou
          écrivez à{' '}
          <a className="font-medium text-brand underline" href={`mailto:${CONTACT}`}>
            {CONTACT}
          </a>
          .
        </P>
        <P>
          <strong>Suppression de compte</strong> : les comptes étant créés dans un cadre
          professionnel, la clôture d'un compte s'effectue sur demande auprès de votre employeur ou
          de l'administrateur de la plateforme, qui procède à la désactivation puis à la
          suppression des données personnelles associées dans les conditions de l'article 6.
        </P>

        <H2>8. Public concerné</H2>
        <P>
          L'application est exclusivement destinée à un public professionnel adulte. Elle n'est pas
          proposée au grand public et ne s'adresse pas aux mineurs.
        </P>

        <H2>9. Modifications</H2>
        <P>
          La présente politique peut être mise à jour pour refléter les évolutions de
          l'application ou de la réglementation. La date de dernière mise à jour figure en haut de
          cette page ; les changements significatifs sont notifiés aux utilisateurs via
          l'application ou leur employeur.
        </P>

        <footer className="mt-10 border-t border-gray-200 pt-4 text-sm text-gray-500">
          E&M OpS — Plateforme de gestion de maintenance télécoms · Contact :{' '}
          <a className="underline" href={`mailto:${CONTACT}`}>
            {CONTACT}
          </a>
        </footer>
      </main>
    </div>
  );
}
