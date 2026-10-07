'use client';

import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FileSpreadsheet, FileText, ListTree, X } from 'lucide-react';
import { api } from '@/lib/api';
import { downloadFile } from '@/lib/download';

interface BcOption { id: string; numero: string; annee: number; trimestre: number; volumesMensuels: Array<{ mois: number }> }

const p2 = (n: number) => String(n).padStart(2, '0');
const mois = (annee: number, m: number) => `${annee}-${p2(m)}`;

/** Bornes d'un trimestre, en mois « AAAA-MM ». */
function trimestre(annee: number, t: number): { du: string; au: string } {
  return { du: mois(annee, (t - 1) * 3 + 1), au: mois(annee, t * 3) };
}

/** Raccourcis calculés AU CLIC, jamais au rendu : la page est prérendue à la construction. */
function raccourci(cle: 'trimestre' | 'trimestrePrecedent' | 'moisPrecedent' | 'annee'): { du: string; au: string } {
  const d = new Date();
  const a = d.getFullYear();
  const m = d.getMonth() + 1;
  const t = Math.ceil(m / 3);
  if (cle === 'trimestre') return trimestre(a, t);
  if (cle === 'trimestrePrecedent') return t === 1 ? trimestre(a - 1, 4) : trimestre(a, t - 1);
  if (cle === 'moisPrecedent') {
    const p = m === 1 ? mois(a - 1, 12) : mois(a, m - 1);
    return { du: p, au: p };
  }
  return { du: mois(a, 1), au: mois(a, m) };
}

const champ =
  'rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-[rgb(var(--brand-light))]';
const puce = 'rounded-full border border-gray-200 bg-white px-2.5 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50';

/**
 * Export « suivi détaillé » des commandes : la chaîne BC → bons de livraison →
 * livraisons par site → dépotages, sur une période en mois. Sur un trimestre
 * complet, ses totaux sont ceux du rapprochement du BC (même calcul).
 */
export function SuiviDetaille() {
  const [ouvert, setOuvert] = useState(false);
  const [du, setDu] = useState('');
  const [au, setAu] = useState('');
  const [bcId, setBcId] = useState('');
  const [enCours, setEnCours] = useState<'' | 'xlsx' | 'pdf'>('');
  const boite = useRef<HTMLDivElement>(null);

  const { data: bcs } = useQuery({
    queryKey: ['bons-commande-options'],
    queryFn: () => api.get('/bons-commande', { params: { limit: 100 } }).then((r) => r.data.data as BcOption[]),
    enabled: ouvert,
    staleTime: 5 * 60_000,
  });

  // Période par défaut posée à l'ouverture (et non au rendu prérendu).
  useEffect(() => {
    if (ouvert && !du) { const r = raccourci('trimestre'); setDu(r.du); setAu(r.au); }
  }, [ouvert, du]);

  useEffect(() => {
    if (!ouvert) return;
    const clic = (e: MouseEvent) => { if (boite.current && !boite.current.contains(e.target as Node)) setOuvert(false); };
    document.addEventListener('mousedown', clic);
    return () => document.removeEventListener('mousedown', clic);
  }, [ouvert]);

  const choisirBc = (id: string) => {
    setBcId(id);
    const b = bcs?.find((x) => x.id === id);
    if (!b) return;
    // Un BC choisi : sa période devient celle de l'export (ses mois commandés).
    const ms = b.volumesMensuels.map((v) => v.mois);
    const r = ms.length
      ? { du: mois(b.annee, Math.min(...ms)), au: mois(b.annee, Math.max(...ms)) }
      : trimestre(b.annee, b.trimestre);
    setDu(r.du); setAu(r.au);
  };

  const valide = /^\d{4}-\d{2}$/.test(du) && /^\d{4}-\d{2}$/.test(au) && du <= au;

  const exporter = async (format: 'xlsx' | 'pdf') => {
    if (!valide) return;
    setEnCours(format);
    const q = new URLSearchParams({ du, au, ...(bcId ? { bon_commande_id: bcId } : {}) });
    const bc = bcs?.find((x) => x.id === bcId);
    try {
      await downloadFile(`/bons-commande/suivi/${format}?${q}`,
        `suivi-commandes${bc ? `-${bc.numero}` : ''}-${du}-a-${au}.${format}`, false, 120_000);
    } finally { setEnCours(''); }
  };

  return (
    <div className="relative" ref={boite}>
      <button type="button" onClick={() => setOuvert((v) => !v)}
        className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3.5 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
        <ListTree size={15} /> Suivi détaillé
      </button>

      {ouvert && (
        <div className="absolute right-0 z-30 mt-2 w-[26rem] rounded-xl border border-gray-100 bg-white p-4 shadow-xl">
          <div className="mb-3 flex items-start justify-between gap-2">
            <div>
              <p className="text-sm font-semibold text-gray-800">Suivi détaillé des commandes</p>
              <p className="mt-0.5 text-xs text-gray-500">
                Synthèse par BC, bons de livraison, livraisons par site et dépotages, reliés.
              </p>
            </div>
            <button type="button" onClick={() => setOuvert(false)} className="rounded p-1 text-gray-400 hover:bg-gray-100"><X size={15} /></button>
          </div>

          <label className="mb-1 block text-xs font-medium text-gray-600">Bon de commande</label>
          <select value={bcId} onChange={(e) => choisirBc(e.target.value)} className={`${champ} mb-3 w-full`}>
            <option value="">Tous les bons de commande</option>
            {(bcs ?? []).map((b) => <option key={b.id} value={b.id}>{b.numero} · T{b.trimestre} {b.annee}</option>)}
          </select>

          <label className="mb-1 block text-xs font-medium text-gray-600">Période (mois logistiques)</label>
          <div className="mb-2 flex items-center gap-2">
            <input type="month" value={du} max={au || undefined} onChange={(e) => setDu(e.target.value)} className={`${champ} flex-1`} />
            <span className="text-xs text-gray-400">à</span>
            <input type="month" value={au} min={du || undefined} onChange={(e) => setAu(e.target.value)} className={`${champ} flex-1`} />
          </div>
          <div className="mb-3 flex flex-wrap gap-1.5">
            {([['trimestre', 'Trimestre en cours'], ['trimestrePrecedent', 'Trimestre précédent'], ['moisPrecedent', 'Mois précédent'], ['annee', 'Depuis janvier']] as const).map(([cle, lib]) => (
              <button key={cle} type="button" className={puce} onClick={() => { const r = raccourci(cle); setDu(r.du); setAu(r.au); }}>{lib}</button>
            ))}
          </div>

          <p className="mb-3 text-[11px] leading-relaxed text-gray-400">
            Un bon de livraison compte dans le mois logistique auquel il est rattaché. Sur un trimestre complet, les totaux sont
            ceux du rapprochement du bon de commande. Brouillons et chargements annulés exclus.
          </p>

          <div className="flex gap-2">
            <button type="button" disabled={!valide || !!enCours} onClick={() => exporter('xlsx')}
              className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-[rgb(var(--brand))] px-3 py-2 text-sm font-medium text-white hover:bg-[rgb(var(--brand-light))] disabled:opacity-50">
              <FileSpreadsheet size={15} /> {enCours === 'xlsx' ? 'Préparation…' : 'Excel (complet)'}
            </button>
            <button type="button" disabled={!valide || !!enCours} onClick={() => exporter('pdf')}
              className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">
              <FileText size={15} /> {enCours === 'pdf' ? 'Préparation…' : 'PDF (essentiel)'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
