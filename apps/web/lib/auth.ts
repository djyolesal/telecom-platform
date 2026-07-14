import NextAuth, { type DefaultSession } from 'next-auth';
import Credentials from 'next-auth/providers/credentials';

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
        try {
          const res = await fetch(`${API_URL}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: credentials.email, password: credentials.password, platform: 'WEB' }),
          });
          if (!res.ok) return null;
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
        } catch {
          return null;
        }
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
        if (!res.ok) throw new Error('refresh failed');
        const json = await res.json();
        token.accessToken = json.data.accessToken;
        token.refreshToken = json.data.refreshToken;
        token.accessTokenExpires = jwtExpiryMs(json.data.accessToken);
        delete token.error;
      } catch {
        token.error = 'RefreshTokenError'; // → la session le signale, le client déconnecte
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
