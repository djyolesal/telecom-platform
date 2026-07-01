'use client';

import 'leaflet/dist/leaflet.css';
import { useState, useRef, useEffect } from 'react';
import L from 'leaflet';
import { MapContainer, TileLayer, CircleMarker, Popup, useMap } from 'react-leaflet';
import { Search, X } from 'lucide-react';

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
  };
}

const STATUT_COLOR: Record<string, string> = {
  GE_PERMANENT: '#0E7C6B',
  GE_SECOURS: '#2471A3',
  PAS_DE_GE: '#9CA3AF',
};

type MarkerMap = Record<string, L.CircleMarker | null>;

/** Barre de recherche superposée à la carte : centre/zoome sur le site choisi. */
function SearchControl({ features, markers }: { features: SiteFeature[]; markers: React.MutableRefObject<MarkerMap> }) {
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
        .filter((f) => `${f.properties.code} ${f.properties.nom} ${f.properties.region}`.toLowerCase().includes(term))
        .slice(0, 8)
    : [];

  const pick = (f: SiteFeature) => {
    const [lng, lat] = f.geometry.coordinates;
    map.flyTo([lat, lng], 14, { duration: 0.8 });
    setQ('');
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
          placeholder="Rechercher un site (code, nom, région)…"
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
                <span className="font-medium text-gray-800">{f.properties.code}</span>
                <span className="text-gray-600"> — {f.properties.nom}</span>
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

export function SitesMap({ features }: { features: SiteFeature[] }) {
  const markers = useRef<MarkerMap>({});

  return (
    <MapContainer center={[8.6, 1.0]} zoom={7} scrollWheelZoom className="h-full w-full rounded-xl">
      <SearchControl features={features} markers={markers} />
      <TileLayer
        attribution='&copy; OpenStreetMap'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      {features.map((f) => {
        const [lng, lat] = f.geometry.coordinates;
        const color = STATUT_COLOR[f.properties.statutGE] ?? '#9CA3AF';
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
                <p className="text-gray-600">{f.properties.code}</p>
                <p className="text-gray-500">{f.properties.region}</p>
                <p className="mt-1">GE : {f.properties.statutGE} · {f.properties.puissanceGEkva} kVA</p>
                <div className="mt-1 flex flex-col gap-0.5">
                  <a href={`/sites/${f.properties.id}`} className="text-[#2471A3] underline">Voir la fiche →</a>
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
