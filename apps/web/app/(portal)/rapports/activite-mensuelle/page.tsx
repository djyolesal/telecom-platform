'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FileText, Mail, CheckCircle2 } from 'lucide-react';
import { api } from '@/lib/api';
import { downloadFile } from '@/lib/download';
import { PageHeader } from '@/components/shared/PageHeader';
import { FormCard, Field, Input, Select, Textarea } from '@/components/shared/Form';
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
  // PASSIF ou SOLAIRE : deux contrats, deux découpages de lots. Déclaré AVANT
  // lotOptions qui en dépend.
  const [contrat, setContrat] = useState('PASSIF');
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
      (prestaDetail?.assignments ?? [])
        .filter((a: { scope: string }) =>
          contrat === 'SOLAIRE' ? a.scope === 'SOLAIRE' : a.scope === 'PASSIVE' || a.scope === 'LES_DEUX')
        .map((a: { lot: { id: string; code: string; nom: string } }) =>
          [a.lot.id, { value: a.lot.id, label: `${a.lot.code} - ${a.lot.nom}` }]),
    ).values(),
  ] as { value: string; label: string }[];

  // ENVOI PAR E-MAIL : le rapport et la fiche de validation partent en DEUX
  // pièces jointes distinctes, aux superviseurs qui valident la facturation.
  const [ouvertEnvoi, setOuvertEnvoi] = useState(false);
  const [destinataires, setDestinataires] = useState('');
  const [messageMail, setMessageMail] = useState('');
  const [envoiEnCours, setEnvoiEnCours] = useState(false);
  const [envoye, setEnvoye] = useState('');

  // Destinataires proposés : les comptes du prestataire qui ont une adresse.
  const { data: comptes } = useQuery({
    queryKey: ['utilisateurs-prestataire', prestataireId],
    queryFn: () => api.get('/users', { params: { prestataire_id: prestataireId, is_active: true, limit: 50 } })
      .then((r) => r.data.data as Array<{ email: string | null; nom: string; prenom: string }>),
    enabled: !!prestataireId && ouvertEnvoi,
  });
  const ouvrirEnvoi = () => {
    if (!prestataireId || !lotId) { setError('Sélectionnez un prestataire et un lot.'); return; }
    setError(''); setEnvoye(''); setOuvertEnvoi(true);
  };
  // Pré-remplissage une seule fois : l'utilisateur reste maître de la liste.
  useEffect(() => {
    if (!ouvertEnvoi || destinataires || !comptes?.length) return;
    const adresses = comptes.map((c) => c.email).filter(Boolean).join('\n');
    if (adresses) setDestinataires(adresses);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ouvertEnvoi, comptes]);

  const envoyer = async () => {
    const liste = destinataires.split(/[\n,;]+/).map((d) => d.trim()).filter(Boolean);
    if (!liste.length) { setError('Indiquez au moins un destinataire.'); return; }
    setError(''); setEnvoiEnCours(true);
    try {
      const r = await api.post('/maintenances/export/rapports/envoyer', {
        mois: `${annee}-${mois}`, lot_id: lotId, prestataire_id: prestataireId,
        ...(type ? { type } : {}),
        ...(contrat === 'SOLAIRE' ? { contrat: 'SOLAIRE' } : {}),
        destinataires: liste, message: messageMail || undefined,
      }, { timeout: 180_000 });
      const pieces = (r.data.data.pieces ?? []) as Array<{ nom: string; octets: number }>;
      const poids = pieces.reduce((t, p) => t + p.octets, 0);
      setEnvoye(`Envoyé à ${liste.length} destinataire(s) · ${pieces.length} pièces jointes (${Math.round(poids / 1024)} Ko)`);
      setOuvertEnvoi(false);
      setMessageMail('');
    } catch (e) {
      const rep = (e as { response?: { data?: { error?: string } } }).response;
      setError(rep?.data?.error ?? 'Envoi impossible - réessayez.');
    } finally {
      setEnvoiEnCours(false);
    }
  };

  const editer = async () => {
    if (!prestataireId || !lotId) { setError('Sélectionnez un prestataire et un lot : le rapport s’édite pour un lot d’un prestataire.'); return; }
    setError(''); setBusy(true);
    const q = new URLSearchParams({ mois: `${annee}-${mois}` });
    if (contrat === 'SOLAIRE') q.set('contrat', 'SOLAIRE');
    if (type) q.set('type', type);
    if (lotId) q.set('lot_id', lotId);
    if (prestataireId) q.set('prestataire_id', prestataireId);
    try {
      // 3 minutes : un lot de quarante sites demande le téléchargement et le
      // rééchantillonnage de centaines de photos à la première édition.
      await downloadFile(`/maintenances/export/rapports.pdf?${q}`, `rapport-activite${contrat === 'SOLAIRE' ? '-solaire' : ''}-${annee}-${mois}.pdf`, false, 180_000);
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
          <Field label="Contrat">
            <Select value={contrat} onChange={(e) => { setContrat(e.target.value); setLotId(''); }}
              options={[{ value: 'PASSIF', label: 'Maintenance passive' }, { value: 'SOLAIRE', label: 'Maintenance solaire' }]} />
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
        {envoye && (
          <div className="mt-4 flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
            <CheckCircle2 size={15} /> {envoye}
          </div>
        )}
        <div className="mt-5 flex flex-wrap gap-2">
          <Button icon={FileText} loading={busy} disabled={!prestataireId || !lotId} onClick={editer}>Éditer le rapport PDF</Button>
          <Button variant="secondary" icon={Mail} disabled={!prestataireId || !lotId} onClick={ouvrirEnvoi}>
            Envoyer par e-mail
          </Button>
        </div>
      </FormCard>

      {ouvertEnvoi && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={() => setOuvertEnvoi(false)}>
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="mb-1 text-lg font-bold text-gray-800">Envoyer le rapport</h2>
            <p className="mb-4 text-xs text-gray-500">
              Deux pièces jointes distinctes : le <b>rapport d’activité</b> du mois et la <b>fiche de validation</b> à
              signer. Une adresse par ligne.
            </p>
            {error && <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
            <Field label="Destinataires" required>
              <Textarea rows={3} value={destinataires} onChange={(e) => setDestinataires(e.target.value)}
                placeholder="superviseur@prestataire.tg" />
            </Field>
            <Field label="Message (facultatif)">
              <Textarea rows={3} value={messageMail} onChange={(e) => setMessageMail(e.target.value)}
                placeholder="Bonjour, veuillez trouver ci-joint…" />
            </Field>
            <div className="mt-4 flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setOuvertEnvoi(false)}>Annuler</Button>
              <Button type="button" icon={Mail} loading={envoiEnCours} onClick={envoyer}>Envoyer</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
