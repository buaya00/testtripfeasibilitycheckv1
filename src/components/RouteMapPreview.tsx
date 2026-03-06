import { useRef, useEffect, useState, useCallback } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { MapPin } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { OverflightResult } from "./tripTypes";

mapboxgl.accessToken =
  "pk.eyJ1Ijoid3RheWxvcmFlZyIsImEiOiJjbW1mYzN2aDYwNndnMnBvcmp5NGdnc2FkIn0.qQDK6fB9LryU8xKC1toy0g";

interface RoutePoint {
  icao: string;
  lat: number;
  lon: number;
}

interface RouteMapPreviewProps {
  origin: RoutePoint;
  destination: RoutePoint;
  overflightResult: OverflightResult;
}

function buildRouteGeoJSON(origin: RoutePoint, destination: RoutePoint) {
  return {
    type: "Feature" as const,
    properties: {},
    geometry: {
      type: "LineString" as const,
      coordinates: [
        [origin.lon, origin.lat],
        [destination.lon, destination.lat],
      ],
    },
  };
}

function buildAirportPoints(origin: RoutePoint, destination: RoutePoint) {
  return {
    type: "FeatureCollection" as const,
    features: [
      {
        type: "Feature" as const,
        properties: { icao: origin.icao },
        geometry: { type: "Point" as const, coordinates: [origin.lon, origin.lat] },
      },
      {
        type: "Feature" as const,
        properties: { icao: destination.icao },
        geometry: { type: "Point" as const, coordinates: [destination.lon, destination.lat] },
      },
    ],
  };
}

function fitMapToBounds(
  map: mapboxgl.Map,
  origin: RoutePoint,
  destination: RoutePoint,
  padding = 40,
) {
  const bounds = new mapboxgl.LngLatBounds();
  bounds.extend([origin.lon, origin.lat]);
  bounds.extend([destination.lon, destination.lat]);
  map.fitBounds(bounds, { padding, duration: 0 });
}

function addRouteLayers(map: mapboxgl.Map, origin: RoutePoint, destination: RoutePoint) {
  // Route line
  map.addSource("route", {
    type: "geojson",
    data: buildRouteGeoJSON(origin, destination),
  });
  map.addLayer({
    id: "route-line",
    type: "line",
    source: "route",
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-color": "#3b82f6",
      "line-width": 3,
      "line-dasharray": [2, 2],
    },
  });

  // Airport dots
  map.addSource("airports", {
    type: "geojson",
    data: buildAirportPoints(origin, destination),
  });
  map.addLayer({
    id: "airport-dots",
    type: "circle",
    source: "airports",
    paint: {
      "circle-radius": 5,
      "circle-color": "#1d4ed8",
      "circle-stroke-width": 2,
      "circle-stroke-color": "#ffffff",
    },
  });
  map.addLayer({
    id: "airport-labels",
    type: "symbol",
    source: "airports",
    layout: {
      "text-field": ["get", "icao"],
      "text-size": 11,
      "text-offset": [0, 1.5],
      "text-anchor": "top",
      "text-font": ["DIN Pro Medium", "Arial Unicode MS Regular"],
    },
    paint: {
      "text-color": "#1e3a5f",
      "text-halo-color": "#ffffff",
      "text-halo-width": 1.5,
    },
  });
}

/** Tiny preview map shown on hover */
function MiniMap({ origin, destination }: { origin: RoutePoint; destination: RoutePoint }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: "mapbox://styles/mapbox/light-v11",
      interactive: false,
      attributionControl: false,
    });
    mapRef.current = map;
    map.on("load", () => {
      addRouteLayers(map, origin, destination);
      fitMapToBounds(map, origin, destination, 30);
    });
    return () => { map.remove(); mapRef.current = null; };
  }, [origin, destination]);

  return <div ref={containerRef} className="w-full h-full rounded" />;
}

/** Full interactive map in modal */
function FullMap({
  origin,
  destination,
  overflightResult,
}: {
  origin: RoutePoint;
  destination: RoutePoint;
  overflightResult: OverflightResult;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: "mapbox://styles/mapbox/light-v11",
      attributionControl: false,
    });
    map.addControl(new mapboxgl.NavigationControl(), "top-right");
    mapRef.current = map;

    map.on("load", () => {
      addRouteLayers(map, origin, destination);
      fitMapToBounds(map, origin, destination, 60);

      // Highlight overflown country boundaries via the admin-0 tileset
      const countries = overflightResult.countries?.map((c) => c.country) ?? [];
      if (countries.length > 0) {
        map.addLayer(
          {
            id: "overflown-fill",
            type: "fill",
            source: "composite",
            "source-layer": "country_boundaries",
            filter: ["in", "name_en", ...countries],
            paint: {
              "fill-color": [
                "case",
                [
                  "in",
                  ["get", "name_en"],
                  ["literal", overflightResult.countries
                    ?.filter((c) => c.overflightPermitRequired === "yes")
                    .map((c) => c.country) ?? []],
                ],
                "rgba(234,179,8,0.18)",
                "rgba(59,130,246,0.10)",
              ],
              "fill-outline-color": "rgba(59,130,246,0.35)",
            },
          },
          "route-line",
        );
      }
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [origin, destination, overflightResult]);

  return <div ref={containerRef} className="w-full h-[450px] rounded-md" />;
}

export default function RouteMapPreview({
  origin,
  destination,
  overflightResult,
}: RouteMapPreviewProps) {
  const [modalOpen, setModalOpen] = useState(false);

  const handleClick = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setModalOpen(true);
  }, []);

  const countries = overflightResult.countries ?? [];

  return (
    <>
      <HoverCard openDelay={300} closeDelay={100}>
        <HoverCardTrigger asChild>
          <button
            type="button"
            onClick={handleClick}
            className="inline-flex items-center justify-center h-5 w-5 rounded text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
            title="View route map"
          >
            <MapPin className="h-3.5 w-3.5" />
          </button>
        </HoverCardTrigger>
        <HoverCardContent
          side="top"
          align="start"
          className="w-[280px] h-[180px] p-1 overflow-hidden"
        >
          <MiniMap origin={origin} destination={destination} />
        </HoverCardContent>
      </HoverCard>

      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="max-w-3xl p-0 gap-0 overflow-hidden">
          <DialogHeader className="px-4 pt-4 pb-2">
            <DialogTitle className="text-sm font-semibold">
              Route of Flight — {origin.icao} → {destination.icao}
            </DialogTitle>
          </DialogHeader>
          <FullMap
            origin={origin}
            destination={destination}
            overflightResult={overflightResult}
          />
          {countries.length > 0 && (
            <div className="px-4 py-3 border-t bg-muted/30 max-h-[160px] overflow-y-auto">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">
                Overflown Countries ({countries.length})
              </p>
              <div className="flex flex-wrap gap-1.5">
                {countries.map((c, i) => (
                  <span
                    key={i}
                    className={cn(
                      "inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium border",
                      c.overflightPermitRequired === "yes"
                        ? "bg-warning/10 border-warning/30 text-warning-foreground"
                        : c.overflightPermitRequired === "conditional"
                          ? "bg-accent/10 border-accent/30 text-accent-foreground"
                          : "bg-success/10 border-success/30 text-foreground"
                    )}
                  >
                    {c.overflightPermitRequired === "yes" ? "⚠️ " : "✅ "}
                    {c.country}
                    {c.overflightChargeUsd != null && (
                      <span className="ml-1 text-muted-foreground">
                        ~${c.overflightChargeUsd.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                      </span>
                    )}
                  </span>
                ))}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
