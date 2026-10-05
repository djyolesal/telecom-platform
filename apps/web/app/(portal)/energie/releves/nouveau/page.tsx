'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Save } from 'lucide-react';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/shared/PageHeader';
import { Loading } from '@/components/shared/states';
import { Button } from '@/components/shared/Button';
import { Field, Input, Textarea } from '@/components/shared/Form';
import { SearchSelect } from '@/components/shared/SearchSelect';

interface SiteLeger { id: string; code: string; nom: string; region: string }
interface Groupe { id: string; numero: number; puissanceKva?: number | string | null }
interface SiteDetail {
  id: string; nom: string; powerConfig: string; statutGE: string;
  groupes?: Groupe[];
}
interface Technicien { id: string; nom: string; prenom: string }
interface Avertissement { code: string; champ: string; message: string }
interface Enregistre { id: string; source: string; groupeId: string | null }

type Source = 'CEET' | 'GE' | 'SOLAIRE';

/** Miroir de `sourcesForConfig` (API) : quelles mesures ce site peut-il avoir ? */
function sourcesDuSite(powerConfig: string): Source[] {
  switch (powerConfig) {
    case 'CEET_GE':
    case 'HYBRIDE_CEET_GE': return ['CEET', 'GE'];
    case 'CEET_UNIQUEMENT': return ['CEET'];
    case 'GE_UNIQUEMENT': return ['GE'];
    case 'HYBRIDE_GE': return ['GE', 'SOLAIRE'];
    case 'SOLAIRE_UNIQUEMENT': return ['SOLAIRE'];
    default: return [];
  }
}

const LIBELLE_CONFIG: Record<string, string> = {
  CEET_GE: 'CEET + groupe électrogène', CEET_UNIQUEMENT: 'CEET seule', GE_UNIQUEMENT: 'groupe électrogène seul',
  HYBRIDE_GE: 'hybride solaire + groupe', HYBRIDE_CEET_GE: 'hybride CEET + groupe', SOLAIRE_UNIQUEMENT: 'solaire seul',
};

/** « 2026-09-10T08:30 » : la valeur d'un champ date-heure pour l'instant donné, à la minute. */
const pourChamp = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

const message = (e: unknown): string =>
  (e as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Enregistrement impossible.';

export default function NouveauReleveHorsAppPage() {
  const { data: session, status } = useSession();
  const role = (session?.user as { role?: string })?.role ?? '';
  const queryClient = useQueryClient();

  const [siteId, setSiteId] = useState('');
  const [date, setDate] = useState('');
  // Borne haute du champ date : calculée APRÈS le montage - la page est
  // prérendue à la construction, une valeur calculée ici serait figée.
  const [maxDate, setMaxDate] = useState('');
  useEffect(() => { setMaxDate(pourChamp(new Date())); }, []);

  const [technicienId, setTechnicienId] = useState('');
  const [observations, setObservations] = useState('');
  const [ceet, setCeet] = useState('');
  const [jauge, setJauge] = useState('');
  const [hauteur, setHauteur] = useState('');
  const [heures, setHeures] = useState<Record<string, string>>({});
  const [solaire, setSolaire] = useState('');

  const [avertissements, setAvertissements] = useState<Avertissement[] | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [fait, setFait] = useState<{ releves: Enregistre[]; avertissements: Avertissement[]; site: string } | null>(null);

  const { data: sites } = useQuery({
    queryKey: ['sites-legers'],
    queryFn: () => api.get('/sites', { params: { all: true, light: true } }).then((r) => r.data.data as SiteLeger[]),
    staleTime: 5 * 60_000,
  });
  const { data: techniciens } = useQuery({
    queryKey: ['techniciens-actifs'],
    queryFn: () => api.get('/users', { params: { role: 'TECHNICIEN', is_active: true, limit: 200 } })
      .then((r) => r.data.data as Technicien[]),
    staleTime: 5 * 60_000,
  });
  const { data: site, isFetching: siteEnCours } = useQuery({
    queryKey: ['site-saisie', siteId],
    queryFn: () => api.get(`/sites/${siteId}`).then((r) => r.data.data as SiteDetail),
    enabled: !!siteId,
  });

  const sources = useMemo(() => (site ? sourcesDuSite(site.powerConfig) : []), [site]);
  const groupes = site?.groupes ?? [];

  const remettreLesMesures = () => {
    setCeet(''); setJauge(''); setHauteur(''); setHeures({}); setSolaire('');
    setAvertissements(null); setErreur(null);
  };
  // Changer de site change ce qu'il y a à saisir : on repart de zéro plutôt que
  // de laisser un index de l'un se retrouver sur l'autre.
  const choisirSite = (id: string) => { setSiteId(id); remettreLesMesures(); setFait(null); };

  const corps = (confirmer: boolean) => {
    const indexGE = Object.entries(heures)
      .filter(([, v]) => v.trim() !== '')
      .map(([cle, v]) => ({ groupeId: cle === '_' ? undefined : cle, indexHeuresGE: v }));
    const geSaisi = jauge.trim() !== '' || hauteur.trim() !== '' || indexGE.length > 0;
    return {
      siteId,
      dateReleve: date ? new Date(date).toISOString() : undefined,
      technicienId: technicienId || undefined,
      observations: observations.trim() || undefined,
      ...(sources.includes('CEET') && ceet.trim() ? { ceet: { indexCompteur: ceet } } : {}),
      ...(sources.includes('GE') && geSaisi
        ? { ge: { volumeGasoilLitres: jauge || undefined, hauteurCuveCm: hauteur || undefined, groupes: indexGE } }
        : {}),
      ...(sources.includes('SOLAIRE') && solaire.trim() ? { solaire: { puissanceKva: solaire } } : {}),
      ...(confirmer ? { confirmerVraisemblance: true } : {}),
    };
  };

  const enregistrer = useMutation({
    mutationFn: (confirmer: boolean) => api.post('/releves/hors-app', corps(confirmer)).then((r) => r.data),
    onSuccess: (r) => {
      setAvertissements(null); setErreur(null);
      setFait({ releves: r.data, avertissements: r.avertissements ?? [], site: site?.nom ?? '' });
      // Tout ce qui lit des relevés doit se rafraîchir.
      for (const k of ['releves', 'stock-carburant', 'bilan-carburant', 'bilan-energie']) {
        queryClient.invalidateQueries({ queryKey: [k] });
      }
    },
    onError: (e: { response?: { data?: { confirmationRequise?: boolean; avertissements?: Avertissement[] } } }) => {
      const d = e.response?.data;
      if (d?.confirmationRequise) { setAvertissements(d.avertissements ?? []); setErreur(null); }
      else { setAvertissements(null); setErreur(message(e)); }
    },
  });

  if (status === 'loading') return <Loading />;
  if (role !== 'ADMIN') {
    return (
      <div>
        <PageHeader title="Saisir un relevé hors application" backHref="/energie/releves" />
        <p className="text-sm text-gray-500">Cette saisie est réservée à l&apos;administrateur.</p>
      </div>
    );
  }

  const optionsSites = (sites ?? []).map((s) => ({ value: s.id, label: `${s.code} · ${s.nom}` }));
  const aSaisi = !!(ceet.trim() || jauge.trim() || hauteur.trim() || solaire.trim() || Object.values(heures).some((v) => v.trim()));
  const pret = !!siteId && !!date && aSaisi && sources.length > 0;

  // ── Écran de fin : ce qui a été enregistré, et de quoi enchaîner ──
  if (fait) {
    return (
      <div>
        <PageHeader title="Relevé enregistré" backHref="/energie/releves" />
        <div className="max-w-2xl rounded-xl border border-green-200 bg-green-50 p-5">
          <p className="flex items-center gap-2 font-semibold text-green-800"><CheckCircle2 size={18} /> {fait.releves.length} ligne(s) enregistrée(s) pour {fait.site}</p>
          <p className="mt-1 text-sm text-green-800">
            Ces relevés sont marqués « Hors application » et alimentent les mêmes rapports que ceux du mobile.
            Les consommations du relevé suivant ont été recalculées pour ne pas compter deux fois la même période.
          </p>
          {fait.avertissements.length > 0 && (
            <p className="mt-2 text-sm text-amber-800">Valeurs inhabituelles confirmées : {fait.avertissements.map((a) => a.code).join(', ')} (tracées dans les anomalies de saisie).</p>
          )}
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button icon={Save} onClick={() => { setFait(null); remettreLesMesures(); }}>Saisir un autre relevé sur ce site</Button>
          <Button variant="secondary" onClick={() => { setFait(null); choisirSite(''); setDate(''); }}>Changer de site</Button>
          <Link href="/energie/releves" className="inline-flex items-center rounded-lg border border-gray-200 bg-white px-3.5 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">Voir les relevés</Link>
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Saisir un relevé hors application"
        subtitle="Relevé pris sur le terrain sans passer par l'application : fiche papier, message, rattrapage"
        backHref="/energie/releves"
      />

      <div className="max-w-3xl space-y-5">
        <div className="rounded-xl border border-gray-100 bg-white p-5">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Field label="Site" required>
              <SearchSelect value={siteId} onChange={choisirSite} options={optionsSites} placeholder="Rechercher un site…" />
            </Field>
            <Field label="Date et heure de la mesure" required hint="Celle de la mesure sur le terrain, pas d'aujourd'hui.">
              <Input type="datetime-local" value={date} max={maxDate || undefined} onChange={(e) => setDate(e.target.value)} />
            </Field>
            <Field label="Relevé pris par" hint="Facultatif : la personne qui a fait la mesure.">
              <SearchSelect
                value={technicienId} onChange={setTechnicienId} emptyLabel="Non précisé"
                options={(techniciens ?? []).map((t) => ({ value: t.id, label: `${t.prenom} ${t.nom}` }))}
                placeholder="Rechercher un technicien…"
              />
            </Field>
            <Field label="Source du relevé" hint="Fiche papier, message, appel… pour retrouver d'où vient le chiffre.">
              <Textarea value={observations} maxLength={500} onChange={(e) => setObservations(e.target.value)}
                className="min-h-[42px]" rows={2} placeholder="Ex. fiche papier du technicien, reçue le 12/09" />
            </Field>
          </div>
        </div>

        {siteId && siteEnCours && <Loading />}

        {site && sources.length === 0 && (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            La configuration d&apos;énergie de ce site n&apos;est pas renseignée : aucune mesure n&apos;est attendue. Corrigez la fiche du site.
          </p>
        )}

        {site && sources.length > 0 && (
          <>
            <p className="text-xs text-gray-500">
              {site.nom} : {LIBELLE_CONFIG[site.powerConfig] ?? site.powerConfig}. Ne renseignez que les mesures réellement prises.
            </p>

            {sources.includes('CEET') && (
              <div className="rounded-xl border border-gray-100 bg-white p-5">
                <h2 className="mb-3 text-sm font-semibold text-gray-700">Compteur CEET</h2>
                <Field label="Index du compteur (kWh)">
                  <Input inputMode="decimal" value={ceet} onChange={(e) => setCeet(e.target.value)} placeholder="Ex. 15 420" />
                </Field>
              </div>
            )}

            {sources.includes('GE') && (
              <div className="rounded-xl border border-gray-100 bg-white p-5">
                <h2 className="mb-3 text-sm font-semibold text-gray-700">Groupe électrogène et cuve</h2>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <Field label="Volume de gasoil dans la cuve (L)">
                    <Input inputMode="decimal" value={jauge} onChange={(e) => setJauge(e.target.value)} placeholder="Ex. 650" />
                  </Field>
                  <Field label="ou hauteur mesurée (cm)" hint="Si la cuve a un barème, les litres sont calculés pour vous.">
                    <Input inputMode="decimal" value={hauteur} onChange={(e) => setHauteur(e.target.value)} placeholder="Ex. 42" />
                  </Field>
                  {groupes.length === 0 ? (
                    <Field label="Index horaire du groupe (h)">
                      <Input inputMode="decimal" value={heures._ ?? ''} onChange={(e) => setHeures((p) => ({ ...p, _: e.target.value }))} />
                    </Field>
                  ) : groupes.map((g) => (
                    <Field key={g.id} label={`Index horaire du groupe n°${g.numero}${g.puissanceKva ? ` (${Number(g.puissanceKva)} kVA)` : ''} (h)`}>
                      <Input inputMode="decimal" value={heures[g.id] ?? ''} onChange={(e) => setHeures((p) => ({ ...p, [g.id]: e.target.value }))} />
                    </Field>
                  ))}
                </div>
              </div>
            )}

            {sources.includes('SOLAIRE') && (
              <div className="rounded-xl border border-gray-100 bg-white p-5">
                <h2 className="mb-3 text-sm font-semibold text-gray-700">Production solaire</h2>
                <Field label="Puissance (kVA)">
                  <Input inputMode="decimal" value={solaire} onChange={(e) => setSolaire(e.target.value)} placeholder="Ex. 3,5" />
                </Field>
              </div>
            )}
          </>
        )}

        {avertissements && (
          <div className="rounded-xl border border-amber-300 bg-amber-50 p-5">
            <p className="flex items-center gap-2 font-semibold text-amber-900"><AlertTriangle size={17} /> Des valeurs semblent inhabituelles</p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-amber-900">
              {avertissements.map((a, i) => <li key={i}>{a.message}</li>)}
            </ul>
            <p className="mt-2 text-xs text-amber-800">Rien n&apos;a été enregistré. Corrigez la saisie, ou confirmez si elle est exacte (compteur remplacé, par exemple) : l&apos;anomalie sera tracée.</p>
            <div className="mt-3 flex gap-2">
              <Button variant="secondary" onClick={() => setAvertissements(null)}>Corriger la saisie</Button>
              <Button variant="danger" loading={enregistrer.isPending} onClick={() => enregistrer.mutate(true)}>Confirmer et enregistrer</Button>
            </div>
          </div>
        )}

        {erreur && <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{erreur}</p>}

        {!avertissements && (
          <div className="flex items-center gap-3">
            <Button icon={Save} loading={enregistrer.isPending} disabled={!pret} onClick={() => { setErreur(null); enregistrer.mutate(false); }}>
              Enregistrer le relevé
            </Button>
            {!pret && siteId && <span className="text-xs text-gray-400">Renseignez la date et au moins une mesure.</span>}
          </div>
        )}
      </div>
    </div>
  );
}
