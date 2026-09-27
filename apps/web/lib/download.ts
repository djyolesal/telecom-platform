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
 *
 * Le nom vient de l'APPELANT : c'est l'écran qui connaît son titre et ses
 * filtres (« Rapport de supervision du 1er au 31/08 »), pas l'API. Les deux
 * documents contractuels font exception et passent par
 * `downloadFileNommeParServeur`.
 */
export async function downloadFile(path: string, filename: string, openInNewTab = false, timeoutMs?: number): Promise<void> {
  try {
    const res = await api.get(path, { responseType: 'blob', ...(timeoutMs ? { timeout: timeoutMs } : {}) });
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
  } catch (err) {
    toast(await messageErreur(err), 'error');
  }
}

/**
 * Téléchargement dont le nom est décidé PAR LE SERVEUR (`Content-Disposition`).
 *
 * Réservé aux documents dont l'identité est contractuelle - rapport mensuel
 * d'activité et fiche de validation, nommés par prestataire, lot et période :
 * le portail ne connaît pas toujours le code du lot, et deux constructions du
 * même nom finiraient par diverger. `filename` sert de repli si l'en-tête
 * n'est pas lisible.
 */
export async function downloadFileNommeParServeur(
  path: string, filename: string, timeoutMs?: number,
): Promise<void> {
  try {
    const res = await api.get(path, { responseType: 'blob', ...(timeoutMs ? { timeout: timeoutMs } : {}) });
    const dispo = (res.headers['content-disposition'] as string) || '';
    const nomServeur = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(dispo)?.[1];
    const blob = new Blob([res.data], { type: (res.headers['content-type'] as string) || 'application/octet-stream' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = nomServeur ? decodeURIComponent(nomServeur) : filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
  } catch (err) {
    toast(await messageErreur(err), 'error');
  }
}

/**
 * Un export qui échoue (403, 500, timeout) ne doit pas être silencieux : la
 * réponse blob masque le message du serveur, on le récupère dans le corps.
 */
async function messageErreur(err: unknown): Promise<string> {
  let message = errorMessage(err, 'Échec du téléchargement');
  const data = (err as { response?: { data?: unknown } }).response?.data;
  if (data instanceof Blob && data.type.includes('json')) {
    try { message = JSON.parse(await data.text())?.error ?? message; } catch { /* garde le défaut */ }
  }
  return message;
}
