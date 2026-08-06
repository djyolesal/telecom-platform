import { auth } from '@/lib/auth';
import { NextResponse } from 'next/server';

/**
 * Protège toutes les routes du portail. Les utilisateurs non authentifiés
 * sont redirigés vers /login. Les routes publiques (auth, assets, API) sont exclues.
 */
export default auth((req) => {
  const { pathname } = req.nextUrl;
  const isLoggedIn = !!req.auth;

  const isPublic =
    pathname.startsWith('/login') ||
    pathname.startsWith('/forgot-password') ||
    pathname.startsWith('/reset-password') ||
    pathname.startsWith('/api/auth') ||
    pathname.startsWith('/api/health');

  if (!isLoggedIn && !isPublic) {
    const url = new URL('/login', req.nextUrl.origin);
    url.searchParams.set('callbackUrl', pathname);
    return NextResponse.redirect(url);
  }

  if (isLoggedIn && pathname === '/login') {
    return NextResponse.redirect(new URL('/dashboard', req.nextUrl.origin));
  }

  return NextResponse.next();
});

export const config = {
  // /api/auth EXCLU DU MATCHER — pas seulement liste « publique » dans le
  // handler : le wrapper auth() RE-SIGNE le cookie de session sur chaque
  // réponse qu'il traite (rolling de maxAge). Quand la déconnexion passait par
  // lui, la même réponse portait notre Set-Cookie d'expiration ET le cookie
  // re-signé du wrapper — qui gagnait : la session ressuscitait à l'instant
  // même où on la tuait (constaté en E2E, cookie recréé avec 30 j d'expiration).
  // Auth.js gère ses propres routes ; le middleware n'a rien à y faire.
  matcher: ['/((?!api/auth|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};
