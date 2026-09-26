import { api } from './api';
import { toast, errorMessage } from './toast';

/**
 * Télécharge un fichier depuis l'API en passant par le client authentifié
 * (le jeton JWT est attaché par l'intercepteur). Évite les liens <a href> qui
 * ne transportent pas le Bearer et cassent sur les variables NEXT_PUBLIC_*.
 *
 * @param path   chemin relatif à la base API, ex: '/sites/export/xlsx'
 * @param filename nom du fichier proposé au téléchargement
 * @param openInNewTab ouvre le fichier (PDF) dans un onglet au lieu de le télécharger
 * @param timeoutMs pour les documents LONGS à fabriquer (rapport mensuel d'un
 *   lot entier : photos téléchargées, rééchantillonnées puis mises en page).
 *   Le défaut de 30 s du client fait échouer l'export alors que le serveur
 *   travaille encore, et l'utilisateur lit « Le serveur met trop de temps ».
 */
export async function downloadFile(path: string, filename: string, openInNewTab = false, timeoutMs?: number): Promise<void> {
  try {
    const res = await api.get(path, { responseType: 'blob', ...(timeoutMs ? { timeout: timeoutMs } : {}) });
    const contentType = (res.headers['content-type'] as string) || 'application/octet-stream';
    // Le serveur nomme le document (prestataire, lot, période) : on suit son
    // nom quand il en donne un, plutôt que d'en recalculer un second ici.
    const dispo = (res.headers['content-disposition'] as string) || '';
    const nomServeur = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(dispo)?.[1];
    if (nomServeur) filename = decodeURIComponent(nomServeur);
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
  } catch (err) {
    // Un export/PDF qui échoue (403, 500, timeout) ne doit plus être silencieux :
    // la réponse blob masque le message, on le récupère du corps d'erreur.
    let message = errorMessage(err, 'Échec du téléchargement');
    const data = (err as { response?: { data?: unknown } }).response?.data;
    if (data instanceof Blob && data.type.includes('json')) {
      try { message = JSON.parse(await data.text())?.error ?? message; } catch { /* garde le défaut */ }
    }
    toast(message, 'error');
  }
}
