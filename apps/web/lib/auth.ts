import NextAuth, { CredentialsSignin, type DefaultSession } from 'next-auth';
import Credentials from 'next-auth/providers/credentials';

/**
 * Échec de connexion dont la CAUSE est connue (API injoignable, limiteur,
 * refus explicite du serveur). Le `code` remonte jusqu'à la page de login, qui
 * affiche un message honnête : afficher « mot de passe incorrect » quand
 * l'API est tombée a déjà coûté une matinée de diagnostic en production.
 * Codes volontairement grossiers : ils transitent par l'URL.
 */
class EchecConnexion extends CredentialsSignin {
  constructor(public code: string) { super(code); }
}

// URL interne de l'API (réseau Docker) ou publique en dev
const API_URL =
  process.env.API_INTERNAL_URL ||
  process.env.NEXT_PUBLIC_API_URL ||
  'http://api:3001/v1';

declare module 'next-auth' {
  interface Session {
    accessToken?: string;
    error?: string;
    user: { id: string; role: string } & DefaultSession['user'];
  }
  interface User {
    role: string;
    accessToken: string;
    refreshToken: string;
  }
}

/** Timestamp (ms) d'expiration d'un JWT, lu depuis son payload `exp`. */
function jwtExpiryMs(token: string): number {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
    return typeof payload.exp === 'number' ? payload.exp * 1000 : 0;
  } catch {
    return 0;
  }
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  // Compatibilité avec la variable NEXTAUTH_SECRET fournie par docker-compose (v4 → v5)
  secret: process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET,
  session: { strategy: 'jwt', maxAge: 30 * 24 * 60 * 60 },
  pages: { signIn: '/login' },
  providers: [
    Credentials({
      name: 'Credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Mot de passe', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;
        let res: Response;
        try {
          res = await fetch(`${API_URL}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: credentials.email, password: credentials.password, platform: 'WEB' }),
          });
        } catch (e) {
          // L'API n'a pas répondu du tout : conteneur arrêté, API_INTERNAL_URL
          // erronée, réseau Docker cassé. Trace serveur explicite - c'est elle
          // qu'on lit dans `docker compose logs web`.
          console.error(`[auth] API injoignable sur ${API_URL} :`, (e as Error).message);
          throw new EchecConnexion('api_injoignable');
        }
        if (!res.ok) {
          // 401 = vrais mauvais identifiants (le serveur ne distingue pas
          // volontairement mot de passe faux et compte désactivé).
          if (res.status === 401) return null;
          const detail = await res.json().catch(() => null);
          console.error(`[auth] refus de l'API (${res.status}) :`, detail?.error ?? res.statusText);
          if (res.status === 429) throw new EchecConnexion('trop_de_tentatives');
          if (res.status === 403) throw new EchecConnexion('acces_refuse');
          throw new EchecConnexion('erreur_serveur');
        }
        const json = await res.json();
        const { user, accessToken, refreshToken } = json.data;
        return {
          id: user.id,
          name: `${user.prenom} ${user.nom}`,
          email: user.email,
          role: user.role,
          accessToken,
          refreshToken,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      // Connexion initiale : on mémorise aussi l'expiration de l'accessToken.
      if (user) {
        token.id = user.id;
        token.role = user.role;
        token.accessToken = user.accessToken;
        token.refreshToken = user.refreshToken;
        token.accessTokenExpires = jwtExpiryMs(user.accessToken);
        return token;
      }

      // Encore valide (marge 2 min) → rien à faire.
      const expires = (token.accessTokenExpires as number) || 0;
      if (expires && Date.now() < expires - 120_000) return token;

      // Expiré/bientôt : rotation via l'API. Sinon la session NextAuth (30 j)
      // survivrait à l'accessToken (12 h) → 401 en boucle côté client.
      try {
        const res = await fetch(`${API_URL}/auth/refresh-token`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken: token.refreshToken }),
        });
        if (res.ok) {
          const json = await res.json();
          token.accessToken = json.data.accessToken;
          token.refreshToken = json.data.refreshToken;
          token.accessTokenExpires = jwtExpiryMs(json.data.accessToken);
          delete token.error;
        } else if (res.status === 401) {
          // Refus explicite (refresh révoqué / session prise sur un autre appareil) :
          // session morte → le client déconnecte.
          token.error = 'RefreshTokenError';
        }
        // Autre statut (5xx, API en cours de redémarrage) : NE PAS déconnecter.
        // On garde le jeton courant et on retentera à la prochaine requête.
      } catch {
        // Erreur RÉSEAU (API injoignable, timeout) : transitoire → on ne
        // déconnecte pas, le refresh sera retenté au prochain appel.
      }
      return token;
    },
    async session({ session, token }) {
      session.user.id = token.id as string;
      session.user.role = token.role as string;
      session.accessToken = token.accessToken as string;
      session.error = token.error as string | undefined;
      return session;
    },
  },
});
