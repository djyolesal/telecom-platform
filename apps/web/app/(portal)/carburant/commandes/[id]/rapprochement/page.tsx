'use client';

import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, HelpCircle } from 'lucide-react';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/shared/PageHeader';
import { StatCard } from '@/components/shared/StatCard';
import { ExportButtons } from '@/components/shared/ExportButtons';
import { Loading, ErrorState, EmptyState } from '@/components/shared/states';
import { fmtNumber } from '@/lib/utils';

const MOIS = ['', 'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];

interface LigneMois {
  mois: number; commande: number; charge: number; planifie: number;
  livrePlan: number; livreHorsPlan: number; livreTotal: number;
  retourDepot: number; perte: number; report: number;
  ecartNonExplique: number; nbBl: number; nbBlNonClos: number;
}
interface LigneSite {
  siteId: string; siteCode: string; siteNom: string; region: string;
  stockDebut: number | null; stockFin: number | null; livre: number;
  consoReelle: number | null; consoTheorique: number | null; ecart: number | null;
  mesure: boolean; motifNonMesure: string | null;
}
interface Rapprochement {
  bc: { id: string; numero: string; annee: number; trimestre: number; statut: string };
  periode: { moisMin: number; moisMax: number };
  lignesMois: LigneMois[];
  conservation: LigneSite[];
  totaux: {
    commande: number; charge: number; planifie: number;
    livrePlan: number; livreHorsPlan: number; livreTotal: number;
    retourDepot: number; perte: number; report: number; ecartNonExplique: number;
    nbBl: number; nbBlNonClos: number; nbSites: number; nbSitesMesures: number; consoReelleLitres: number;
  };
}

const L = (v: number | null) => (v == null ? <span className="text-gray-300">—</span> : fmtNumber(v));
// Écart non expliqué : rouge dès qu'il est positif — c'est du carburant chargé
// dont personne ne sait dire où il est passé.
const ecartCell = (v: number) => (
  <span className={Math.abs(v) < 1 ? 'text-gray-400' : v > 0 ? 'font-semibold text-red-600' : 'font-semibold text-blue-600'}>
    {Math.abs(v) < 1 ? '—' : fmtNumber(v)}
  </span>
);

export default function RapprochementPage() {
  const { id } = useParams<{ id: string }>();
  const { data, isLoading, isError } = useQuery({
    queryKey: ['rapprochement', id],
    queryFn: () => api.get(`/rapports/rapprochement/${id}`).then((r) => r.data.data as Rapprochement),
  });

  if (isLoading) return <Loading />;
  if (isError || !data) return <div className="p-6"><ErrorState /></div>;
  const t = data.totaux;
  const nonMesures = data.conservation.filter((c) => !c.mesure);

  return (
    <div>
      <PageHeader
        title={`Rapprochement carburant — BC ${data.bc.numero}`}
        subtitle={`T${data.bc.trimestre} ${data.bc.annee} · ${MOIS[data.periode.moisMin]} → ${MOIS[data.periode.moisMax]} · ${t.nbBl} chargement(s)`}
        backHref={`/carburant/commandes/${id}`}
        actions={<ExportButtons base={`/rapports/rapprochement/${id}/export`} name={`rapprochement-${data.bc.numero}`} />}
      />

      <div className="mb-5 grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard title="Commandé" value={`${fmtNumber(t.commande)} L`} icon={CheckCircle2} color="bg-[#1B3F6B]" />
        <StatCard title="Chargé" value={`${fmtNumber(t.charge)} L`} icon={CheckCircle2} color="bg-[#2471A3]" />
        <StatCard title="Livré sur sites" value={`${fmtNumber(t.livreTotal)} L`} icon={CheckCircle2} color="bg-[#148F77]" />
        <StatCard title="Écart non expliqué" value={`${fmtNumber(t.ecartNonExplique)} L`} icon={AlertTriangle} color={t.ecartNonExplique > 0 ? 'bg-[#C0392B]' : 'bg-[#7F8C8D]'} />
      </div>

      {t.nbBlNonClos > 0 && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {t.nbBlNonClos} chargement(s) ne sont pas clôturés : leur reste en citerne n’est pas encore ventilé, l’écart non expliqué
          ci-dessous les compte donc en totalité.
        </div>
      )}

      {/* ── Volet logistique : où sont partis les litres commandés ── */}
      <div className="mb-4 overflow-x-auto rounded-xl border border-gray-100 bg-white p-5">
        <h3 className="mb-1 text-sm font-semibold text-gray-700">Volet logistique — du bon de commande au site</h3>
        <p className="mb-3 text-xs text-gray-500">
          Écart non expliqué = chargé − livré − retour dépôt − perte − report. C’est la colonne à lire.
        </p>
        <table className="w-full min-w-[900px] text-sm">
          <thead>
            <tr className="border-b text-xs text-gray-500">
              <th className="py-2 text-left">Mois</th>
              <th className="text-right">Commandé</th>
              <th className="text-right">Chargé</th>
              <th className="text-right">Planifié</th>
              <th className="text-right">Livré</th>
              <th className="text-right">dont hors plan</th>
              <th className="text-right">Retour dépôt</th>
              <th className="text-right">Perte</th>
              <th className="text-right">Report</th>
              <th className="text-right">Non expliqué</th>
            </tr>
          </thead>
          <tbody>
            {data.lignesMois.map((l) => (
              <tr key={l.mois} className="border-b last:border-0">
                <td className="py-2 font-medium text-gray-800">{MOIS[l.mois]}</td>
                <td className="text-right">{L(l.commande)}</td>
                <td className="text-right">{L(l.charge)}</td>
                <td className="text-right text-gray-500">{L(l.planifie)}</td>
                <td className="text-right">{L(l.livreTotal)}</td>
                <td className="text-right text-gray-500">{l.livreHorsPlan > 0 ? fmtNumber(l.livreHorsPlan) : '—'}</td>
                <td className="text-right">{l.retourDepot > 0 ? fmtNumber(l.retourDepot) : <span className="text-gray-300">—</span>}</td>
                <td className="text-right">{l.perte > 0 ? <span className="font-semibold text-red-600">{fmtNumber(l.perte)}</span> : <span className="text-gray-300">—</span>}</td>
                <td className="text-right">{l.report > 0 ? fmtNumber(l.report) : <span className="text-gray-300">—</span>}</td>
                <td className="text-right">{ecartCell(l.ecartNonExplique)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 font-semibold text-gray-800">
              <td className="py-2">Total</td>
              <td className="text-right">{fmtNumber(t.commande)}</td>
              <td className="text-right">{fmtNumber(t.charge)}</td>
              <td className="text-right">{fmtNumber(t.planifie)}</td>
              <td className="text-right">{fmtNumber(t.livreTotal)}</td>
              <td className="text-right">{fmtNumber(t.livreHorsPlan)}</td>
              <td className="text-right">{fmtNumber(t.retourDepot)}</td>
              <td className="text-right">{fmtNumber(t.perte)}</td>
              <td className="text-right">{fmtNumber(t.report)}</td>
              <td className="text-right">{ecartCell(t.ecartNonExplique)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* ── Volet physique : équation de conservation par site ── */}
      <div className="overflow-x-auto rounded-xl border border-gray-100 bg-white p-5">
        <h3 className="mb-1 text-sm font-semibold text-gray-700">Volet physique — équation de conservation par site</h3>
        <p className="mb-3 text-xs text-gray-500">
          stock début + livré − consommé = stock fin. La consommation théorique vient des heures compteur × débit des GE actifs ;
          l’écart positif est une surconsommation (fuite, vol, ou heures mal déclarées).
          {' '}{t.nbSitesMesures}/{t.nbSites} sites mesurables sur la période.
        </p>
        {data.conservation.length === 0 ? (
          <EmptyState title="Aucun site livré sur ce bon de commande" />
        ) : (
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b text-xs text-gray-500">
                <th className="py-2 text-left">Site</th>
                <th className="text-left">Région</th>
                <th className="text-right">Stock début</th>
                <th className="text-right">Livré</th>
                <th className="text-right">Stock fin</th>
                <th className="text-right">Consommé réel</th>
                <th className="text-right">Théorique</th>
                <th className="text-right">Écart</th>
              </tr>
            </thead>
            <tbody>
              {data.conservation.map((c) => (
                <tr key={c.siteId} className={`border-b last:border-0 ${!c.mesure ? 'bg-gray-50/60' : ''}`}>
                  <td className="py-2 font-medium text-gray-800">
                    {c.siteCode}
                    {!c.mesure && (
                      <span className="ml-1.5 inline-flex items-center gap-1 text-[11px] font-normal text-gray-400" title={c.motifNonMesure ?? ''}>
                        <HelpCircle size={12} /> non mesuré
                      </span>
                    )}
                  </td>
                  <td className="text-gray-600">{c.region}</td>
                  <td className="text-right">{L(c.stockDebut)}</td>
                  <td className="text-right">{L(c.livre)}</td>
                  <td className="text-right">{L(c.stockFin)}</td>
                  <td className="text-right font-medium">{L(c.consoReelle)}</td>
                  <td className="text-right text-gray-500">{L(c.consoTheorique)}</td>
                  <td className="text-right">{c.ecart == null ? <span className="text-gray-300">—</span> : ecartCell(c.ecart)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {nonMesures.length > 0 && (
          <p className="mt-3 text-xs text-gray-500">
            {nonMesures.length} site(s) sans deux relevés de cuve sur la période : leur consommation n’est pas calculable et
            n’est comptée nulle part — elle n’est pas supposée nulle.
          </p>
        )}
      </div>
    </div>
  );
}
