'use client';

import { useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { api } from '@/lib/api';
import { errorMessage, toast } from '@/lib/toast';
import { Button } from '@/components/shared/Button';
import { Field, Input, Select, Textarea } from '@/components/shared/Form';
import { SelecteurRelation } from './SelecteurRelation';
import { ChampMeta, Ligne, Relations, TableMeta, versFormulaire } from './types';

/**
 * Formulaire de création / modification d'un enregistrement, entièrement
 * construit à partir des métadonnées de la table : chaque type Prisma reçoit le
 * contrôle qui lui convient (enum → liste, DateTime → sélecteur de date,
 * clé étrangère → recherche dans la table cible, Json → zone de texte).
 *
 * En modification, SEULS les champs réellement touchés partent à l'API : le
 * diff du journal d'audit reste lisible et deux administrateurs travaillant sur
 * la même ligne ne s'écrasent pas mutuellement les champs qu'ils n'ont pas vus.
 */
export function EnregistrementModal({
  meta,
  ligne,
  relations,
  onClose,
  onEnregistre,
}: {
  meta: TableMeta;
  ligne: Ligne | null;
  relations?: Relations;
  onClose: () => void;
  onEnregistre: () => void;
}) {
  const modification = !!ligne;
  const champs = useMemo(
    () => meta.champs.filter((c) => (modification ? c.modifiable : c.creable)),
    [meta, modification]
  );

  const initial = useMemo(() => {
    const out: Record<string, string> = {};
    for (const c of champs) {
      if (ligne) { out[c.nom] = versFormulaire(c, ligne[c.nom]); continue; }
      // À la création, on pré-remplit avec le défaut du schéma quand il est une
      // valeur littérale (0, true, PLANIFIEE…) et jamais quand c'est une
      // fonction (now(), uuid()) : la base s'en charge mieux que nous.
      const litteral = c.defaut && !c.defaut.endsWith(')') ? c.defaut.replace(/^"|"$/g, '') : '';
      out[c.nom] = litteral;
    }
    return out;
  }, [champs, ligne]);

  const [form, setForm] = useState<Record<string, string>>(initial);
  const [erreur, setErreur] = useState('');
  const set = (nom: string, valeur: string) => setForm((f) => ({ ...f, [nom]: valeur }));

  const modifies = champs.filter((c) => form[c.nom] !== initial[c.nom]);

  const enregistrer = useMutation({
    mutationFn: () => {
      const corps: Record<string, string> = {};
      const aEnvoyer = modification ? modifies : champs.filter((c) => form[c.nom] !== '');
      for (const c of aEnvoyer) corps[c.nom] = form[c.nom];
      return modification
        ? api.patch(`/admin/db/tables/${meta.modele}/lignes/${ligne![meta.idChamp]}`, corps)
        : api.post(`/admin/db/tables/${meta.modele}/lignes`, corps);
    },
    onSuccess: () => {
      toast(modification ? 'Enregistrement modifié' : 'Enregistrement créé', 'success');
      onEnregistre();
      onClose();
    },
    onError: (e) => setErreur(errorMessage(e)),
  });

  const rendreChamp = (c: ChampMeta) => {
    const valeur = form[c.nom] ?? '';
    if (c.fkVers) {
      return (
        <SelecteurRelation
          modeleCible={c.fkVers}
          valeur={valeur}
          libelleActuel={ligne ? relations?.[c.nom]?.[String(ligne[c.nom] ?? '')] : undefined}
          onChange={(v) => set(c.nom, v)}
          obligatoire={c.obligatoire}
        />
      );
    }
    if (c.kind === 'enum') {
      return (
        <Select
          value={valeur}
          onChange={(e) => set(c.nom, e.target.value)}
          placeholder={c.obligatoire ? 'Choisir…' : '— vide —'}
          options={(meta.enums[c.type] ?? []).map((v) => ({ value: v, label: v }))}
        />
      );
    }
    if (c.type === 'Boolean') {
      return (
        <Select
          value={valeur}
          onChange={(e) => set(c.nom, e.target.value)}
          placeholder={c.obligatoire ? 'Choisir…' : '— vide —'}
          options={[{ value: 'true', label: 'Oui' }, { value: 'false', label: 'Non' }]}
        />
      );
    }
    if (c.type === 'DateTime') {
      return <Input type="datetime-local" value={valeur} onChange={(e) => set(c.nom, e.target.value)} />;
    }
    if (c.type === 'Json') {
      return <Textarea value={valeur} onChange={(e) => set(c.nom, e.target.value)} placeholder='{ "cle": "valeur" }' className="font-mono text-xs" />;
    }
    if (c.type === 'Int' || c.type === 'BigInt' || c.type === 'Float' || c.type === 'Decimal') {
      return (
        <Input
          type="number"
          step={c.type === 'Int' || c.type === 'BigInt' ? '1' : 'any'}
          value={valeur}
          onChange={(e) => set(c.nom, e.target.value)}
        />
      );
    }
    if (c.secret) {
      return (
        <Input
          type="password"
          value={valeur}
          onChange={(e) => set(c.nom, e.target.value)}
          placeholder={modification ? 'Laisser vide pour ne pas changer' : 'Mot de passe'}
          autoComplete="new-password"
        />
      );
    }
    // Texte libre (aucune longueur déclarée au schéma) → zone multiligne.
    if (c.longueurMax == null) {
      return <Textarea value={valeur} onChange={(e) => set(c.nom, e.target.value)} rows={2} />;
    }
    return <Input value={valeur} onChange={(e) => set(c.nom, e.target.value)} maxLength={c.longueurMax} />;
  };

  const pleineLargeur = (c: ChampMeta) => c.type === 'Json' || (c.kind === 'scalar' && c.type === 'String' && c.longueurMax == null);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
      <div className="max-h-[90vh] w-full max-w-3xl overflow-auto rounded-2xl bg-white p-6 shadow-2xl">
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h2 className="text-lg font-bold text-gray-800">
              {modification ? `Modifier — ${meta.libelle}` : `Nouvel enregistrement — ${meta.libelle}`}
            </h2>
            <p className="mt-0.5 font-mono text-xs text-gray-400">
              {meta.table}
              {modification && ` · ${String(ligne![meta.idChamp])}`}
            </p>
          </div>
          <button onClick={onClose} className="rounded p-1 hover:bg-gray-100"><X size={18} /></button>
        </div>

        {erreur && <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{erreur}</div>}

        <form
          onSubmit={(e) => { e.preventDefault(); setErreur(''); enregistrer.mutate(); }}
          className="grid grid-cols-1 gap-3 sm:grid-cols-2"
        >
          {champs.map((c) => (
            <Field
              key={c.nom}
              label={c.nom}
              required={c.obligatoire && !c.defaut}
              className={pleineLargeur(c) ? 'sm:col-span-2' : undefined}
            >
              {rendreChamp(c)}
              {(c.aide || c.unique) && (
                <p className="mt-1 text-[11px] text-gray-400">
                  {c.unique && <span className="mr-1 font-medium text-gray-500">unique ·</span>}
                  {c.aide}
                </p>
              )}
            </Field>
          ))}

          <div className="mt-2 flex items-center justify-between gap-3 border-t border-gray-100 pt-4 sm:col-span-2">
            <p className="text-xs text-gray-400">
              {modification
                ? `${modifies.length} champ(s) modifié(s) — journalisé dans l'audit`
                : 'Les champs laissés vides prennent la valeur par défaut du schéma'}
            </p>
            <div className="flex gap-2">
              <Button type="button" variant="secondary" onClick={onClose}>Annuler</Button>
              <Button type="submit" loading={enregistrer.isPending} disabled={modification && !modifies.length}>
                {modification ? 'Enregistrer' : 'Créer'}
              </Button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
