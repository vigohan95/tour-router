"use client";

import "leaflet/dist/leaflet.css";
import { CircleMarker, MapContainer, Polyline, TileLayer, Tooltip, useMap } from "react-leaflet";
import { useEffect } from "react";
import type { Itinerary, RankedCity } from "@/lib/tour/types";

/** Leaflet + OpenStreetMap tiles: free, no key. The map only draws what the plan already contains. */

function FitBounds({ points }: { points: [number, number][] }) {
  const map = useMap();
  useEffect(() => {
    if (points.length === 0) return;
    if (points.length === 1) map.setView(points[0], 5);
    else map.fitBounds(points, { padding: [24, 24] });
  }, [map, points]);
  return null;
}

export default function TourMap({ candidates, itinerary }: { candidates: RankedCity[]; itinerary?: Itinerary }) {
  const routed = new Map(itinerary?.stops.map((s) => [s.city, s]) ?? []);
  const line: [number, number][] = itinerary?.stops.map((s) => [s.lat, s.lon]) ?? [];
  const all: [number, number][] = (line.length ? itinerary!.stops : candidates).map((c) => [c.lat, c.lon]);
  return (
    <MapContainer center={[39, -98]} zoom={3} scrollWheelZoom={false} className="h-full w-full">
      <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
      <FitBounds points={all} />
      {candidates.map((c) => {
        const stop = routed.get(c.city);
        const r = 4 + (c.index / 100) * 10;
        const color = c.excluded ? "#9ca3af" : stop ? "#b4532a" : "#2563eb";
        return (
          <CircleMarker key={c.city} center={[c.lat, c.lon]} radius={stop ? r + 2 : r} pathOptions={{ color, fillColor: color, fillOpacity: stop ? 0.9 : 0.45, weight: stop ? 2 : 1 }}>
            <Tooltip direction="top" offset={[0, -4]} className="stop-label" permanent={!!stop}>
              {stop ? `${stop.order}. ${c.city}` : `${c.city} ${c.noSignal ? "unscored" : `${(c.score * 100).toFixed(1)}%`}${c.excluded ? " (excluded)" : ""}`}
            </Tooltip>
          </CircleMarker>
        );
      })}
      {line.length > 1 && <Polyline positions={line} pathOptions={{ color: "#b4532a", weight: 3, opacity: 0.8, dashArray: "6 6" }} />}
    </MapContainer>
  );
}
