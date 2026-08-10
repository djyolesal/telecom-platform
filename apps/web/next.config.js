/** @type {import('next').NextConfig} */
const nextConfig = {
  // Build autonome pour l'image Docker (cf. Dockerfile : .next/standalone)
  output: 'standalone',
  reactStrictMode: true,
  poweredByHeader: false,
  // Optimiseur d'images DÉSACTIVÉ. `next/image` n'est utilisé nulle part dans
  // l'application, mais l'endpoint /_next/image restait joignable avec des
  // `remotePatterns` en `**` : n'importe qui pouvait faire télécharger et
  // redimensionner l'URL de son choix par le serveur — proxy d'images ouvert,
  // surface SSRF, et le vecteur exact de l'avis GHSA-9g9p-9gw9-jx7f. Le
  // désactiver sort aussi `sharp` (libvips) du chemin d'exécution.
  images: { unoptimized: true },
  // Version de package.json figée au build → affichée dans la barre latérale
  // (support : « quelle version vois-tu ? »). À incrémenter à chaque livraison.
  env: { NEXT_PUBLIC_APP_VERSION: require('./package.json').version },
};

module.exports = nextConfig;
