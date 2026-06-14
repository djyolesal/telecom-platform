'use client';

import 'leaflet/dist/leaflet.css';
import { MapContainer, TileLayer, CircleMarker, Popup } from 'react-leaflet';

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

export function SitesMap({ features }: { features: SiteFeature[] }) {
  return (
    <MapContainer center={[8.6, 1.0]} zoom={7} scrollWheelZoom className="h-full w-full rounded-xl">
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
          >
            <Popup>
              <div className="text-xs">
                <p className="font-bold text-gray-800">{f.properties.code}</p>
                <p className="text-gray-600">{f.properties.nom}</p>
                <p className="text-gray-500">{f.properties.region}</p>
                <p className="mt-1">GE : {f.properties.statutGE} · {f.properties.puissanceGEkva} kVA</p>
                <a href={`/sites/${f.properties.id}`} className="text-[#2471A3] underline">Voir la fiche →</a>
              </div>
            </Popup>
          </CircleMarker>
        );
      })}
    </MapContainer>
  );
}
