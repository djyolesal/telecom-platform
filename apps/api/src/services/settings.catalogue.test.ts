import fs from 'fs';
import path from 'path';
import { settingsCatalog } from './settings.service';

/**
 * Un réglage LU par le code mais absent du catalogue fonctionne sur sa valeur
 * par défaut ET n'apparaît nulle part dans Administration → Paramètres :
 * l'exploitant ne peut pas y toucher, ni même savoir qu'il existe. Quatre
 * réglages étaient dans ce cas (photos min. au démarrage d'un incident, fenêtre
 * anti-doublon des dépotages, marge gasoil GE permanent, prix du kWh) — signalé
 * par l'exploitant, pas par la plateforme.
 *
 * Ce test relit les sources : toute nouvelle clé lue devra être déclarée.
 */
function fichiersTs(dir: string, acc: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) fichiersTs(p, acc);
    else if (e.name.endsWith('.ts') && !e.name.endsWith('.test.ts')) acc.push(p);
  }
  return acc;
}

describe('catalogue des réglages', () => {
  it('toute clé lue par getNum est déclarée, donc modifiable par l\'exploitant', () => {
    const declarees = new Set(settingsCatalog().map((r) => r.key));
    const lues = new Set<string>();
    for (const f of fichiersTs(path.join(__dirname, '..'))) {
      const src = fs.readFileSync(f, 'utf8');
      for (const m of src.matchAll(/getNum\('([a-zA-Z0-9._]+)'/g)) lues.add(m[1]);
    }
    const orphelines = [...lues].filter((k) => !declarees.has(k)).sort();
    expect(orphelines).toEqual([]);
  });
});
