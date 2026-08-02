/**
 * Union d'intervalles temporels.
 *
 * Le rapport NOC produit UNE LIGNE PAR TECHNOLOGIE (2G/3G/4G/5G) pour une même
 * panne physique : sommer les durées ligne par ligne comptait le downtime
 * jusqu'à quatre fois, ce qui faussait la disponibilité, la part énergie et —
 * surtout — les pénalités SLA facturées aux prestataires. On fusionne donc les
 * intervalles chevauchants d'un même site avant toute somme de minutes.
 */
export interface Intervalle { debut: Date; fin: Date }

/** Minutes couvertes par l'union des intervalles (chevauchements comptés une fois). */
export function minutesUnion(intervalles: Intervalle[]): number {
  if (!intervalles.length) return 0;
  const tri = [...intervalles].sort((a, b) => a.debut.getTime() - b.debut.getTime());
  let total = 0;
  let debut = tri[0].debut.getTime();
  let fin = tri[0].fin.getTime();
  for (let i = 1; i < tri.length; i++) {
    const d = tri[i].debut.getTime();
    const f = tri[i].fin.getTime();
    if (d <= fin) {
      fin = Math.max(fin, f); // chevauchement ou contiguïté → on étend
    } else {
      total += fin - debut;
      debut = d;
      fin = f;
    }
  }
  total += fin - debut;
  return Math.max(0, Math.round(total / 60_000));
}

/** Somme des unions calculées indépendamment par clé (site, prestataire, alarme…). */
export function minutesUnionParCle(entrees: Map<string, Intervalle[]>): number {
  let total = 0;
  for (const liste of entrees.values()) total += minutesUnion(liste);
  return total;
}

/** Ajoute un intervalle à la liste d'une clé (helper d'accumulation). */
export function pousser(map: Map<string, Intervalle[]>, cle: string, iv: Intervalle): void {
  const liste = map.get(cle);
  if (liste) liste.push(iv);
  else map.set(cle, [iv]);
}
