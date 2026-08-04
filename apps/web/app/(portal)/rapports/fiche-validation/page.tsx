'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FileSpreadsheet, Archive } from 'lucide-react';
import { api } from '@/lib/api';
import { downloadFile } from '@/lib/download';
import { PageHeader } from '@/components/shared/PageHeader';
import { FormCard, Field, Input, Select } from '@/components/shared/Form';
import { Button } from '@/components/shared/Button';

const MOIS = [
  { value: '1', label: 'Janvier' }, { value: '2', label: 'Février' }, { value: '3', label: 'Mars' },
  { value: '4', label: 'Avril' }, { value: '5', label: 'Mai' }, { value: '6', label: 'Juin' },
  { value: '7', label: 'Juillet' }, { value: '8', label: 'Août' }, { value: '9', label: 'Septembre' },
  { value: '10', label: 'Octobre' }, { value: '11', label: 'Novembre' }, { value: '12', label: 'Décembre' },
];

export default function FicheValidationPage() {
  const now = new Date();
  const [prestataireId, setPrestataireId] = useState('');
  const [lotId, setLotId] = useState('');
  const [annee, setAnnee] = useState(String(now.getFullYear()));
  const [mois, setMois] = useState(String(now.getMonth() + 1));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const { data: prestataires, isLoading: chargePrestataires } = useQuery({
    queryKey: ['prestataires-select'],
    queryFn: () => api.get('/prestataires', { params: { is_active: true, limit: 200 } }).then((r) => r.data.data),
  });
  const prestataireOptions = (prestataires ?? []).map((p: { id: string; nom: string }) => ({ value: p.id, label: p.nom }));

  // Lots passifs attribués au prestataire sélectionné.
  const { data: prestaDetail, isFetching: chargeLots } = useQuery({
    queryKey: ['prestataire-lots', prestataireId],
    queryFn: () => api.get(`/prestataires/${prestataireId}`).then((r) => r.data.data),
    enabled: !!prestataireId,
  });
  const lotOptions = [
    ...new Map(
      (prestaDetail?.assignments ?? [])
        .filter((a: { scope: string; lot?: { id: string } }) => a.scope === 'PASSIVE' || a.scope === 'LES_DEUX')
        .map((a: { lot: { id: string; code: string; nom: string } }) => [a.lot.id, { value: a.lot.id, label: `${a.lot.code} — ${a.lot.nom}` }]),
    ).values(),
  ] as { value: string; label: string }[];

  const [busyAll, setBusyAll] = useState(false);

  const download = async () => {
    if (!prestataireId) { setError('Sélectionnez un prestataire.'); return; }
    setError('');
    setBusy(true);
    try {
      const presta = (prestataires ?? []).find((p: { id: string; nom: string }) => p.id === prestataireId);
      const nom = (presta?.nom ?? 'prestataire').replace(/[^a-z0-9]+/gi, '_');
      const lotPart = lotId ? `&lot_id=${lotId}` : '';
      await downloadFile(`/rapports/fiche-validation?prestataire_id=${prestataireId}&annee=${annee}&mois=${mois}${lotPart}`, `fiche-validation-${nom}-${mois}-${annee}.xlsx`);
    } catch {
      setError('Échec du téléchargement. Vérifiez le prestataire et la période.');
    } finally {
      setBusy(false);
    }
  };

  const downloadAll = async () => {
    setError('');
    setBusyAll(true);
    try {
      await downloadFile(`/rapports/fiches-validation/batch?annee=${annee}&mois=${mois}`, `fiches-validation-${mois}-${annee}.zip`);
    } catch {
      setError('Échec de la génération groupée.');
    } finally {
      setBusyAll(false);
    }
  };

  return (
    <div>
      <PageHeader title="Fiche de validation mensuelle" subtitle="Travaux contractuels réalisés par prestataire, au format de validation" backHref="/rapports" />
      <FormCard>
        {error && <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-4 py-2.5 text-sm text-red-700">{error}</div>}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Field label="Prestataire" required className="md:col-span-3">
            <Select value={prestataireId} onChange={(e) => { setPrestataireId(e.target.value); setLotId(''); }} options={prestataireOptions} placeholder={chargePrestataires ? 'Chargement des prestataires…' : 'Sélectionner un prestataire…'} />
          </Field>
          <Field label="Lot / zone" className="md:col-span-3">
            <Select value={lotId} onChange={(e) => setLotId(e.target.value)} disabled={!prestataireId} options={lotOptions} placeholder={!prestataireId ? 'Choisissez d’abord un prestataire' : chargeLots ? 'Chargement des lots…' : 'Tous les lots du prestataire'} />
          </Field>
          <Field label="Mois" required>
            <Select value={mois} onChange={(e) => setMois(e.target.value)} options={MOIS} />
          </Field>
          <Field label="Année" required>
            <Input type="number" value={annee} onChange={(e) => setAnnee(e.target.value)} />
          </Field>
        </div>
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <Button variant="secondary" icon={Archive} loading={busyAll} onClick={downloadAll}>Générer toutes les fiches du mois (.zip)</Button>
          <Button icon={FileSpreadsheet} loading={busy} onClick={download}>Télécharger la fiche (.xlsx)</Button>
        </div>
        <p className="mt-3 text-xs text-gray-500">
          Pour chaque tâche contractuelle : <b>sites concernés</b> (éligibles dans le périmètre passif du prestataire),
          <b> réalisés dans le mois</b> (maintenances clôturées), et la <b>fréquence sur 6 mois</b>.
        </p>
      </FormCard>
    </div>
  );
}
