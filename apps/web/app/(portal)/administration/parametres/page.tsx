'use client';

import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Save, CheckCircle2, Upload, RotateCcw } from 'lucide-react';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/shared/PageHeader';
import { Loading, EmptyState } from '@/components/shared/states';
import { Button } from '@/components/shared/Button';

interface Setting {
  key: string;
  value: unknown;
  description?: string;
}

interface SmsTemplate {
  key: string; label: string; defaut: string; variables: string[];
  valeur: string | null; // personnalisation, null = défaut
}

export default function ParametresPage() {
  const queryClient = useQueryClient();
  const [edited, setEdited] = useState<Record<string, string>>({});
  const [savedOk, setSavedOk] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['settings'],
    queryFn: () => api.get('/admin/settings').then((r) => r.data.data as Setting[]),
  });

  // Modèles de SMS : édition à part (textarea + variables), même endpoint de
  // sauvegarde — une valeur vide ou identique au défaut = retour au défaut.
  const { data: tpls } = useQuery({
    queryKey: ['sms-templates'],
    queryFn: () => api.get('/admin/sms-templates').then((r) => r.data.data as SmsTemplate[]),
  });
  // CANAUX SMS : sur un téléphone, c'est l'EXPÉDITEUR qui crée le fil de
  // discussion — un seul expéditeur et tout s'empile au même endroit.
  const { data: canaux } = useQuery({
    queryKey: ['sms-canaux'],
    queryFn: () => api.get('/admin/sms-canaux').then(
      (r) => r.data.data as { code: string; label: string; etiquetteDefaut: string; expediteur: string | null; etiquette: string }[]
    ),
  });
  const [canalEdits, setCanalEdits] = useState<Record<string, string>>({});
  useEffect(() => {
    if (canaux) {
      const init: Record<string, string> = {};
      canaux.forEach((c) => {
        init[`sms.canal.${c.code}.expediteur`] = c.expediteur ?? '';
        init[`sms.canal.${c.code}.etiquette`] = c.etiquette;
      });
      setCanalEdits(init);
    }
  }, [canaux]);
  const saveCanaux = useMutation({
    mutationFn: () => api.put('/admin/settings', Object.entries(canalEdits).map(([key, value]) => ({
      key, value, description: 'Canal SMS',
    }))),
    onSuccess: () => { setSavedOk(true); queryClient.invalidateQueries({ queryKey: ['sms-canaux'] }); },
  });
  // LOGO DU CLIENT : il part sur des documents contractuels signés (fiche de
  // validation, rapport mensuel d'activité). Tant qu'aucun n'est déposé, la
  // plateforme utilise la marque livrée avec elle — un document ne sort jamais
  // sans enseigne.
  const { data: logoClient } = useQuery({
    queryKey: ['logo-client'],
    queryFn: () => api.get('/admin/logo-client').then(
      (r) => r.data.data as { source: 'parametre' | 'environnement' | 'defaut' | 'aucun'; cle: string | null; dataUrl: string | null }
    ),
  });
  const [logoBusy, setLogoBusy] = useState(false);
  const [logoErreur, setLogoErreur] = useState('');
  const enregistrerLogo = async (cle: string) => {
    await api.put('/admin/settings', [{ key: 'client.logoKey', value: cle, description: 'Logo du client sur les documents contractuels' }]);
    queryClient.invalidateQueries({ queryKey: ['logo-client'] });
    queryClient.invalidateQueries({ queryKey: ['settings'] });
    setSavedOk(true);
  };
  const televerserLogo = async (file: File) => {
    setLogoBusy(true); setLogoErreur(''); setSavedOk(false);
    try {
      const fd = new FormData();
      fd.append('folder', 'logos');
      fd.append('file', file);
      const r = await api.post('/upload/image', fd);
      await enregistrerLogo(r.data.data.key);
    } catch {
      setLogoErreur('Échec de l’envoi du logo. Formats acceptés : PNG, JPEG.');
    } finally { setLogoBusy(false); }
  };

  // APPARENCE : la charte est un réglage, pas une constante. La changer ne doit
  // pas demander une livraison de code.
  const { data: themes } = useQuery({
    queryKey: ['ui-theme'],
    queryFn: () => api.get('/ui/theme').then(
      (r) => r.data.data as {
        actuel: { cle: string; nom: string; brand: string; brandLight: string; accent: string; brandAccent: string };
        disponibles: { cle: string; nom: string; brand: string; brandLight: string; accent: string; brandAccent: string }[];
      }
    ),
  });
  const choisirTheme = useMutation({
    mutationFn: (cle: string) => api.put('/admin/settings', [
      { key: 'ui.theme', value: cle, description: "Thème de l'interface web" },
      // Les surcharges couleur par couleur sont remises à vide : sinon un
      // ancien ajustement resterait collé au nouveau thème et donnerait un
      // mélange que personne n'a choisi.
      ...['brand', 'brandLight', 'accent', 'accentLight', 'brandTint', 'brandAccent']
        .map((c) => ({ key: `ui.theme.${c}`, value: '' })),
    ]),
    onSuccess: () => {
      setSavedOk(true);
      queryClient.invalidateQueries({ queryKey: ['ui-theme'] });
      // Rechargement : les variables CSS sont posées au montage, et toute
      // l'interface en dépend — un rafraîchissement partiel laisserait des
      // écrans à moitié repeints.
      window.location.reload();
    },
  });
  const [tplEdits, setTplEdits] = useState<Record<string, string>>({});
  useEffect(() => {
    if (tpls) {
      const init: Record<string, string> = {};
      tpls.forEach((t) => { init[t.key] = t.valeur ?? t.defaut; });
      setTplEdits(init);
    }
  }, [tpls]);
  const saveTpls = useMutation({
    mutationFn: () => api.put('/admin/settings', (tpls ?? []).map((t) => ({
      key: t.key,
      value: (tplEdits[t.key] ?? '').trim() === t.defaut.trim() ? '' : (tplEdits[t.key] ?? ''),
      description: `Modèle SMS - ${t.label}`,
    }))),
    onSuccess: () => { setSavedOk(true); queryClient.invalidateQueries({ queryKey: ['sms-templates'] }); },
  });

  useEffect(() => {
    if (data) {
      const init: Record<string, string> = {};
      data.forEach((s) => { init[s.key] = typeof s.value === 'string' ? s.value : JSON.stringify(s.value); });
      setEdited(init);
    }
  }, [data]);

  const save = useMutation({
    mutationFn: () => {
      const payload = (data ?? []).map((s) => {
        let value: unknown = edited[s.key];
        try { value = JSON.parse(edited[s.key]); } catch { /* garder la chaîne */ }
        return { key: s.key, value, description: s.description };
      });
      return api.put('/admin/settings', payload);
    },
    onSuccess: () => { setSavedOk(true); queryClient.invalidateQueries({ queryKey: ['settings'] }); },
  });

  if (isLoading) return <Loading />;
  // Les modèles SMS ont leur section dédiée : on les retire de la liste brute.
  // Les modèles SMS et le logo client ont leur section dédiée : hors de la liste brute.
  const settings = (data ?? []).filter((s) => !/^(sms|notif)\.tpl\./.test(s.key) && s.key !== 'client.logoKey');

  return (
    <div>
      <PageHeader
        title="Paramètres système"
        subtitle="Configuration clé / valeur de la plateforme"
        backHref="/administration"
        actions={
          <div className="flex items-center gap-3">
            {savedOk && <span className="flex items-center gap-1 text-sm text-green-600"><CheckCircle2 size={15} /> Enregistré</span>}
            <Button icon={Save} loading={save.isPending} onClick={() => { setSavedOk(false); save.mutate(); }}>Enregistrer</Button>
          </div>
        }
      />

      {settings.length === 0 ? (
        <EmptyState title="Aucun paramètre" hint="Les paramètres sont initialisés par le seed." />
      ) : (
        <div className="bg-white rounded-xl border border-gray-100 divide-y divide-gray-50">
          {settings.map((s) => (
            <div key={s.key} className="flex flex-col md:flex-row md:items-center gap-2 p-4">
              <div className="md:w-1/3">
                <p className="text-sm font-medium text-gray-800">{s.key}</p>
                {s.description && <p className="text-xs text-gray-400">{s.description}</p>}
              </div>
              <input
                value={edited[s.key] ?? ''}
                onChange={(e) => { setEdited((p) => ({ ...p, [s.key]: e.target.value })); setSavedOk(false); }}
                className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm font-mono focus:border-[rgb(var(--brand-light))] focus:ring-2 focus:ring-[rgb(var(--brand-light)/0.2)] outline-none"
              />
            </div>
          ))}
        </div>
      )}

      <div className="mt-8">
        <div className="mb-3">
          <h2 className="text-sm font-semibold text-gray-700">Logo du client</h2>
          <p className="max-w-3xl text-xs text-gray-400">
            Il apparaît sur les documents remis et signés : <b>fiche de validation</b> mensuelle (Excel et PDF) et
            <b> rapport mensuel d&apos;activité</b>. Sans dépôt, la plateforme utilise la marque livrée avec elle.
          </p>
        </div>
        {logoErreur && <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">{logoErreur}</div>}
        <div className="flex flex-wrap items-center gap-4 rounded-xl border border-gray-100 bg-white p-4">
          {logoClient?.dataUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoClient.dataUrl} alt="Logo du client" className="h-16 w-auto rounded border border-gray-100 object-contain" />
          ) : (
            <span className="text-xs text-gray-400">Aucun logo disponible</span>
          )}
          <div className="flex-1 min-w-[220px]">
            <p className="text-xs text-gray-500">
              {logoClient?.source === 'parametre' && 'Logo déposé depuis cet écran.'}
              {logoClient?.source === 'environnement' && 'Logo issu de la variable CLIENT_LOGO_KEY.'}
              {logoClient?.source === 'defaut' && 'Marque livrée avec la plateforme (aucun logo déposé).'}
              {logoClient?.source === 'aucun' && 'Aucun logo : les documents porteront le nom du client en toutes lettres.'}
            </p>
            {logoClient?.cle && <p className="font-mono text-[11px] text-gray-400">{logoClient.cle}</p>}
          </div>
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:border-gray-400">
            <Upload size={15} />
            {logoBusy ? 'Envoi…' : 'Déposer un logo'}
            <input type="file" accept="image/png,image/jpeg" className="hidden" disabled={logoBusy}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) televerserLogo(f); e.target.value = ''; }} />
          </label>
          {logoClient?.source === 'parametre' && (
            <Button variant="secondary" icon={RotateCcw} onClick={() => { setLogoErreur(''); enregistrerLogo(''); }}>
              Revenir au logo par défaut
            </Button>
          )}
        </div>
      </div>

      {themes && (
        <div className="mt-8">
          <div className="mb-3">
            <h2 className="text-sm font-semibold text-gray-700">Apparence</h2>
            <p className="max-w-3xl text-xs text-gray-400">
              Le thème s&apos;applique à <b>tout le monde</b>, écran de connexion compris. Les couleurs de statut
              (rouge pour un incident critique, ambre pour une alerte) ne changent pas : elles doivent rester
              reconnaissables quelle que soit la charte.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            {themes.disponibles.map((t) => {
              const actif = t.cle === themes.actuel.cle;
              return (
                <button
                  key={t.cle}
                  type="button"
                  onClick={() => { if (!actif) choisirTheme.mutate(t.cle); }}
                  disabled={choisirTheme.isPending}
                  className={`rounded-xl border p-4 text-left transition ${actif ? 'border-brand ring-2 ring-brand/20' : 'border-gray-100 bg-white hover:border-gray-300'}`}
                >
                  <div className="mb-2 flex gap-1.5">
                    {[t.brand, t.brandLight, t.accent, t.brandAccent].map((c, i) => (
                      <span key={i} className="h-6 w-6 rounded-md" style={{ backgroundColor: `rgb(${c})` }} />
                    ))}
                  </div>
                  <p className="text-sm font-medium text-gray-800">{t.nom}</p>
                  <p className="text-xs text-gray-400">{actif ? 'Thème actif' : 'Appliquer'}</p>
                </button>
              );
            })}
          </div>
          <p className="mt-2 text-xs text-gray-400">
            Les couleurs du thème « Moov Africa » sont approchées d&apos;après l&apos;identité publique. Pour coller à
            la charte officielle, saisissez les valeurs exactes en triplets RVB dans les réglages
            <code className="mx-1 rounded bg-gray-100 px-1">ui.theme.brand</code> et suivants.
          </p>
        </div>
      )}

      {(canaux?.length ?? 0) > 0 && (
        <div className="mt-8">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold text-gray-700">Canaux SMS</h2>
              <p className="max-w-3xl text-xs text-gray-400">
                Sur un téléphone, c&apos;est l&apos;<b>expéditeur</b> qui crée le fil de discussion : un seul expéditeur et
                tout s&apos;empile au même endroit. Renseignez ici les identifiants déclarés à votre contrat Moov pour
                séparer les fils. Laissé <b>vide</b>, le canal part avec l&apos;expéditeur du contrat par défaut.
                L&apos;<b>étiquette</b>, elle, agit tout de suite : elle remplace le préfixe du message et rend la
                recherche du téléphone utilisable. Vide = aucun préfixe ajouté.
              </p>
            </div>
            <Button icon={Save} loading={saveCanaux.isPending} onClick={() => { setSavedOk(false); saveCanaux.mutate(); }}>
              Enregistrer les canaux
            </Button>
          </div>
          <div className="divide-y divide-gray-50 rounded-xl border border-gray-100 bg-white">
            {canaux!.map((c) => (
              <div key={c.code} className="flex flex-wrap items-center gap-3 p-4">
                <p className="min-w-[220px] flex-1 text-sm font-medium text-gray-800">{c.label}</p>
                <label className="text-xs text-gray-500">
                  Étiquette
                  <input
                    value={canalEdits[`sms.canal.${c.code}.etiquette`] ?? ''}
                    onChange={(e) => { setCanalEdits((p) => ({ ...p, [`sms.canal.${c.code}.etiquette`]: e.target.value })); setSavedOk(false); }}
                    placeholder={c.etiquetteDefaut}
                    className="ml-2 w-36 rounded-lg border border-gray-300 px-2 py-1 font-mono text-xs"
                  />
                </label>
                <label className="text-xs text-gray-500">
                  Expéditeur
                  <input
                    value={canalEdits[`sms.canal.${c.code}.expediteur`] ?? ''}
                    onChange={(e) => { setCanalEdits((p) => ({ ...p, [`sms.canal.${c.code}.expediteur`]: e.target.value })); setSavedOk(false); }}
                    placeholder="(contrat par défaut)"
                    className="ml-2 w-40 rounded-lg border border-gray-300 px-2 py-1 font-mono text-xs"
                  />
                </label>
              </div>
            ))}
          </div>
        </div>
      )}

      {(tpls?.length ?? 0) > 0 && (
        <div className="mt-8">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold text-gray-700">Modèles de SMS et notifications</h2>
              <p className="text-xs text-gray-400">
                Les {'{variables}'} sont remplacées à l&apos;envoi. Revenir au texte du défaut (bouton « défaut ») puis enregistrer = retour au modèle standard.
              </p>
            </div>
            <Button icon={Save} loading={saveTpls.isPending} onClick={() => { setSavedOk(false); saveTpls.mutate(); }}>
              Enregistrer les modèles
            </Button>
          </div>
          <div className="divide-y divide-gray-50 rounded-xl border border-gray-100 bg-white">
            {tpls!.map((t) => (
              <div key={t.key} className="p-4">
                <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-medium text-gray-800">
                    {t.label}
                    {t.valeur && <span className="ml-2 rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-bold text-amber-700">personnalisé</span>}
                  </p>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {t.variables.map((v) => (
                      <code key={v} className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-600">{`{${v}}`}</code>
                    ))}
                    {(tplEdits[t.key] ?? '') !== t.defaut && (
                      <button type="button" onClick={() => { setTplEdits((p) => ({ ...p, [t.key]: t.defaut })); setSavedOk(false); }}
                        className="text-[11px] font-medium text-[rgb(var(--brand-light))] hover:underline">défaut</button>
                    )}
                  </div>
                </div>
                <textarea
                  value={tplEdits[t.key] ?? ''}
                  onChange={(e) => { setTplEdits((p) => ({ ...p, [t.key]: e.target.value })); setSavedOk(false); }}
                  rows={2}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 font-mono text-sm outline-none focus:border-[rgb(var(--brand-light))] focus:ring-2 focus:ring-[rgb(var(--brand-light)/0.2)]"
                />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
