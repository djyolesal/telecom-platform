'use client';

import { useMemo, useState } from 'react';
import { Upload } from 'lucide-react';
import { Button } from '@/components/shared/Button';
import { Textarea } from '@/components/shared/Form';
import { fmtNumber } from '@/lib/utils';
import type { PointBaremage } from '@/lib/cuve';

type Unite = 'cm' | 'mm';

interface Lecture {
  points: PointBaremage[];
  illisibles: { ligne: number; texte: string }[];
}

/**
 * Lit un barème collé depuis Excel : deux colonnes, hauteur puis litres, une
 * ligne par point (tabulation, point-virgule ou espaces ; virgule décimale
 * acceptée). Une première ligne d'en-têtes (« H / Volume ») est ignorée.
 *
 * Une ligne illisible n'est JAMAIS sautée en silence : un barème amputé d'un
 * point resterait plausible et fausserait les litres sans que rien ne le
 * montre. Elle est signalée, et l'envoi attend qu'on l'ait corrigée.
 */
export function lireBareme(texte: string, unite: Unite): Lecture {
  const diviseur = unite === 'mm' ? 10 : 1;
  const points: PointBaremage[] = [];
  const illisibles: Lecture['illisibles'] = [];
  texte.split(/\r?\n/).forEach((brute, i) => {
    const ligne = brute.trim();
    if (!ligne) return;
    // Séparées par tabulation (copie Excel) ou point-virgule, les cellules
    // peuvent garder un séparateur de milliers (« 5 173 ») : on le retire.
    const champs = /[\t;]/.test(ligne)
      ? ligne.split(/[\t;]+/).map((c) => c.replace(/[\s  ]/g, '')).filter(Boolean)
      : ligne.split(/\s+/);
    const [h, l] = champs.map((c) => (/^-?\d+([.,]\d+)?$/.test(c) ? Number(c.replace(',', '.')) : NaN));
    if (champs.length >= 2 && Number.isFinite(h) && Number.isFinite(l)) {
      points.push({ hauteurCm: Math.round((h / diviseur) * 10) / 10, litres: l });
    } else if (!(i === 0 && points.length === 0 && !/\d/.test(champs[0] ?? ''))) {
      illisibles.push({ ligne: i + 1, texte: ligne });
    }
  });
  return { points, illisibles };
}

export function ImportBareme({
  onValider,
  enCours,
}: {
  onValider: (points: PointBaremage[]) => void;
  enCours: boolean;
}) {
  const [texte, setTexte] = useState('');
  const [unite, setUnite] = useState<Unite>('cm');
  const lecture = useMemo(() => lireBareme(texte, unite), [texte, unite]);
  const { points, illisibles } = lecture;

  const hauteurMax = points.length ? Math.max(...points.map((p) => p.hauteurCm)) : 0;
  // Une cuve couchée fait 1 à 2 m : au-delà de 3 m « en cm », c'était des mm.
  const douteMm = unite === 'cm' && hauteurMax > 300;
  const douteCm = unite === 'mm' && hauteurMax > 0 && hauteurMax < 30;
  const pret = points.length >= 2 && illisibles.length === 0;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span className="text-gray-600">Hauteurs du fichier en</span>
        {(['cm', 'mm'] as const).map((u) => (
          <label key={u} className="inline-flex cursor-pointer items-center gap-1.5">
            <input type="radio" name="unite-bareme" checked={unite === u} onChange={() => setUnite(u)} />
            {u === 'cm' ? 'centimètres' : 'millimètres'}
          </label>
        ))}
      </div>
      <Textarea
        value={texte}
        onChange={(e) => setTexte(e.target.value)}
        rows={8}
        className="font-mono text-xs"
        placeholder={'Collez ici les deux colonnes copiées depuis Excel :\nH\tVolume\n10\t3\n12\t4\n…'}
      />

      {texte.trim() && (
        <div className="space-y-2 text-sm">
          <p className="text-gray-600">
            {fmtNumber(points.length)} point{points.length > 1 ? 's' : ''} lu{points.length > 1 ? 's' : ''}
            {points.length >= 2 && (
              <> · de {fmtNumber(points[0].hauteurCm)} à {fmtNumber(hauteurMax)} cm · plein : {fmtNumber(Math.max(...points.map((p) => p.litres)))} L</>
            )}
          </p>
          {(douteMm || douteCm) && (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-amber-800">
              {douteMm
                ? `Une hauteur de ${fmtNumber(hauteurMax)} cm (plus de 3 m) : les hauteurs de ce fichier sont probablement en millimètres.`
                : `Une hauteur maximale de ${fmtNumber(hauteurMax)} cm : les hauteurs de ce fichier sont probablement en centimètres.`}
            </p>
          )}
          {illisibles.length > 0 && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-red-700">
              <p className="font-medium">{illisibles.length} ligne{illisibles.length > 1 ? 's' : ''} illisible{illisibles.length > 1 ? 's' : ''} : corrigez-les avant d&apos;enregistrer.</p>
              <ul className="mt-1 space-y-0.5 font-mono text-xs">
                {illisibles.slice(0, 8).map((l) => <li key={l.ligne}>ligne {l.ligne} : « {l.texte} »</li>)}
                {illisibles.length > 8 && <li>… et {illisibles.length - 8} autre(s)</li>}
              </ul>
            </div>
          )}
        </div>
      )}

      <Button type="button" icon={Upload} disabled={!pret || douteMm || douteCm} loading={enCours} onClick={() => onValider(points)}>
        Remplacer le barème ({fmtNumber(points.length)} points)
      </Button>
    </div>
  );
}
