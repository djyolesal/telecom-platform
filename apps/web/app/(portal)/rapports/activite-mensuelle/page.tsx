'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FileText } from 'lucide-react';
import { api } from '@/lib/api';
import { downloadFile } from '@/lib/download';
import { PageHeader } from '@/components/shared/PageHeader';
import { FormCard, Field, Input, Select } from '@/components/shared/Form';
import { Button } from '@/components/shared/Button';
import { TYPES_MAINTENANCE } from '@/lib/constants';

/**
 * Rapport mensuel d'activité : couverture co-signée, tâches dues non réalisées,
 * puis un rapport complet par intervention.
 *
 * MENSUEL par construction : le dû contractuel se compte par mois, c'est ce qui
 * rend les tâches manquantes opposables. La fiche de validation s'exporte à
 * part (Rapports → Fiche de validation).
 */
const MOIS = [
  { value: '01', label: 'Janvier' }, { value: '02', label: 'Février' }, { value: '03', label: 'Mars' },
  { value: '04', label: 'Avril' }, { value: '05', label: 'Mai' }, { value: '06', label: 'Juin' },
  { value: '07', label: 'Juillet' }, { value: '08', label: 'Août' }, { value: '09', label: 'Septembre' },
  { value: '10', label: 'Octobre' }, { value: '11', label: 'Novembre' }, { value: '12', label: 'Décembre' },
];

export default function RapportActiviteMensuelPage() {
  const now = new Date();
  const [annee, setAnnee] = useState(String(now.getFullYear()));
  const [mois, setMois] = useState(String(now.getMonth() + 1).padStart(2, '0'));
  const [prestataireId, setPrestataireId] = useState('');
  const [lotId, setLotId] = useState('');
  const [type, setType] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const { data: prestataires } = useQuery({
    queryKey: ['prestataires-select'],
    queryFn: () => api.get('/prestataires', { params: { is_active: true, limit: 200 } }).then((r) => r.data.data),
  });
  const prestataireOptions = (prestataires ?? []).map((p: { id: string; nom: string }) => ({ value: p.id, label: p.nom }));

  // PRESTATAIRE puis LOT : le document couvre un couple contractuel, et la
  // liste des lots est celle du prestataire choisi. Proposer tous les lots du
  // parc laisserait composer un périmètre qui n'existe dans aucun contrat.
  const { data: prestaDetail, isFetching: chargeLots } = useQuery({
    queryKey: ['prestataire-lots', prestataireId],
    queryFn: () => api.get(`/prestataires/${prestataireId}`).then((r) => r.data.data),
    enabled: !!prestataireId,
  });
  const lotOptions = [
    ...new Map(
      (prestaDetail?.assignments ?? []).map((a: { lot: { id: string; code: string; nom: string } }) =>
        [a.lot.id, { value: a.lot.id, label: `${a.lot.code} - ${a.lot.nom}` }]),
    ).values(),
  ] as { value: string; label: string }[];

  const editer = async () => {
    if (!prestataireId || !lotId) { setError('Sélectionnez un prestataire et un lot : le rapport s’édite pour un lot d’un prestataire.'); return; }
    setError(''); setBusy(true);
    const q = new URLSearchParams({ mois: `${annee}-${mois}` });
    if (type) q.set('type', type);
    if (lotId) q.set('lot_id', lotId);
    if (prestataireId) q.set('prestataire_id', prestataireId);
    try {
      await downloadFile(`/maintenances/export/rapports.pdf?${q}`, `rapport-activite-${annee}-${mois}.pdf`);
    } catch (e) {
      // Le serveur porte le message utile (période trop large, aucune
      // intervention) : l'afficher tel quel plutôt qu'un « échec » générique.
      const r = (e as { response?: { data?: { error?: string } } }).response;
      setError(r?.data?.error ?? 'Édition impossible - réessayez.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Rapport mensuel d'activité"
        subtitle="Tâches dues non réalisées et chaque intervention au format du rapport unitaire - avec visa contractuel"
        backHref="/rapports"
      />
      <FormCard>
        {error && <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Mois">
            <Select value={mois} onChange={(e) => setMois(e.target.value)} options={MOIS} />
          </Field>
          <Field label="Année">
            <Input type="number" min={2024} max={2100} value={annee} onChange={(e) => setAnnee(e.target.value)} />
          </Field>
          <Field label="Prestataire" required>
            <Select value={prestataireId} onChange={(e) => { setPrestataireId(e.target.value); setLotId(''); }}
              options={prestataireOptions} placeholder="Sélectionner un prestataire…" />
          </Field>
          <Field label="Lot" required>
            <Select value={lotId} onChange={(e) => setLotId(e.target.value)} options={lotOptions} disabled={!prestataireId}
              placeholder={!prestataireId ? 'Choisir un prestataire d’abord' : chargeLots ? 'Chargement des lots…' : 'Sélectionner un lot…'} />
          </Field>
          <Field label="Type">
            <Select value={type} onChange={(e) => setType(e.target.value)} options={TYPES_MAINTENANCE} placeholder="Tous types" />
          </Field>
        </div>
        <p className="mt-4 text-xs text-gray-500">
          Un rapport pour <b>un prestataire et un lot</b> à la fois : c’est le découpage contractuel, celui que le
          prestataire signe et qu’on facture. Éditez les lots les uns après les autres. Seules les interventions
          <b> terminées</b> y figurent - ce qui n’a pas été fait est en couverture, dans les tâches dues non réalisées. La <b>fiche de
          validation</b> du mois s’exporte à part (Rapports → Fiche de validation), en Excel ou en PDF.
          Chaque intervention embarque un échantillon de photos ; au-delà du plafond réglé, le serveur demande de resserrer le périmètre.
        </p>
        <div className="mt-4">
          <Button icon={FileText} loading={busy} disabled={!prestataireId || !lotId} onClick={editer}>Éditer le rapport PDF</Button>
        </div>
      </FormCard>
    </div>
  );
}
