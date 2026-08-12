'use client';

import { useState } from 'react';

import { useParams, useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { MapPin, Fuel, Zap, Gauge, Pencil, Trash2, Building2, Navigation, QrCode } from 'lucide-react';
import { api } from '@/lib/api';
import { downloadFile } from '@/lib/download';
import { PageHeader } from '@/components/shared/PageHeader';
import { StatCard } from '@/components/shared/StatCard';
import { Button, ButtonLink } from '@/components/shared/Button';
import { Loading, ErrorState, EmptyState } from '@/components/shared/states';
import { DataTable } from '@/components/shared/DataTable';
import { NiveauStockBadge, StatutMaintBadge, StatutIncidentBadge } from '@/components/shared/Badge';
import { POWER_CONFIGS, STATUTS_GE, TYPES_PYLONE, FORMES_CUVE } from '@/lib/constants';
import { fmtDateTime, fmtNumber } from '@/lib/utils';
import { useTypesLiaison, couleurLiaison } from '@/lib/liaisons';
import { SearchSelect } from '@/components/shared/SearchSelect';
import { Select } from '@/components/shared/Form';

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
  // La transmission est le domaine du NOC : il peut rattacher un site à son
  // amont sans avoir la main sur le reste de la fiche.
  const canEditTransmission = canEdit || role === 'NOC';
  const [editTransmission, setEditTransmission] = useState(false);

  const remove = useMutation({
    mutationFn: () => api.delete(`/sites/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sites'] });
      router.push('/sites');
    },
  });

  const { data: typesPylone } = useQuery({
    queryKey: ['types-pylone'],
    queryFn: () => api.get('/types-pylone').then((r) => r.data.data as { code: string; libelle: string }[]),
  });
  const pyloneOptions = typesPylone?.map((t) => ({ value: t.code, label: t.libelle })) ?? TYPES_PYLONE;
  const { data: site, isLoading, isError } = useQuery({
    queryKey: ['site', id],
    queryFn: () => api.get(`/sites/${id}`).then((r) => r.data.data),
  });
  const { parCode: typesLiaisonParCode } = useTypesLiaison();
  // Chaîne de transmission AMONT (racine → … → ce site) avec l'état de chaque
  // maillon : au clic sur un site, on voit PAR OÙ il passe — et où ça casse.
  const { data: transmission } = useQuery({
    queryKey: ['site-transmission-fiche', id],
    queryFn: () => api.get(`/sites/${id}/transmission`).then((r) => r.data.data as {
      amont: { id: string; code: string; nom: string; typeLiaison: string | null }[];
      liaisonDuSite: string | null;
      technosCoupees: Record<string, string[]>;
    }),
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
        title={site.nom}
        subtitle={`${site.region}${site.ville ? ' · ' + site.ville : ''}`}
        backHref="/sites"
        actions={
          <>
            {site.latitude != null && site.longitude != null && (
              <a
                href={`https://www.google.com/maps/dir/?api=1&destination=${site.latitude},${site.longitude}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 rounded-lg bg-white border border-gray-200 px-3.5 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                <Navigation size={15} /> Itinéraire
              </a>
            )}
            {canEdit && (
              <Button
                variant="secondary"
                icon={QrCode}
                onClick={() => downloadFile(`/sites/${id}/etiquettes-qr.pdf`, `etiquettes-qr-${site.code}.pdf`, true)}
              >
                Étiquettes QR
              </Button>
            )}
            {canEdit && <ButtonLink href={`/sites/${id}/modifier`} variant="secondary" icon={Pencil}>Modifier</ButtonLink>}
            {isAdmin && (
              <Button
                variant="secondary"
                icon={Trash2}
                loading={remove.isPending}
                onClick={() => { if (confirm(`Désactiver le site ${site.nom} ? Il n'apparaîtra plus dans les listes.`)) remove.mutate(); }}
              >
                Supprimer
              </Button>
            )}
          </>
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
        {(site.parentTransmission || (site.enfantsTransmission?.length ?? 0) > 0) && (
          <div className="mb-3 rounded-lg bg-[#EAF1F8] px-4 py-2.5 text-sm">
            <span className="text-gray-500">Transmission : </span>
            {/* Fil d'Ariane AMONT : racine → … → ce site. Chaque maillon est
                cliquable, chaque flèche porte le type de liaison, un maillon
                en coupure est marqué en rouge — le chemin ET la casse. */}
            {(transmission?.amont?.length ?? 0) > 0 ? (
              <span className="inline-flex flex-wrap items-center gap-1.5 align-middle">
                {[...(transmission!.amont)].reverse().map((m, i, arr) => {
                  const technos = transmission!.technosCoupees[m.id] ?? [];
                  const enCoupure = technos.length > 0;
                  const liaisonVersEnfant = i < arr.length - 1 ? arr[i + 1].typeLiaison : transmission!.liaisonDuSite;
                  return (
                    <span key={m.id} className="inline-flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => router.push(`/sites/${m.id}`)}
                        title={enCoupure ? `En coupure : ${technos.join('/')}` : `${m.nom} (${m.code})`}
                        className={`rounded px-1.5 py-0.5 font-medium hover:underline ${enCoupure ? 'bg-red-50 text-red-700' : 'text-gray-800'}`}
                      >
                        {enCoupure && <span className="mr-1 inline-block h-2 w-2 rounded-full bg-[#C0392B] align-middle" />}
                        {m.nom}
                      </button>
                      <span className="flex items-center gap-0.5 text-gray-400">
                        {liaisonVersEnfant && (
                          <span className="rounded px-1 py-px text-[10px] font-bold text-white"
                            style={{ backgroundColor: couleurLiaison(liaisonVersEnfant) }}
                            title={typesLiaisonParCode.get(liaisonVersEnfant)?.libelle ?? liaisonVersEnfant}>
                            {liaisonVersEnfant}
                          </span>
                        )}
                        →
                      </span>
                    </span>
                  );
                })}
                <b className="text-gray-900">{site.nom}</b>
                {(transmission!.technosCoupees[id] ?? []).length > 0 && (
                  <span className="rounded bg-red-50 px-1.5 py-0.5 text-[11px] font-bold text-red-700">
                    en coupure : {transmission!.technosCoupees[id].join('/')}
                  </span>
                )}
              </span>
            ) : site.parentTransmission
              ? <>dépend de <b className="text-gray-800">{site.parentTransmission.nom}</b></>
              : <span className="text-gray-700">raccordement direct</span>}
            {!transmission?.amont?.length && site.typeLiaison && (
              <span
                className="ml-2 rounded-full px-2 py-0.5 text-[11px] font-bold text-white"
                style={{ backgroundColor: couleurLiaison(site.typeLiaison) }}
                title={typesLiaisonParCode.get(site.typeLiaison)?.libelle ?? site.typeLiaison}
              >
                {site.typeLiaison}
              </span>
            )}
            {(site.enfantsTransmission?.length ?? 0) > 0 && (
              <span className="text-gray-600"> · alimente <b>{site.enfantsTransmission.length}</b> site(s) en aval : {site.enfantsTransmission.map((e: { nom: string }) => e.nom).join(', ')}</span>
            )}
            {canEditTransmission && (
              <button
                type="button"
                onClick={() => setEditTransmission(true)}
                className="ml-3 inline-flex items-center gap-1 rounded border border-gray-200 bg-white px-2 py-0.5 text-xs text-gray-600 hover:bg-gray-50"
                title="Modifier le rattachement de transmission (site amont + type de liaison)"
              >
                <Pencil size={11} /> Rattacher
              </button>
            )}
          </div>
        )}
        {!site.parentTransmission && (site.enfantsTransmission?.length ?? 0) === 0 && canEditTransmission && (
          <div className="mb-3 rounded-lg bg-gray-50 px-4 py-2.5 text-sm text-gray-500">
            Aucune liaison de transmission déclarée.
            <button type="button" onClick={() => setEditTransmission(true)} className="ml-2 text-[#2471A3] underline hover:no-underline">
              Rattacher ce site à son amont
            </button>
          </div>
        )}
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
          <InfoRow label="Type de pylône" value={pyloneOptions.find((t) => t.value === site.typePylone)?.label ?? site.typePylone ?? '—'} />
          <InfoRow label="Climatiseur" value={site.hasClimatiseur ? 'Oui' : 'Non'} />
          <InfoRow label="Extincteurs" value={site.hasExtincteurs ? 'Oui' : 'Non'} />
          <InfoRow label="Volume cuve gasoil" value={site.cuveVolumeLitres != null ? `${fmtNumber(site.cuveVolumeLitres)} L` : '—'} />
          <InfoRow label="Forme de la cuve" value={FORMES_CUVE.find((f) => f.value === site.formeCuve)?.label ?? '—'} />
          <InfoRow label="Dimensions cuve" value={site.cuveDimensions || '—'} />
          <InfoRow label="Agent de sécurité" value={site.hasGardien ? 'Oui' : 'Non'} />
          <InfoRow label="Sté gardiennage" value={site.gardiennagePrestataire?.nom ?? site.societeGardiennage ?? '—'} />
          <InfoRow label="Téléphone site" value={site.telephoneSite ? <a href={`tel:${site.telephoneSite}`} className="text-[#2471A3] hover:underline">{site.telephoneSite}</a> : '—'} />
        </div>
        {site.groupes?.length > 0 && (
          <div className="mt-3 border-t border-gray-50 pt-3">
            <p className="mb-1.5 text-xs font-medium text-gray-500">Groupes électrogènes ({site.groupes.length})</p>
            <div className="flex flex-wrap gap-2">
              {site.groupes.map((g: { id: string; numero: number; puissanceKva: number; statut: string; marque?: string | null; heuresDepuisVidange?: number | null }) => {
                const seuil = site.intervalleVidangeHeures ?? 250;
                const vidangeDue = g.heuresDepuisVidange != null && g.heuresDepuisVidange >= seuil;
                return (
                  <span
                    key={g.id}
                    className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs ring-1 ring-inset ${vidangeDue ? 'bg-amber-50 text-amber-800 ring-amber-200' : 'bg-gray-50 text-gray-700 ring-gray-100'}`}
                    title={g.heuresDepuisVidange == null ? 'Vidange : aucune référence enregistrée' : `Heures depuis la dernière vidange (seuil ${seuil} h)`}
                  >
                    <b>GE n°{g.numero}</b>{g.marque ? ` · ${g.marque}` : ''} · {Number(g.puissanceKva).toFixed(0)} kVA · {STATUTS_GE.find((s) => s.value === g.statut)?.label ?? g.statut}
                    {g.heuresDepuisVidange != null && (
                      <span className={vidangeDue ? 'font-semibold' : 'text-gray-400'}>
                        · vidange {Math.round(g.heuresDepuisVidange)} / {seuil} h{vidangeDue ? ' ⚠' : ''}
                      </span>
                    )}
                  </span>
                );
              })}
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
              toolbar={false}
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
              toolbar={false}
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

      {editTransmission && (
        <TransmissionModal
          siteId={id}
          parentActuel={site.parentTransmissionId ?? ''}
          liaisonActuelle={site.typeLiaison ?? ''}
          onClose={() => setEditTransmission(false)}
          onSaved={() => {
            queryClient.invalidateQueries({ queryKey: ['site', id] });
            queryClient.invalidateQueries({ queryKey: ['site-transmission-fiche', id] });
            setEditTransmission(false);
          }}
        />
      )}
    </div>
  );
}

/** Rattachement de transmission (NOC/manager) : site amont + type de liaison. */
function TransmissionModal({ siteId, parentActuel, liaisonActuelle, onClose, onSaved }: {
  siteId: string; parentActuel: string; liaisonActuelle: string;
  onClose: () => void; onSaved: () => void;
}) {
  const [parentId, setParentId] = useState(parentActuel);
  const [liaison, setLiaison] = useState(liaisonActuelle);
  const [error, setError] = useState('');
  const { liste: typesLiaison } = useTypesLiaison();

  const { data: sites = [] } = useQuery({
    queryKey: ['sites-all'],
    queryFn: () => api.get('/sites', { params: { all: true } }).then((r) => r.data.data as { id: string; code: string; nom: string }[]),
  });

  const mutation = useMutation({
    mutationFn: () => api.put(`/sites/${siteId}/transmission`, {
      parentTransmissionId: parentId || null,
      typeLiaison: parentId ? liaison || null : null,
    }),
    onSuccess: onSaved,
    onError: (e: { response?: { data?: { error?: string } } }) =>
      setError(e.response?.data?.error ?? 'Enregistrement impossible'),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-4 text-lg font-bold text-gray-800">Rattachement de transmission</h2>
        {error && <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Site amont</label>
            <SearchSelect
              value={parentId}
              onChange={setParentId}
              options={sites.filter((s) => s.id !== siteId).map((s) => ({ value: s.id, label: `${s.code} — ${s.nom}` }))}
              placeholder="Rechercher un site (nom ou code)…"
              emptyLabel="Aucun (raccordement direct)"
            />
          </div>
          {parentId && (
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Type de liaison vers l&apos;amont</label>
              <Select value={liaison} onChange={(e) => setLiaison(e.target.value)}
                options={typesLiaison.map((t) => ({ value: t.code, label: `${t.code} — ${t.libelle}` }))}
                placeholder="(non renseigné)" />
            </div>
          )}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>Annuler</Button>
          <Button type="button" loading={mutation.isPending} onClick={() => { setError(''); mutation.mutate(); }}>Enregistrer</Button>
        </div>
      </div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <span className="text-gray-500">{label} : </span>
      <span className="font-medium text-gray-800">{value}</span>
    </div>
  );
}
