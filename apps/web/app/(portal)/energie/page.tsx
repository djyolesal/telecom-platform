'use client';

import { useState } from 'react';
import { useSession } from 'next-auth/react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Zap, Fuel, Clock, Banknote, Upload, X } from 'lucide-react';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/shared/PageHeader';
import { FilterBar } from '@/components/shared/FilterBar';
import { StatCard } from '@/components/shared/StatCard';
import { Button, ButtonLink } from '@/components/shared/Button';
import { Loading } from '@/components/shared/states';
import { fmtNumber, fmtFCFA } from '@/lib/utils';

export default function EnergiePage() {
  const [periode, setPeriode] = useState('180');
  const [importOpen, setImportOpen] = useState(false);
  const { data: session } = useSession();
  const isAdmin = (session?.user as { role?: string })?.role === 'ADMIN';

  const { data, isLoading } = useQuery({
    queryKey: ['conso-energie', periode],
    queryFn: () => api.get('/rapports/conso-energie', { params: { periode } }).then((r) => r.data.data),
  });

  const t = data?.totaux ?? {};

  return (
    <div>
      <PageHeader
        title="Énergie"
        subtitle="Consommation électrique & gasoil du parc"
        actions={
          <>
            {isAdmin && (
              <Button variant="secondary" icon={Upload} onClick={() => setImportOpen(true)}>Importer l&apos;historique</Button>
            )}
            <ButtonLink href="/energie/releves" variant="secondary">Relevés</ButtonLink>
            <ButtonLink href="/energie/rapports" variant="secondary">Graphiques</ButtonLink>
          </>
        }
      />
      {importOpen && <ImportRelevesModal onClose={() => setImportOpen(false)} />}

      <FilterBar
        filters={[
          { key: 'periode', label: 'Période', value: periode, options: [
            { value: '30', label: '30 jours' }, { value: '90', label: '90 jours' },
            { value: '180', label: '6 mois' }, { value: '365', label: '12 mois' },
          ], onChange: setPeriode },
        ]}
      />

      {isLoading ? (
        <Loading />
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard title="Consommation" value={`${fmtNumber(t.consoKwh)} kWh`} icon={Zap} color="bg-[#2471A3]" />
            <StatCard title="Gasoil consommé" value={`${fmtNumber(t.gasoilLitres)} L`} icon={Fuel} color="bg-[#0E7C6B]" />
            <StatCard title="Heures GE" value={`${fmtNumber(t.heuresGE)} h`} icon={Clock} color="bg-[#1B3F6B]" />
            <StatCard title="Coût estimé" value={fmtFCFA(t.coutFCFA)} icon={Banknote} color="bg-[#1B3F6B]" />
          </div>
          <p className="mt-4 text-xs text-gray-400">{fmtNumber(data?.nbReleves)} relevés sur la période sélectionnée.</p>
        </>
      )}
    </div>
  );
}

interface ImportRapport {
  lignes: number;
  relevesCEET: number;
  relevesGE: number;
  depotages: number;
  ignorees: number;
  exemplesIgnorees: { ligne: number; code: string; raison: string }[];
  purge: { releves: number; depotages: number } | null;
  dryRun: boolean;
}

/**
 * Import de l'historique (export Excel du système de tickets) : analyse d'abord
 * (aperçu sans écriture), puis import — avec remplacement optionnel de
 * l'existant (tous les relevés + dépotages actuels sont alors supprimés).
 */
function ImportRelevesModal({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [purge, setPurge] = useState(true);
  const [apercu, setApercu] = useState<ImportRapport | null>(null);

  const run = useMutation({
    mutationFn: async (dryRun: boolean) => {
      const fd = new FormData();
      fd.append('file', file as File);
      const r = await api.post(`/releves/import?dryRun=${dryRun}&purge=${purge}`, fd);
      return r.data.data as ImportRapport;
    },
    onSuccess: (rapport) => {
      if (rapport.dryRun) setApercu(rapport);
      else queryClient.invalidateQueries();
    },
  });

  const done = run.data && !run.data.dryRun;
  const errMsg = (run.error as { response?: { data?: { error?: string } } } | null)?.response?.data?.error;

  const Ligne = ({ label, value }: { label: string; value: React.ReactNode }) => (
    <div className="flex justify-between py-1 text-sm"><span className="text-gray-500">{label}</span><span className="font-medium text-gray-800">{value}</span></div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-base font-semibold text-gray-800">Importer l&apos;historique des relevés</h3>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
        </div>

        <p className="mb-3 text-sm text-gray-600">
          Fichier <b>.xlsx</b> exporté du système de tickets (colonnes <code className="text-xs">Code, type, dateDebut, dateFin, indexCEET, heureGE, heureGE2, qteAvant, qteLivre, volumeGasoil…</code>).
          Chaque ligne devient des relevés CEET/GE datés ; les lignes DEPOTAGE créent aussi les dépotages historiques. Les consommations sont recalculées entre relevés consécutifs.
        </p>

        <input
          type="file"
          accept=".xlsx"
          onChange={(e) => { setFile(e.target.files?.[0] ?? null); setApercu(null); run.reset(); }}
          className="mb-3 block w-full text-sm text-gray-600 file:mr-3 file:rounded-lg file:border-0 file:bg-gray-100 file:px-3 file:py-2 file:text-sm file:font-medium"
        />

        <label className="mb-4 flex items-start gap-2 text-sm text-gray-700">
          <input type="checkbox" checked={purge} onChange={(e) => { setPurge(e.target.checked); setApercu(null); }} className="mt-0.5" />
          <span>
            <b className="text-red-600">Remplacer l&apos;existant</b> — supprime d&apos;abord <b>tous</b> les relevés énergie et dépotages actuels, le fichier devient l&apos;unique historique.
          </span>
        </label>

        {apercu && !done && (
          <div className="mb-4 rounded-xl bg-gray-50 p-4">
            <p className="mb-2 text-xs font-semibold text-gray-500">APERÇU (rien n&apos;est encore écrit)</p>
            <Ligne label="Lignes lues" value={fmtNumber(apercu.lignes)} />
            <Ligne label="Relevés CEET" value={fmtNumber(apercu.relevesCEET)} />
            <Ligne label="Relevés GE" value={fmtNumber(apercu.relevesGE)} />
            <Ligne label="Dépotages" value={fmtNumber(apercu.depotages)} />
            <Ligne label="Lignes ignorées" value={fmtNumber(apercu.ignorees)} />
            {apercu.purge && (
              <Ligne label="Seront supprimés" value={<span className="text-red-600">{fmtNumber(apercu.purge.releves)} relevés · {fmtNumber(apercu.purge.depotages)} dépotages</span>} />
            )}
            {apercu.exemplesIgnorees.length > 0 && (
              <p className="mt-2 text-xs text-gray-400">
                Ex. ignorées : {apercu.exemplesIgnorees.slice(0, 3).map((i) => `L${i.ligne} ${i.code} (${i.raison})`).join(' · ')}
              </p>
            )}
          </div>
        )}

        {done && (
          <div className="mb-4 rounded-xl bg-green-50 p-4 text-sm text-green-800">
            ✓ Import terminé : {fmtNumber(run.data!.relevesCEET + run.data!.relevesGE)} relevés et {fmtNumber(run.data!.depotages)} dépotages chargés.
          </div>
        )}
        {errMsg && <p className="mb-3 text-sm text-red-600">{errMsg}</p>}

        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>{done ? 'Fermer' : 'Annuler'}</Button>
          {!done && !apercu && (
            <Button disabled={!file} loading={run.isPending} onClick={() => run.mutate(true)}>Analyser</Button>
          )}
          {!done && apercu && (
            <Button loading={run.isPending} onClick={() => run.mutate(false)}>
              {purge ? 'Remplacer et importer' : 'Importer'}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
