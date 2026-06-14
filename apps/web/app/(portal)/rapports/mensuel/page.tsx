'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { FileText, Send, CheckCircle2 } from 'lucide-react';
import { api } from '@/lib/api';
import { downloadFile } from '@/lib/download';
import { PageHeader } from '@/components/shared/PageHeader';
import { FormCard, Field, Select, Input } from '@/components/shared/Form';
import { Button } from '@/components/shared/Button';
import { regionOptions } from '@/lib/constants';

const MOIS = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];

export default function RapportMensuelPage() {
  const now = new Date();
  const [annee, setAnnee] = useState(String(now.getFullYear()));
  const [mois, setMois] = useState(String(now.getMonth() + 1));
  const [region, setRegion] = useState('');
  const [destinataires, setDestinataires] = useState('');
  const [sentOk, setSentOk] = useState(false);

  const pdfPath = `/rapports/mensuel/${annee}/${mois}${region ? `?region=${region}` : ''}`;

  const sendMutation = useMutation({
    mutationFn: () =>
      api.post('/rapports/mensuel/send', {
        annee: Number(annee), mois: Number(mois), region: region || undefined,
        destinataires: destinataires.split(',').map((d) => d.trim()).filter(Boolean),
      }),
    onSuccess: () => setSentOk(true),
  });

  const anneesOptions = Array.from({ length: 5 }, (_, i) => {
    const y = now.getFullYear() - i;
    return { value: String(y), label: String(y) };
  });
  const moisOptions = MOIS.map((m, i) => ({ value: String(i + 1), label: m }));

  return (
    <div>
      <PageHeader title="Rapport mensuel" subtitle="Générer, consulter ou envoyer le rapport PDF" backHref="/rapports" />

      <FormCard>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
          <Field label="Année"><Select value={annee} onChange={(e) => setAnnee(e.target.value)} options={anneesOptions} /></Field>
          <Field label="Mois"><Select value={mois} onChange={(e) => setMois(e.target.value)} options={moisOptions} /></Field>
          <Field label="Région"><Select value={region} onChange={(e) => setRegion(e.target.value)} options={regionOptions} placeholder="Toutes" /></Field>
        </div>

        <div className="flex flex-wrap gap-2 mb-6">
          <button type="button" onClick={() => downloadFile(pdfPath, `rapport-${annee}-${mois}.pdf`, true)} className="inline-flex items-center gap-2 rounded-lg bg-[#1B3F6B] px-3.5 py-2 text-sm font-medium text-white hover:bg-[#2471A3]">
            <FileText size={15} /> Consulter le PDF
          </button>
        </div>

        <div className="border-t border-gray-100 pt-4">
          <Field label="Envoyer par email (adresses séparées par des virgules)">
            <Input value={destinataires} onChange={(e) => { setDestinataires(e.target.value); setSentOk(false); }} placeholder="manager@telecom.tg, direction@telecom.tg" />
          </Field>
          <div className="mt-3 flex items-center gap-3">
            <Button icon={Send} loading={sendMutation.isPending} disabled={!destinataires.trim()} onClick={() => { setSentOk(false); sendMutation.mutate(); }}>
              Envoyer le rapport
            </Button>
            {sentOk && <span className="flex items-center gap-1 text-sm text-green-600"><CheckCircle2 size={15} /> Envoyé</span>}
            {sendMutation.isError && <span className="text-sm text-red-500">Erreur lors de l&apos;envoi</span>}
          </div>
        </div>
      </FormCard>
    </div>
  );
}
