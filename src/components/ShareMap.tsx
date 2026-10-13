"use client";

import "leaflet/dist/leaflet.css";
import { CircleMarker, MapContainer, Polyline, TileLayer, Tooltip, useMap } from "react-leaflet";
import { useEffect } from "react";
import { CITIES } from "@/lib/tour/cities";
import type { SharedStop } from "@/lib/tour/share";

function FitBounds({ points }: { points: [number, number][] }) {
  const map = useMap();
  useEffect(() => {
    if (points.length === 0) return;
    if (points.length === 1) map.setView(points[0], 5);
    else map.fitBounds(points, { padding: [24, 24] });
  }, [map, points]);
  return null;
}

/** The routed stops (amber) and, when a counterfactual exists, the baseline route (grey dashes) on OpenStreetMap tiles. */
export default function ShareMap({ stops, baseline }: { stops: SharedStop[]; baseline?: Array<{ order: number; city: string; score: number }> }) {
  const line: [number, number][] = stops.map((s) => [s.lat, s.lon]);
  const coords = new Map(CITIES.map((c) => [c.name, [c.lat, c.lon] as [number, number]]));
  const baseLine: [number, number][] = (baseline ?? []).map((b) => coords.get(b.city)).filter((x): x is [number, number] => !!x);
  return (
    <MapContainer center={[39, -98]} zoom={3} scrollWheelZoom={false} className="h-full w-full">
      <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
      <FitBounds points={[...line, ...baseLine]} />
      {baseLine.length > 1 && <Polyline positions={baseLine} pathOptions={{ color: "#9ca3af", weight: 2, opacity: 0.8, dashArray: "4 6" }} />}
      {(baseline ?? []).map((b) => {
        const c = coords.get(b.city);
        if (!c || stops.some((s) => s.city === b.city)) return null;
        return (
          <CircleMarker key={`b-${b.city}`} center={c} radius={5} pathOptions={{ color: "#9ca3af", fillColor: "#9ca3af", fillOpacity: 0.6, weight: 1 }}>
            <Tooltip direction="top" offset={[0, -4]}>{`${b.city} (baseline only)`}</Tooltip>
          </CircleMarker>
        );
      })}
      {line.length > 1 && <Polyline positions={line} pathOptions={{ color: "#b4532a", weight: 3, opacity: 0.85 }} />}
      {stops.map((s) => (
        <CircleMarker key={s.city} center={[s.lat, s.lon]} radius={7} pathOptions={{ color: "#b4532a", fillColor: "#b4532a", fillOpacity: 0.9, weight: 2 }}>
          <Tooltip direction="top" offset={[0, -4]} className="stop-label" permanent>{`${s.order}. ${s.city}`}</Tooltip>
        </CircleMarker>
      ))}
    </MapContainer>
  );
}
