import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

/**
 * Déconnexion DÉTERMINISTE.
 *
 * Le signOut() d'Auth.js (bêta) répond 200 sans faire expirer le jeton de
 * session quand celui-ci est DÉCOUPÉ en morceaux (`…session-token.0`, `.1` —
 * notre cas : le jeton embarque les deux JWT API et dépasse la taille d'un
 * cookie). Résultat constaté en recette E2E : clic sur « Déconnexion »,
 * navigation… et session toujours vivante, données chargées.
 *
 * Ici, pas de dépendance aux internes de la bibliothèque : on fait expirer
 * TOUS les cookies de session effectivement présents dans la requête, quel
 * que soit leur nom exact (préfixe __Secure-, morceaux .0/.1/…).
 *
 * Sous /api/auth/ à dessein : nginx n'envoie vers Next QUE /api/auth/* — tout
 * autre /api/* part vers l'API Express (la première version de cette route en
 * /api/deconnexion recevait une 404 Express, et les cookies survivaient). La
 * route STATIQUE prime sur le catch-all [...nextauth] d'Auth.js.
 */
export async function POST(req: Request) {
  // Hygiène anti-CSRF : la déconnexion n'accepte que la même origine.
  const origin = req.headers.get('origin');
  const host = req.headers.get('host');
  if (origin && host && new URL(origin).host !== host) {
    return NextResponse.json({ ok: false }, { status: 403 });
  }

  const res = NextResponse.json({ ok: true });
  const store = await cookies();
  for (const c of store.getAll()) {
    if (c.name.includes('authjs.session-token')) {
      res.cookies.set(c.name, '', {
        path: '/',
        expires: new Date(0),
        httpOnly: true,
        secure: c.name.startsWith('__Secure-'),
        sameSite: 'lax',
      });
    }
  }
  return res;
}
