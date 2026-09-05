'use client';

import { useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { useDebounce } from '@/lib/hooks/useDebounce';
import { Plus, Pencil, Trash2, Upload, X, MessageSquareText, Search, Send } from 'lucide-react';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { PageHeader } from '@/components/shared/PageHeader';
import { Button } from '@/components/shared/Button';
import { Field, Input, Select, Textarea } from '@/components/shared/Form';
import { Loading, ErrorState, EmptyState } from '@/components/shared/states';
import { fmtDateTime } from '@/lib/utils';

interface Contact {
  id: string; nom: string; prenom: string; telephone: string; email: string | null;
  societe: string; actif: boolean; prestataireId?: string | null;
  notifDemarrage: boolean; notifCloture: boolean; notifMaintenances: boolean; notifIncidents: boolean;
  notifCoupures: boolean; notifSituations: boolean; notifLivraisons: boolean;
  toutesSocietes: boolean;
}
interface SmsLog { id: string; telephone: string; message: string; evenement: string; statut: string; erreur: string | null; createdAt: string }
interface Ecart { champ: 'telephone' | 'email'; compte: string | null; contact: string | null }
interface Coherence {
  userId: string; userNom: string; userRole: string;
  contactId: string; contactNom: string; contactSociete: string;
  critere: 'email' | 'telephone' | 'nom'; ecarts: Ecart[];
}

// Miroir du normNom serveur : rapprochement de la société saisie.
const normSociete = (v: string) => v.toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Z0-9]/g, '');
/** ZONE MORTE du ciblage : ni « toutes sociétés » ni prestataire reconnu →
 *  le contact ne reçoit NI incidents NI coupures NI situations. */
const horsPerimetre = (c: { toutesSocietes: boolean; prestataireId?: string | null }) =>
  !c.toutesSocietes && !c.prestataireId;

const VIDE: Omit<Contact, 'id'> = {
  nom: '', prenom: '', telephone: '', email: '', societe: '', actif: true,
  notifDemarrage: true, notifCloture: true, notifMaintenances: true, notifIncidents: true,
  notifCoupures: true, notifSituations: true, notifLivraisons: false, toutesSocietes: false,
};

/**
 * Carnet des contacts notifiés par SMS quand un technicien démarre/clôture une
 * action (maintenance ou incident). Chaque contact choisit ses événements et
 * son périmètre (sa société ou toutes).
 */
export default function ContactsPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [societe, setSociete] = useState('');
  const [edit, setEdit] = useState<Contact | null>(null);       // contact en cours d'édition
  const [creation, setCreation] = useState(false);
  const [journalOpen, setJournalOpen] = useState(false);
  const [smsOpen, setSmsOpen] = useState(false);
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  // Recherche débouncée : sans ça chaque frappe changeait la clé de requête,
  // repassait isLoading à vrai, et le <Loading/> remplaçait toute la page (perte
  // du focus de l'input). keepPreviousData garde la liste affichée pendant la frappe.
  const debouncedSearch = useDebounce(search);
  const { data, isLoading, isError } = useQuery({
    queryKey: ['contacts', debouncedSearch, societe],
    queryFn: () => api.get('/contacts', { params: { search: debouncedSearch || undefined, societe: societe || undefined } }).then((r) => r.data),
    placeholderData: keepPreviousData,
  });
  const { data: journal } = useQuery({
    queryKey: ['sms-logs'],
    queryFn: () => api.get('/contacts/sms-logs').then((r) => r.data),
    enabled: journalOpen,
  });
  const { data: coherence } = useQuery({
    queryKey: ['contacts-coherence'],
    queryFn: () => api.get('/contacts/coherence').then((r) => r.data.data as Coherence[]),
  });
  // Noms des prestataires connus : alimente l'avertissement « périmètre vide »
  // du formulaire (société saisie non reconnue + toutes sociétés décoché).
  const { data: prestatairesRef } = useQuery({
    queryKey: ['prestataires-select'],
    queryFn: () => api.get('/prestataires', { params: { is_active: true, limit: 200 } }).then((r) => r.data.data as { nom: string }[]),
  });
  const nomsPrestataires = (prestatairesRef ?? []).map((p) => normSociete(p.nom));

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['contacts'] });
  const onErr = (e: { response?: { data?: { error?: string } } }) => setError(e.response?.data?.error || 'Erreur');

  const save = useMutation({
    mutationFn: (c: Partial<Contact>) => (c.id ? api.put(`/contacts/${c.id}`, c) : api.post('/contacts', c)),
    onSuccess: () => { refresh(); setEdit(null); setCreation(false); setError(''); },
    onError: onErr,
  });
  const toggle = useMutation({
    mutationFn: (c: Contact) => api.put(`/contacts/${c.id}`, { actif: !c.actif }),
    onSuccess: refresh, onError: onErr,
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/contacts/${id}`),
    onSuccess: () => { refresh(); setError(''); }, onError: onErr,
  });
  const importer = useMutation({
    mutationFn: (file: File) => { const fd = new FormData(); fd.append('file', file); return api.post('/contacts/import', fd); },
    onSuccess: (r) => { refresh(); setError(''); toast(`Import : ${r.data.data.crees} créé(s), ${r.data.data.maj} mis à jour, ${r.data.data.ignores} ignoré(s).`, 'success'); },
    onError: onErr,
  });

  if (isLoading) return <Loading />;
  if (isError) return <ErrorState />;
  const contacts: Contact[] = data?.data ?? [];
  const societes: string[] = data?.societes ?? [];

  return (
    <div>
      <PageHeader
        title="Contacts SMS"
        subtitle="Personnes notifiées au démarrage et à la clôture des actions terrain"
        backHref="/administration"
        actions={
          <>
            <input ref={fileRef} type="file" accept=".xlsx" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) importer.mutate(f); e.target.value = ''; }} />
            <Button variant="secondary" icon={Upload} loading={importer.isPending} onClick={() => fileRef.current?.click()}>Importer Excel</Button>
            <Button variant="secondary" icon={MessageSquareText} onClick={() => setJournalOpen((v) => !v)}>Journal SMS</Button>
            <Button variant="secondary" icon={Send} onClick={() => setSmsOpen((v) => !v)}>
              Envoyer un SMS{selection.size > 0 ? ` (${selection.size})` : ''}
            </Button>
            <Button icon={Plus} onClick={() => { setCreation(true); setEdit(null); }}>Ajouter</Button>
          </>
        }
      />

      {error && <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">{error}</div>}

      {(coherence?.length ?? 0) > 0 && <CoherenceBloc rows={coherence!} />}

      {journalOpen && (
        <div className="mb-4 rounded-xl border border-gray-100 bg-white p-4">
          <div className="mb-2 flex items-center justify-between gap-3">
            <p className="text-sm font-semibold text-gray-700">Derniers SMS</p>
            <div className="flex items-center gap-2">
              {journal?.jour && journal.smsActive && (
                <span
                  className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                    journal.jour.plafond > 0 && journal.jour.envoyes >= journal.jour.plafond * 0.8
                      ? 'bg-red-100 text-red-700'
                      : 'bg-[#EAF1F8] text-[#1B3F6B]'
                  }`}
                  title="Consommation du jour vs plafond (réglable dans Paramètres → Notifications)"
                >
                  Aujourd&apos;hui : {journal.jour.envoyes}{journal.jour.plafond > 0 ? ` / ${journal.jour.plafond}` : ''} SMS
                </span>
              )}
              {journal && !journal.smsActive && (
                <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-700">
                  Mode simulation - passerelle SMS non configurée, rien n&apos;est réellement envoyé
                </span>
              )}
            </div>
          </div>
          {(journal?.data ?? []).length === 0 ? (
            <p className="py-4 text-center text-sm text-gray-400">Aucun SMS pour l&apos;instant.</p>
          ) : (
            <div className="max-h-72 overflow-y-auto">
              {(journal!.data as SmsLog[]).map((l) => (
                <div key={l.id} className="flex items-start gap-3 border-b border-gray-50 py-2 text-xs last:border-0">
                  <span className={`mt-0.5 shrink-0 rounded-full px-2 py-0.5 font-medium ${l.statut === 'ENVOYE' ? 'bg-green-100 text-green-700' : l.statut === 'SIMULE' ? 'bg-gray-100 text-gray-600' : 'bg-red-100 text-red-700'}`}>{l.statut}</span>
                  <span className="w-28 shrink-0 tabular-nums text-gray-500">{l.telephone}</span>
                  <span className="flex-1 text-gray-700">{l.message}{l.erreur ? <span className="text-red-600"> - {l.erreur}</span> : null}</span>
                  <span className="shrink-0 text-gray-400">{fmtDateTime(l.createdAt)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="mb-4 flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Rechercher (nom, prénom, téléphone)" className="pl-9" />
        </div>
        <Select value={societe} onChange={(e) => setSociete(e.target.value)} className="sm:w-64"
          options={[{ value: '', label: 'Toutes les sociétés' }, ...societes.map((s) => ({ value: s, label: s }))]} />
      </div>

      {smsOpen && (
        <SmsForm
          selection={selection}
          contacts={contacts}
          onClose={() => setSmsOpen(false)}
          onSent={() => { setSelection(new Set()); queryClient.invalidateQueries({ queryKey: ['sms-logs'] }); }}
        />
      )}

      {(creation || edit) && (
        <ContactForm
          initial={edit ?? VIDE}
          societes={societes}
          nomsPrestataires={nomsPrestataires}
          loading={save.isPending}
          onCancel={() => { setEdit(null); setCreation(false); }}
          onSubmit={(c) => save.mutate(edit ? { ...c, id: edit.id } : c)}
        />
      )}

      {contacts.length === 0 ? (
        <EmptyState title="Aucun contact" hint="Ajoutez un contact ou importez le fichier Excel du personnel." />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-100 bg-white">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-gray-100 text-left text-xs text-gray-500">
              <th className="w-10 py-3 pl-5 pr-1">
                <input type="checkbox" title="Tout sélectionner (liste filtrée)"
                  checked={contacts.length > 0 && contacts.every((c) => selection.has(c.id))}
                  onChange={(e) => setSelection(e.target.checked ? new Set(contacts.map((c) => c.id)) : new Set())} />
              </th>
              <th className="py-3 pr-3 font-medium">Contact</th>
              <th className="px-3 py-3 font-medium">Société</th>
              <th className="px-3 py-3 font-medium">Téléphone</th>
              <th className="px-3 py-3 font-medium">Notifications</th>
              <th className="px-3 py-3 text-center font-medium">Actif</th>
              <th className="px-3 py-3 pr-5 text-right font-medium">Actions</th>
            </tr></thead>
            <tbody>
              {contacts.map((c) => (
                <tr key={c.id} className={`border-b border-gray-50 last:border-0 ${c.actif ? '' : 'opacity-50'}`}>
                  <td className="py-2.5 pl-5 pr-1">
                    <input type="checkbox" checked={selection.has(c.id)}
                      onChange={(e) => setSelection((prev) => {
                        const next = new Set(prev);
                        if (e.target.checked) next.add(c.id); else next.delete(c.id);
                        return next;
                      })} />
                  </td>
                  <td className="py-2.5 pr-3">
                    <p className="font-medium text-gray-800">{c.nom} {c.prenom}</p>
                    {c.email && <p className="text-xs text-gray-400">{c.email}</p>}
                  </td>
                  <td className="px-3 py-2.5 text-gray-600">{c.societe}</td>
                  <td className="px-3 py-2.5 tabular-nums text-gray-600">{c.telephone}</td>
                  <td className="px-3 py-2.5">
                    <div className="flex flex-wrap gap-1">
                      {c.notifDemarrage && <Chip>Démarrages</Chip>}
                      {c.notifCloture && <Chip>Clôtures</Chip>}
                      {!c.notifMaintenances && <Chip off>Sans maint.</Chip>}
                      {!c.notifIncidents && <Chip off>Sans incidents</Chip>}
                      {!c.notifCoupures && <Chip off>Sans coupures</Chip>}
                      {c.notifLivraisons && <Chip>Livraisons</Chip>}
                      {!c.notifSituations && <Chip off>Sans situations</Chip>}
                      <Chip accent={c.toutesSocietes}>{c.toutesSocietes ? 'Toutes sociétés' : 'Sa société'}</Chip>
                      {horsPerimetre(c) && (
                        <span title="Société non reconnue comme prestataire et « toutes sociétés » décoché : ce contact ne recevra ni incidents, ni coupures, ni situations périodiques. Cochez « toutes les sociétés » (contact interne/NOC) ou corrigez la société.">
                          <Chip off>⚠ périmètre vide</Chip>
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    <button type="button" onClick={() => toggle.mutate(c)}
                      className={`h-5 w-9 rounded-full transition-colors ${c.actif ? 'bg-green-500' : 'bg-gray-300'}`}
                      title={c.actif ? 'Désactiver (ne recevra plus de SMS)' : 'Réactiver'}>
                      <span className={`block h-4 w-4 rounded-full bg-white shadow transition-transform ${c.actif ? 'translate-x-4' : 'translate-x-0.5'}`} />
                    </button>
                  </td>
                  <td className="px-3 py-2.5 pr-5 text-right">
                    <button type="button" className="rounded p-1.5 text-gray-400 hover:bg-gray-50 hover:text-gray-600" title="Modifier"
                      onClick={() => { setEdit(c); setCreation(false); window.scrollTo({ top: 0, behavior: 'smooth' }); }}><Pencil size={15} /></button>
                    <button type="button" className="rounded p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600" title="Supprimer"
                      onClick={() => { if (confirm(`Supprimer ${c.nom} ${c.prenom} du carnet ?`)) remove.mutate(c.id); }}><Trash2 size={15} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-3 text-xs text-gray-400">
        {contacts.length} contact(s) · « Sa société » : le contact ne reçoit que les actions des techniciens de sa propre société (les internes pour un contact interne).
      </p>
    </div>
  );
}

interface EnvoiResultat {
  simule: boolean; total: number; envoyes: number; echecs: number;
  resultats: { telephone: string; statut: string; erreur: string | null }[];
}

/** Envoi manuel d'un SMS : contacts cochés dans la liste + numéros libres. */
function SmsForm({ selection, contacts, onClose, onSent }: {
  selection: Set<string>;
  contacts: Contact[];
  onClose: () => void;
  onSent: () => void;
}) {
  const [message, setMessage] = useState('');
  const [telsLibres, setTelsLibres] = useState('');
  const [resultat, setResultat] = useState<EnvoiResultat | null>(null);
  const [error, setError] = useState('');

  const cibles = contacts.filter((c) => selection.has(c.id));
  const telephones = telsLibres.split(/[,;\s]+/).map((t) => t.trim()).filter(Boolean);
  const nbDestinataires = cibles.length + telephones.length;

  const envoi = useMutation({
    mutationFn: () => api.post('/sms/send', {
      message,
      contactIds: cibles.map((c) => c.id),
      telephones,
    }).then((r) => r.data.data as EnvoiResultat),
    onSuccess: (r) => { setResultat(r); setError(''); onSent(); },
    onError: (e: { response?: { data?: { error?: string } } }) => setError(e.response?.data?.error || 'Erreur'),
  });

  return (
    <form className="mb-4 rounded-xl border border-gray-100 bg-white p-4"
      onSubmit={(e) => { e.preventDefault(); if (!envoi.isPending && !resultat) envoi.mutate(); }}>
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm font-semibold text-gray-700">Envoyer un SMS</p>
        <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
      </div>

      {resultat ? (
        <div>
          <div className={`mb-3 rounded-lg px-4 py-3 text-sm ${resultat.echecs ? 'bg-amber-50 text-amber-800' : 'bg-green-50 text-green-800'}`}>
            {resultat.simule
              ? <>✓ {resultat.total} SMS <b>simulé(s)</b> (passerelle non configurée - visible dans le Journal SMS, rien n&apos;est parti).</>
              : <>✓ {resultat.envoyes}/{resultat.total} SMS envoyé(s){resultat.echecs > 0 && <> · <b>{resultat.echecs} échec(s)</b></>}.</>}
          </div>
          {resultat.echecs > 0 && (
            <div className="mb-3 max-h-40 overflow-y-auto text-xs">
              {resultat.resultats.filter((r) => r.statut === 'ECHEC').map((r) => (
                <p key={r.telephone} className="py-0.5 text-red-600">{r.telephone} - {r.erreur}</p>
              ))}
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => { setResultat(null); setMessage(''); setTelsLibres(''); }}>Nouvel envoi</Button>
            <Button type="button" onClick={onClose}>Fermer</Button>
          </div>
        </div>
      ) : (
        <>
          <p className="mb-3 text-sm text-gray-600">
            {cibles.length > 0
              ? <><b>{cibles.length} contact(s)</b> coché(s) dans la liste : {cibles.slice(0, 5).map((c) => `${c.prenom} ${c.nom}`).join(', ')}{cibles.length > 5 ? '…' : ''}</>
              : 'Cochez des contacts dans la liste ci-dessous et/ou saisissez des numéros libres.'}
          </p>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <Field label="Numéros libres (optionnel, séparés par virgule ou espace)">
              <Input value={telsLibres} onChange={(e) => setTelsLibres(e.target.value)} placeholder="97 00 00 00, +228 99 00 00 00" />
            </Field>
            <Field label={`Message (${message.length}/320${message.length > 160 ? ' - sera facturé en plusieurs SMS' : ''})`}>
              <Textarea value={message} onChange={(e) => setMessage(e.target.value.slice(0, 320))} rows={3}
                placeholder="[E&M OpS] Votre message…" required />
            </Field>
          </div>
          {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
          <div className="mt-3 flex items-center justify-end gap-3">
            <span className="text-xs text-gray-400">{nbDestinataires} destinataire(s) · 100 max</span>
            <Button type="submit" icon={Send} loading={envoi.isPending}
              disabled={!message.trim() || nbDestinataires === 0 || nbDestinataires > 100}>
              Envoyer
            </Button>
          </div>
        </>
      )}
    </form>
  );
}

/**
 * Écarts compte utilisateur ↔ fiche contact (numéro ou email différent d'un
 * côté) : la dérive silencieuse type est un technicien qui change de numéro,
 * corrigé sur une seule des deux fiches — ses SMS d'affectation partent alors
 * vers l'ancien numéro. Chaque écart s'aligne en un clic, dans le bon sens
 * (l'email du compte est l'identifiant de connexion : on ne l'écrase jamais
 * depuis la fiche).
 */
function CoherenceBloc({ rows }: { rows: Coherence[] }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const done = () => {
    queryClient.invalidateQueries({ queryKey: ['contacts-coherence'] });
    queryClient.invalidateQueries({ queryKey: ['contacts'] });
  };
  const versFiche = useMutation({
    mutationFn: ({ contactId, champ, valeur }: { contactId: string; champ: Ecart['champ']; valeur: string }) =>
      api.put(`/contacts/${contactId}`, { [champ]: valeur }),
    onSuccess: () => { done(); toast('Fiche contact alignée sur le compte.', 'success'); },
    onError: (e: { response?: { data?: { error?: string } } }) => toast(e.response?.data?.error || 'Erreur', 'error'),
  });
  const versCompte = useMutation({
    mutationFn: ({ userId, valeur }: { userId: string; valeur: string }) =>
      api.put(`/users/${userId}`, { telephone: valeur }),
    onSuccess: () => { done(); toast('Compte aligné sur la fiche contact.', 'success'); },
    onError: (e: { response?: { data?: { error?: string } } }) => toast(e.response?.data?.error || 'Erreur', 'error'),
  });
  const CRITERE: Record<Coherence['critere'], string> = {
    email: 'rapproché par email', telephone: 'rapproché par téléphone', nom: 'rapproché par nom (à vérifier)',
  };
  const nb = rows.reduce((s, r) => s + r.ecarts.length, 0);

  return (
    <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-4">
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full items-center justify-between gap-3 text-left">
        <p className="text-sm font-semibold text-amber-800">
          {nb} écart{nb > 1 ? 's' : ''} entre comptes utilisateurs et fiches contact
        </p>
        <span className="shrink-0 text-xs font-medium text-amber-700 underline">{open ? 'Masquer' : 'Voir le détail'}</span>
      </button>
      {open && (
        <div className="mt-3 space-y-3">
          {rows.map((r) => (
            <div key={r.userId} className="rounded-lg border border-amber-100 bg-white p-3">
              <p className="text-sm font-medium text-gray-800">
                {r.userNom} <span className="text-xs text-gray-500">(compte {r.userRole.toLowerCase()})</span>
                {' '}↔ fiche « {r.contactNom} » · {r.contactSociete}
                <span className="ml-2 rounded-full bg-gray-100 px-2 py-0.5 text-[11px] text-gray-500">{CRITERE[r.critere]}</span>
              </p>
              <div className="mt-2 space-y-1.5">
                {r.ecarts.map((e) => (
                  <div key={e.champ} className="flex flex-wrap items-center gap-2 text-xs text-gray-600">
                    <span className="w-20 shrink-0 font-medium capitalize text-gray-500">{e.champ === 'telephone' ? 'Téléphone' : 'Email'}</span>
                    <span>compte : <b>{e.compte ?? '(vide)'}</b></span>
                    <span>fiche : <b>{e.contact ?? '(vide)'}</b></span>
                    <span className="flex gap-1.5">
                      {e.compte && (
                        <button type="button"
                          onClick={() => versFiche.mutate({ contactId: r.contactId, champ: e.champ, valeur: e.compte! })}
                          disabled={versFiche.isPending}
                          className="rounded-md border border-[#1B3F6B]/30 px-2 py-0.5 font-medium text-[#1B3F6B] hover:bg-[#EAF1F8] disabled:opacity-50">
                          Copier vers la fiche
                        </button>
                      )}
                      {e.champ === 'telephone' && e.contact && (
                        <button type="button"
                          onClick={() => versCompte.mutate({ userId: r.userId, valeur: e.contact! })}
                          disabled={versCompte.isPending}
                          className="rounded-md border border-[#1B3F6B]/30 px-2 py-0.5 font-medium text-[#1B3F6B] hover:bg-[#EAF1F8] disabled:opacity-50">
                          Copier vers le compte
                        </button>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Chip({ children, off, accent }: { children: React.ReactNode; off?: boolean; accent?: boolean }) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${off ? 'bg-red-50 text-red-600' : accent ? 'bg-[#1B3F6B]/10 text-[#1B3F6B]' : 'bg-gray-100 text-gray-600'}`}>
      {children}
    </span>
  );
}

function ContactForm({ initial, societes, nomsPrestataires, loading, onCancel, onSubmit }: {
  initial: Omit<Contact, 'id'> | Contact;
  societes: string[];
  nomsPrestataires: string[];
  loading: boolean;
  onCancel: () => void;
  onSubmit: (c: Omit<Contact, 'id'>) => void;
}) {
  const [f, setF] = useState({ ...initial, email: initial.email ?? '' });
  // Société saisie ni INTERNE ni prestataire connu, et « toutes sociétés »
  // décoché : le contact tomberait dans la ZONE MORTE du ciblage (aucun SMS
  // d'incident/coupure/situation) — c'est le piège classique des fiches NOC.
  const societeNorm = normSociete(f.societe || '');
  const perimetreVide = !!f.societe && !f.toutesSocietes
    && societeNorm !== 'INTERNE' && !nomsPrestataires.includes(societeNorm);
  const set = (patch: Partial<typeof f>) => setF((v) => ({ ...v, ...patch }));
  const Check = ({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) => (
    <label className="flex items-center gap-2 text-sm text-gray-700">
      <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} /> {label}
    </label>
  );

  return (
    <form className="mb-4 rounded-xl border border-gray-100 bg-white p-4"
      onSubmit={(e) => { e.preventDefault(); onSubmit(f); }}>
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm font-semibold text-gray-700">{'id' in initial ? 'Modifier le contact' : 'Nouveau contact'}</p>
        <button type="button" onClick={onCancel} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Nom"><Input value={f.nom} onChange={(e) => set({ nom: e.target.value })} required /></Field>
        <Field label="Prénom"><Input value={f.prenom} onChange={(e) => set({ prenom: e.target.value })} required /></Field>
        <Field label="Téléphone"><Input value={f.telephone} onChange={(e) => set({ telephone: e.target.value })} placeholder="97 00 00 00 ou +228…" required /></Field>
        <Field label="Email (optionnel)"><Input type="email" value={f.email} onChange={(e) => set({ email: e.target.value })} /></Field>
        <Field label="Société">
          <Input value={f.societe} onChange={(e) => set({ societe: e.target.value })} list="societes" placeholder="INTERNE, NETIS, HAMMER…" required />
          <datalist id="societes">{societes.map((s) => <option key={s} value={s} />)}</datalist>
        </Field>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-gray-50 pt-3">
        <Check label="Démarrages" value={f.notifDemarrage} onChange={(v) => set({ notifDemarrage: v })} />
        <Check label="Clôtures" value={f.notifCloture} onChange={(v) => set({ notifCloture: v })} />
        <Check label="Maintenances" value={f.notifMaintenances} onChange={(v) => set({ notifMaintenances: v })} />
        <Check label="Incidents" value={f.notifIncidents} onChange={(v) => set({ notifIncidents: v })} />
        <Check label="Coupures partielles (équipes actives)" value={f.notifCoupures} onChange={(v) => set({ notifCoupures: v })} />
        <Check label="Livraisons carburant (SMS à chaque dépotage du périmètre - coût réel, à activer avec discernement)" value={f.notifLivraisons} onChange={(v) => set({ notifLivraisons: v })} />
        <Check label="Situations périodiques (récap dépassements)" value={f.notifSituations} onChange={(v) => set({ notifSituations: v })} />
        <Check label="Toutes les sociétés (sinon : la sienne uniquement)" value={f.toutesSocietes} onChange={(v) => set({ toutesSocietes: v })} />
      </div>
      {perimetreVide && (
        <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <b>« {f.societe} » n&apos;est ni INTERNE ni un prestataire connu</b> : sans « toutes les sociétés »,
          ce contact ne recevra <b>aucun</b> SMS d&apos;incident, de coupure ni de situation périodique.
          Pour un contact NOC/interne, cochez « toutes les sociétés » — ou corrigez la société.
        </p>
      )}
      <div className="mt-4 flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onCancel}>Annuler</Button>
        <Button type="submit" loading={loading}>Enregistrer</Button>
      </div>
    </form>
  );
}
