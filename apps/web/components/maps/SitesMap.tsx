'use client';

import 'leaflet/dist/leaflet.css';
import { useState, useRef, useEffect } from 'react';
import L from 'leaflet';
import { MapContainer, TileLayer, CircleMarker, Popup, useMap } from 'react-leaflet';
import { Search, X } from 'lucide-react';
import { COULEUR_MULTI_CAMIONS } from './couleursCamions';

export interface SiteFeature {
  type: 'Feature';
  geometry: { type: 'Point'; coordinates: [number, number] };
  properties: {
    id: string;
    nom: string;
    code: string;
    region: string;
    statutGE: string;
    powerConfig: string;
    puissanceGEkva: number;
    hasStock: boolean;
    stockLitres?: number;
    niveauStock?: string; // OK / FAIBLE / CRITIQUE / VIDE / NA
    derniereMesure?: string | null;
    stockEstime?: number | null;
    autonomieJours?: number | null;
    dateRupture?: string | null;
    tendance?: string | null;
    heuresGEJour?: number | null;
    sourceConso?: string | null;
    dernierDepotageVol?: number | null;
    dernierDepotageDate?: string | null;
    // Vue TRANSPORTEUR : seuls champs servis (avec l'identité du site) — le
    // volume restant à déposer selon SON plan, et les BL concernés.
    aLivrerLitres?: number;
    numerosBL?: string[];
    camions?: string[];
    livraisons?: { immatriculation: string; numeroBL: string; restant: number }[];
  };
}

const fmtDateCourt = (iso?: string | null) => {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit' });
};
const TENDANCE_ICON: Record<string, string> = { HAUSSE: '↑', BAISSE: '↓', STABLE: '→' };

const NIVEAU_STOCK: Record<string, { label: string; color: string }> = {
  OK: { label: 'OK', color: '#0E7C6B' },
  FAIBLE: { label: 'Faible', color: '#F59E0B' },
  CRITIQUE: { label: 'Critique', color: '#DC2626' },
  VIDE: { label: 'Vide', color: '#991B1B' },
};

const STATUT_COLOR: Record<string, string> = {
  GE_PERMANENT: '#0E7C6B',
  GE_SECOURS: '#2471A3',
  PAS_DE_GE: '#9CA3AF',
};

type MarkerMap = Record<string, L.CircleMarker | null>;

/** Barre de recherche superposée à la carte : centre/zoome sur le site choisi. */
function SearchControl({ features, markers, onSelect }: { features: SiteFeature[]; markers: React.MutableRefObject<MarkerMap>; onSelect: (id: string) => void }) {
  const map = useMap();
  const [q, setQ] = useState('');
  const boxRef = useRef<HTMLDivElement>(null);

  // Empêche la carte de capter les clics/scroll/drag pendant la saisie.
  useEffect(() => {
    if (boxRef.current) {
      L.DomEvent.disableClickPropagation(boxRef.current);
      L.DomEvent.disableScrollPropagation(boxRef.current);
    }
  }, []);

  const term = q.trim().toLowerCase();
  const results = term.length >= 1
    ? features
        .filter((f) => `${f.properties.nom} ${f.properties.region}`.toLowerCase().includes(term))
        .slice(0, 8)
    : [];

  const pick = (f: SiteFeature) => {
    const [lng, lat] = f.geometry.coordinates;
    map.flyTo([lat, lng], 14, { duration: 0.8 });
    setQ('');
    onSelect(f.properties.id); // surbrillance pulsée temporaire
    // Ouvre le popup du marqueur une fois le déplacement lancé.
    setTimeout(() => markers.current[f.properties.id]?.openPopup(), 450);
  };

  return (
    <div ref={boxRef} className="absolute top-3 left-1/2 -translate-x-1/2 z-[1000] w-72 max-w-[85%]">
      <div className="relative">
        <Search size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Rechercher un site (nom, région)…"
          className="w-full rounded-lg border border-gray-200 bg-white/95 py-2 pl-8 pr-8 text-sm shadow-md outline-none focus:border-[#2471A3]"
        />
        {q && (
          <button onClick={() => setQ('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
            <X size={15} />
          </button>
        )}
      </div>
      {results.length > 0 && (
        <ul className="mt-1 max-h-64 overflow-y-auto rounded-lg border border-gray-100 bg-white shadow-lg">
          {results.map((f) => (
            <li key={f.properties.id}>
              <button
                onClick={() => pick(f)}
                className="block w-full px-3 py-2 text-left text-sm hover:bg-gray-50"
              >
                <span className="font-medium text-gray-800">{f.properties.nom}</span>
                <span className="block text-xs text-gray-400">{f.properties.region}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {term.length >= 1 && results.length === 0 && (
        <div className="mt-1 rounded-lg border border-gray-100 bg-white px-3 py-2 text-sm text-gray-400 shadow-lg">Aucun site trouvé</div>
      )}
    </div>
  );
}

/** Mode RÉSEAU (vue NOC) : état de coupure par site — prime sur la couleur stock. */
export type EtatReseau = { etat: 'DOWN' | 'IMPACTE'; note?: string };

export function SitesMap({ features, couleurParCamion, etatReseauParSite }: {
  features: SiteFeature[];
  couleurParCamion?: Record<string, string>;
  /** Présent = mode réseau : rouge (en coupure) / ambre (aval) / vert (en service). */
  etatReseauParSite?: Record<string, EtatReseau>;
}) {
  const markers = useRef<MarkerMap>({});
  const [highlightId, setHighlightId] = useState<string | null>(null);

  // La surbrillance s'estompe automatiquement au bout de quelques secondes.
  useEffect(() => {
    if (!highlightId) return;
    const t = setTimeout(() => setHighlightId(null), 5000);
    return () => clearTimeout(t);
  }, [highlightId]);

  const highlighted = highlightId ? features.find((f) => f.properties.id === highlightId) : null;

  return (
    <MapContainer center={[8.6, 1.0]} zoom={7} scrollWheelZoom className="h-full w-full rounded-xl">
      <SearchControl features={features} markers={markers} onSelect={setHighlightId} />
      {highlighted && (
        <CircleMarker
          center={[highlighted.geometry.coordinates[1], highlighted.geometry.coordinates[0]]}
          radius={16}
          interactive={false}
          pathOptions={{ className: 'site-pulse', color: '#F59E0B', fillOpacity: 0, weight: 3 }}
        />
      )}
      <TileLayer
        attribution='&copy; OpenStreetMap'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      {features.map((f) => {
        const [lng, lat] = f.geometry.coordinates;
        const n = f.properties.niveauStock;
        // Vue transporteur : la pastille porte la couleur DU CAMION qui dessert
        // le site — violet quand plusieurs camions se partagent le même site.
        const vueLivraison = f.properties.aLivrerLitres != null;
        const camions = f.properties.camions ?? [];
        const couleurLivraison = camions.length > 1
          ? COULEUR_MULTI_CAMIONS
          : (couleurParCamion?.[camions[0] ?? ''] ?? '#2471A3');
        // Mode RÉSEAU (NOC) : l'état de coupure prime — rouge = en coupure,
        // ambre = aval d'un site down, vert = en service (palette topologie).
        const reseau = etatReseauParSite?.[f.properties.id];
        const color = vueLivraison ? couleurLivraison
          : etatReseauParSite
            ? (reseau?.etat === 'DOWN' ? '#C0392B' : reseau?.etat === 'IMPACTE' ? '#E67E22' : '#0E7C6B')
          : n === 'CRITIQUE' || n === 'VIDE' ? '#DC2626'
          : n === 'FAIBLE' ? '#F59E0B'
          : (STATUT_COLOR[f.properties.statutGE] ?? '#9CA3AF');
        return (
          <CircleMarker
            key={f.properties.id}
            center={[lat, lng]}
            radius={6}
            pathOptions={{ color, fillColor: color, fillOpacity: 0.8, weight: 1 }}
            ref={(m) => { markers.current[f.properties.id] = m; }}
          >
            <Popup>
              <div className="text-xs">
                <p className="font-bold text-gray-800">{f.properties.nom}</p>
                <p className="text-gray-500">{f.properties.code} · {f.properties.region}</p>
                {/* Vue transporteur : rien de l'exploitation ne sort — seulement
                    ce que SON plan prévoit encore de déposer ici. */}
                {vueLivraison && (
                  <div className="mt-1 rounded bg-blue-50 p-1.5 leading-snug">
                    <p>À livrer : <b>{Math.round(f.properties.aLivrerLitres!)} L</b></p>
                    {(f.properties.livraisons ?? []).map((lv) => (
                      <p key={`${lv.numeroBL}-${lv.immatriculation}`} className="mt-0.5 flex items-center gap-1.5 text-gray-600">
                        <span className="inline-block h-2 w-2 flex-shrink-0 rounded-full"
                          style={{ background: couleurParCamion?.[lv.immatriculation] ?? '#2471A3' }} />
                        <span>{lv.immatriculation} · {lv.numeroBL} · <b>{lv.restant} L</b></span>
                      </p>
                    ))}
                  </div>
                )}
                {!vueLivraison && (
                  <p className="mt-1">GE : {f.properties.statutGE} · {f.properties.puissanceGEkva} kVA</p>
                )}
                {etatReseauParSite && (
                  <p className="mt-1 font-semibold" style={{ color: reseau?.etat === 'DOWN' ? '#C0392B' : reseau?.etat === 'IMPACTE' ? '#B9770E' : '#0E7C6B' }}>
                    {reseau?.etat === 'DOWN' ? `EN COUPURE${reseau.note ? ` — ${reseau.note}` : ''}`
                      : reseau?.etat === 'IMPACTE' ? 'Aval d\'un site en coupure'
                      : 'En service'}
                  </p>
                )}
                {f.properties.niveauStock && f.properties.niveauStock !== 'NA' && (() => {
                  const badge = (
                    <span style={{ color: NIVEAU_STOCK[f.properties.niveauStock!]?.color ?? '#6B7280', fontWeight: 600 }}>
                      {NIVEAU_STOCK[f.properties.niveauStock!]?.label ?? f.properties.niveauStock}
                    </span>
                  );
                  const hasEstime = f.properties.stockEstime != null;
                  return (
                    <div className="mt-1 rounded bg-gray-50 p-1.5 leading-snug">
                      <p>
                        Dernier relevé : <b>{Math.round(f.properties.stockLitres ?? 0)} L</b>
                        {fmtDateCourt(f.properties.derniereMesure) && <span className="text-gray-400"> · {fmtDateCourt(f.properties.derniereMesure)}</span>}
                        {!hasEstime && <> · {badge}</>}
                      </p>
                      {hasEstime && (
                        <p>
                          Estimé aujourd’hui : <b>{Math.round(f.properties.stockEstime!)} L</b> · {badge}
                          {f.properties.tendance && <span className="text-gray-400"> {TENDANCE_ICON[f.properties.tendance] ?? ''}</span>}
                          {f.properties.autonomieJours != null && <span> · autonomie {f.properties.autonomieJours} j</span>}
                        </p>
                      )}
                      {f.properties.heuresGEJour != null && (
                        <p className="text-gray-500">GE : ~{f.properties.heuresGEJour} h/jour</p>
                      )}
                      {f.properties.sourceConso && (
                        <p className="text-gray-400">
                          Conso {({ horametre: 'mesurée (compteur)', historique: 'd’après relevés', regional: 'estimée (région)', theorique: 'théorique' } as Record<string, string>)[f.properties.sourceConso] ?? f.properties.sourceConso}
                        </p>
                      )}
                      {fmtDateCourt(f.properties.dateRupture) && (
                        <p className="text-gray-500">Rupture estimée : {fmtDateCourt(f.properties.dateRupture)}</p>
                      )}
                      {f.properties.dernierDepotageVol != null && (
                        <p className="text-gray-500">
                          Dernier dépotage : {Math.round(f.properties.dernierDepotageVol)} L
                          {fmtDateCourt(f.properties.dernierDepotageDate) && ` · ${fmtDateCourt(f.properties.dernierDepotageDate)}`}
                        </p>
                      )}
                    </div>
                  );
                })()}
                <div className="mt-1 flex flex-col gap-0.5">
                  {!vueLivraison && <a href={`/sites/${f.properties.id}`} className="text-[#2471A3] underline">Voir la fiche →</a>}
                  <a href={`https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`} target="_blank" rel="noreferrer" className="text-[#0E7C6B] underline">🧭 Itinéraire →</a>
                </div>
              </div>
            </Popup>
          </CircleMarker>
        );
      })}
    </MapContainer>
  );
}
