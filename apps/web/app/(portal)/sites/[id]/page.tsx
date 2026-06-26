'use client';

import { useParams, useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { MapPin, Fuel, Zap, Gauge, Pencil, Trash2, Building2 } from 'lucide-react';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/shared/PageHeader';
import { StatCard } from '@/components/shared/StatCard';
import { Button, ButtonLink } from '@/components/shared/Button';
import { Loading, ErrorState, EmptyState } from '@/components/shared/states';
import { DataTable } from '@/components/shared/DataTable';
import { NiveauStockBadge, StatutMaintBadge, StatutIncidentBadge } from '@/components/shared/Badge';
import { POWER_CONFIGS, STATUTS_GE, TYPES_PYLONE, FORMES_CUVE } from '@/lib/constants';
import { fmtDateTime, fmtNumber } from '@/lib/utils';

const SCOPE_LABELS: Record<string, string> = {
  PASSIVE: 'Passive',
  ACTIVE: 'Active',
  LES_DEUX: 'Passive + Active',
};

export default function SiteDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data: session } = useSession();
  const role = (session?.user as { role?: string })?.role ?? '';
  const canEdit = role === 'MANAGER' || role === 'ADMIN';
  const isAdmin = role === 'ADMIN';

  const remove = useMutation({
    mutationFn: () => api.delete(`/sites/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sites'] });
      router.push('/sites');
    },
  });

  const { data: site, isLoading, isError } = useQuery({
    queryKey: ['site', id],
    queryFn: () => api.get(`/sites/${id}`).then((r) => r.data.data),
  });
  const { data: stock } = useQuery({
    queryKey: ['site-stock', id],
    queryFn: () => api.get(`/sites/${id}/stock`).then((r) => r.data.data),
    enabled: !!site,
  });
  const { data: maint } = useQuery({
    queryKey: ['site-maint', id],
    queryFn: () => api.get(`/sites/${id}/maintenances`, { params: { limit: 5 } }).then((r) => r.data.data),
    enabled: !!site,
  });
  const { data: incidents } = useQuery({
    queryKey: ['site-incidents', id],
    queryFn: () => api.get(`/sites/${id}/incidents`, { params: { limit: 5 } }).then((r) => r.data.data),
    enabled: !!site,
  });
  const { data: taches } = useQuery({
    queryKey: ['site-taches', id],
    queryFn: () => api.get(`/sites/${id}/taches-preventives`).then((r) => r.data.data),
    enabled: !!site,
  });

  if (isLoading) return <Loading />;
  if (isError || !site) return <ErrorState message="Site introuvable" />;

  return (
    <div>
      <PageHeader
        title={`${site.code} — ${site.nom}`}
        subtitle={`${site.region}${site.ville ? ' · ' + site.ville : ''}`}
        backHref="/sites"
        actions={
          (canEdit || isAdmin) && (
            <>
              {canEdit && <ButtonLink href={`/sites/${id}/modifier`} variant="secondary" icon={Pencil}>Modifier</ButtonLink>}
              {isAdmin && (
                <Button
                  variant="secondary"
                  icon={Trash2}
                  loading={remove.isPending}
                  onClick={() => { if (confirm(`Désactiver le site ${site.code} ? Il n'apparaîtra plus dans les listes.`)) remove.mutate(); }}
                >
                  Supprimer
                </Button>
              )}
            </>
          )
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <StatCard title="Config énergie" value={POWER_CONFIGS.find((p) => p.value === site.powerConfig)?.label ?? site.powerConfig} icon={Zap} color="bg-[#2471A3]" />
        <StatCard title="Statut GE" value={STATUTS_GE.find((p) => p.value === site.statutGE)?.label ?? site.statutGE} icon={Gauge} color="bg-[#1B3F6B]" />
        <StatCard title="Stock gasoil" value={`${fmtNumber(stock?.stockLitres)} L`} subtitle={stock?.autonomieJours != null ? `Autonomie ${stock.autonomieJours} j` : undefined} icon={Fuel} color="bg-[#0E7C6B]" />
        <StatCard title="Puissance GE" value={`${Number(site.puissanceGEkva).toFixed(0)} kVA`} icon={MapPin} color="bg-[#1B3F6B]" />
      </div>

      <div className="mb-6 rounded-xl border border-gray-100 bg-white p-4">
        <h3 className="mb-3 flex items-center gap-1.5 text-sm font-semibold text-gray-700"><Building2 size={15} /> Rattachement</h3>
        {!site.lot ? (
          <p className="text-sm text-gray-500">Aucun lot rattaché — utilisez « Modifier » pour l&apos;affecter à un lot.</p>
        ) : (
          <div className="flex flex-wrap items-center gap-x-8 gap-y-2 text-sm">
            <div><span className="text-gray-500">Lot : </span><b className="text-gray-800">{site.lot.code}</b> — {site.lot.nom}</div>
            {site.lot.assignments?.length ? (
              site.lot.assignments.map((a: { id: string; scope: string; prestataire?: { nom: string } }) => (
                <div key={a.id} className="flex items-center gap-1.5">
                  <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-600">{SCOPE_LABELS[a.scope] ?? a.scope}</span>
                  <span className="text-gray-800">{a.prestataire?.nom ?? '—'}</span>
                </div>
              ))
            ) : (
              <span className="text-gray-400">Aucun prestataire attribué à ce lot.</span>
            )}
          </div>
        )}
      </div>

      <div className="mb-6 rounded-xl border border-gray-100 bg-white p-4">
        <h3 className="mb-3 text-sm font-semibold text-gray-700">Infrastructure</h3>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-x-8 gap-y-2 text-sm">
          <InfoRow label="Type de pylône" value={TYPES_PYLONE.find((t) => t.value === site.typePylone)?.label ?? '—'} />
          <InfoRow label="Climatiseur" value={site.hasClimatiseur ? 'Oui' : 'Non'} />
          <InfoRow label="Extincteurs" value={site.hasExtincteurs ? 'Oui' : 'Non'} />
          <InfoRow label="Volume cuve gasoil" value={site.cuveVolumeLitres != null ? `${fmtNumber(site.cuveVolumeLitres)} L` : '—'} />
          <InfoRow label="Forme de la cuve" value={FORMES_CUVE.find((f) => f.value === site.formeCuve)?.label ?? '—'} />
          <InfoRow label="Dimensions cuve" value={site.cuveDimensions || '—'} />
        </div>
        {site.groupes?.length > 0 && (
          <div className="mt-3 border-t border-gray-50 pt-3">
            <p className="mb-1.5 text-xs font-medium text-gray-500">Groupes électrogènes ({site.groupes.length})</p>
            <div className="flex flex-wrap gap-2">
              {site.groupes.map((g: { id: string; numero: number; puissanceKva: number; statut: string }) => (
                <span key={g.id} className="inline-flex items-center gap-1.5 rounded-full bg-gray-50 px-2.5 py-1 text-xs text-gray-700 ring-1 ring-inset ring-gray-100">
                  <b>GE n°{g.numero}</b> · {Number(g.puissanceKva).toFixed(0)} kVA · {STATUTS_GE.find((s) => s.value === g.statut)?.label ?? g.statut}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {taches && taches.length > 0 && (
        <div className="mb-6 rounded-xl border border-gray-100 bg-white p-4">
          <h3 className="mb-3 text-sm font-semibold text-gray-700">Tâches préventives contractuelles ({taches.length})</h3>
          <div className="space-y-1.5">
            {taches.map((t: { key: string; libelle: string; frequenceLabel: string; statut: string; prochaineEcheance: string | null }) => (
              <div key={t.key} className="flex items-center gap-3 text-sm">
                <span className={`inline-flex w-20 justify-center rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${
                  t.statut === 'EN_RETARD' ? 'bg-red-50 text-red-700 ring-red-100'
                  : t.statut === 'JAMAIS' ? 'bg-orange-50 text-orange-700 ring-orange-100'
                  : t.statut === 'A_JOUR' ? 'bg-green-50 text-green-700 ring-green-100'
                  : 'bg-gray-100 text-gray-500 ring-gray-200'}`}>
                  {t.statut === 'EN_RETARD' ? 'En retard' : t.statut === 'JAMAIS' ? 'Jamais' : t.statut === 'A_JOUR' ? 'À jour' : '—'}
                </span>
                <span className="flex-1 text-gray-700">{t.libelle}</span>
                <span className="text-xs text-gray-400">{t.frequenceLabel}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {stock && stock.niveauAlerte !== 'NA' && (
        <div className="mb-6 flex items-center gap-3 rounded-xl border border-gray-100 bg-white p-4 text-sm">
          <span className="text-gray-600">Niveau d&apos;alerte stock :</span>
          <NiveauStockBadge value={stock.niveauAlerte} />
          <span className="text-gray-400">·</span>
          <span className="text-gray-600">Conso estimée : <b>{fmtNumber(stock.litresMois)} L/mois</b></span>
          <span className="text-gray-400">·</span>
          <span className="text-gray-600">{fmtNumber(stock.coutMoisFCFA)} FCFA/mois</span>
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <section>
          <h3 className="font-semibold text-gray-700 text-sm mb-3">Maintenances récentes</h3>
          {!maint?.length ? (
            <EmptyState title="Aucune maintenance" />
          ) : (
            <DataTable<{ statut: string; datePlanifiee: string }>
              columns={[
                { key: 'equipement', header: 'Équipement' },
                { key: 'type', header: 'Type' },
                { key: 'statut', header: 'Statut', render: (m) => <StatutMaintBadge value={m.statut} /> },
                { key: 'datePlanifiee', header: 'Date', render: (m) => fmtDateTime(m.datePlanifiee) },
              ]}
              data={maint}
            />
          )}
        </section>

        <section>
          <h3 className="font-semibold text-gray-700 text-sm mb-3">Incidents récents</h3>
          {!incidents?.length ? (
            <EmptyState title="Aucun incident" />
          ) : (
            <DataTable<{ statut: string; dateOuverture: string }>
              columns={[
                { key: 'type', header: 'Type' },
                { key: 'severite', header: 'Sévérité' },
                { key: 'statut', header: 'Statut', render: (i) => <StatutIncidentBadge value={i.statut} /> },
                { key: 'dateOuverture', header: 'Ouverture', render: (i) => fmtDateTime(i.dateOuverture) },
              ]}
              data={incidents}
            />
          )}
        </section>
      </div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="text-gray-500">{label} : </span>
      <span className="font-medium text-gray-800">{value}</span>
    </div>
  );
}
