'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FileText } from 'lucide-react';
import { api } from '@/lib/api';
import { downloadFile } from '@/lib/download';
import { PageHeader } from '@/components/shared/PageHeader';
import { FormCard, Field, Input, Select } from '@/components/shared/Form';
import { Button } from '@/components/shared/Button';
import { regionOptions, STATUTS_MAINTENANCE, TYPES_MAINTENANCE } from '@/lib/constants';

/**
 * Recueil des rapports d'intervention : un document unique où chaque
 * intervention est rendue comme son rapport unitaire, précédé d'une synthèse
 * (curatif, incidents, pièces) et d'un visa contractuel.
 *
 * Sa place est ICI et non seulement sur la liste des maintenances : on l'édite
 * pour une période et un prestataire, comme les autres documents contractuels
 * (fiche de validation, rapport mensuel), pas au fil de la consultation.
 */
export default function RecueilMaintenancesPage() {
  const now = new Date();
  const [du, setDu] = useState(`${now.toISOString().slice(0, 7)}-01`);
  const [au, setAu] = useState(now.toISOString().slice(0, 10));
  const [prestataireId, setPrestataireId] = useState('');
  const [lotId, setLotId] = useState('');
  const [region, setRegion] = useState('');
  const [type, setType] = useState('');
  const [statut, setStatut] = useState('TERMINEE');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const { data: prestataires } = useQuery({
    queryKey: ['prestataires-select'],
    queryFn: () => api.get('/prestataires', { params: { is_active: true, limit: 200 } }).then((r) => r.data.data),
  });
  const prestataireOptions = (prestataires ?? []).map((p: { id: string; nom: string }) => ({ value: p.id, label: p.nom }));

  // Lots du prestataire choisi : proposer TOUS les lots quand aucun
  // prestataire n'est sélectionné n'aiderait pas — le lot sert à resserrer un
  // périmètre déjà attribué.
  const { data: prestaDetail } = useQuery({
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
    setError(''); setBusy(true);
    const q = new URLSearchParams({ du, au, statut });
    if (type) q.set('type', type);
    if (region) q.set('region', region);
    if (lotId) q.set('lot_id', lotId);
    if (prestataireId) q.set('prestataire_id', prestataireId);
    try {
      await downloadFile(`/maintenances/export/rapports.pdf?${q}`, `recueil-maintenances-${du}_${au}.pdf`);
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
        title="Recueil des rapports d'intervention"
        subtitle="Un document unique : chaque intervention au format du rapport unitaire, précédée de la synthèse du curatif et des pièces, avec visa contractuel"
        backHref="/rapports"
      />
      <FormCard>
        {error && <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Du"><Input type="date" value={du} onChange={(e) => setDu(e.target.value)} /></Field>
          <Field label="Au"><Input type="date" value={au} onChange={(e) => setAu(e.target.value)} /></Field>
          <Field label="Statut">
            <Select value={statut} onChange={(e) => setStatut(e.target.value)} options={STATUTS_MAINTENANCE} placeholder="Tous statuts" />
          </Field>
          <Field label="Prestataire">
            <Select value={prestataireId} onChange={(e) => { setPrestataireId(e.target.value); setLotId(''); }}
              options={prestataireOptions} placeholder="Tous prestataires" />
          </Field>
          <Field label="Lot">
            <Select value={lotId} onChange={(e) => setLotId(e.target.value)} options={lotOptions}
              placeholder={prestataireId ? 'Tous ses lots' : 'Choisir un prestataire d’abord'} />
          </Field>
          <Field label="Région">
            <Select value={region} onChange={(e) => setRegion(e.target.value)} options={regionOptions} placeholder="Toutes régions" />
          </Field>
          <Field label="Type">
            <Select value={type} onChange={(e) => setType(e.target.value)} options={TYPES_MAINTENANCE} placeholder="Tous types" />
          </Field>
        </div>
        <p className="mt-4 text-xs text-gray-500">
          Le <b>logo du prestataire</b> n’apparaît en couverture que si le recueil ne couvre qu’un prestataire.
          Chaque rapport embarque un échantillon de photos ; au-delà du plafond réglé, le serveur demande de resserrer la période.
        </p>
        <div className="mt-4">
          <Button icon={FileText} loading={busy} onClick={editer}>Éditer le recueil PDF</Button>
        </div>
      </FormCard>
    </div>
  );
}
