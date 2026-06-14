import { api } from './api';

/**
 * Télécharge un fichier depuis l'API en passant par le client authentifié
 * (le jeton JWT est attaché par l'intercepteur). Évite les liens <a href> qui
 * ne transportent pas le Bearer et cassent sur les variables NEXT_PUBLIC_*.
 *
 * @param path   chemin relatif à la base API, ex: '/sites/export/xlsx'
 * @param filename nom du fichier proposé au téléchargement
 * @param openInNewTab ouvre le fichier (PDF) dans un onglet au lieu de le télécharger
 */
export async function downloadFile(path: string, filename: string, openInNewTab = false): Promise<void> {
  const res = await api.get(path, { responseType: 'blob' });
  const contentType = (res.headers['content-type'] as string) || 'application/octet-stream';
  const blob = new Blob([res.data], { type: contentType });
  const url = window.URL.createObjectURL(blob);

  if (openInNewTab) {
    window.open(url, '_blank', 'noopener,noreferrer');
    // Laisse le temps au navigateur d'ouvrir l'onglet avant de révoquer
    setTimeout(() => window.URL.revokeObjectURL(url), 10_000);
    return;
  }

  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.URL.revokeObjectURL(url);
}
