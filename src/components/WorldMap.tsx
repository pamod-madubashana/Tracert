import { HopData } from "@/types/trace";
import { Globe } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";

import * as am5 from "@amcharts/amcharts5";
import * as am5map from "@amcharts/amcharts5/map";
import am5geodata_worldLow from "@amcharts/amcharts5-geodata/worldLow";

interface WorldMapProps {
  hops: HopData[];
  compact?: boolean;
  selectedHop?: number | null;
  onSelectHop?: (hopNumber: number) => void;
}

type ParticleDef = {
  id: string;
  start: [number, number]; // [lng, lat]
  end: [number, number];
  progress: number; // 0..1
  speed: number; // delta per tick
};

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));

// Reads a CSS var containing "H S% L%" (e.g. "185 100% 50%")
const readHslVar = (varName: string) =>
  getComputedStyle(document.documentElement).getPropertyValue(varName).trim();

const hslToRgb = (h: number, s: number, l: number) => {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = h / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));

  let r1 = 0,
    g1 = 0,
    b1 = 0;
  if (hp >= 0 && hp < 1) [r1, g1, b1] = [c, x, 0];
  else if (hp >= 1 && hp < 2) [r1, g1, b1] = [x, c, 0];
  else if (hp >= 2 && hp < 3) [r1, g1, b1] = [0, c, x];
  else if (hp >= 3 && hp < 4) [r1, g1, b1] = [0, x, c];
  else if (hp >= 4 && hp < 5) [r1, g1, b1] = [x, 0, c];
  else if (hp >= 5 && hp < 6) [r1, g1, b1] = [c, 0, x];

  const m = l - c / 2;
  return {
    r: Math.round((r1 + m) * 255),
    g: Math.round((g1 + m) * 255),
    b: Math.round((b1 + m) * 255),
  };
};

const hslCssToAm5Color = (varName: string) => {
  const raw = readHslVar(varName);
  // Expected: "185 100% 50%" (no hsl() wrapper)
  const parts = raw.split(/\s+/);
  const h = Number(parts[0] ?? 0);
  const s = Number(String(parts[1] ?? "0").replace("%", "")) / 100;
  const l = Number(String(parts[2] ?? "0").replace("%", "")) / 100;
  const { r, g, b } = hslToRgb(clamp(h, 0, 360), clamp(s, 0, 1), clamp(l, 0, 1));
  return am5.color((r << 16) | (g << 8) | b);
};

const WorldMap = ({ hops, compact = false, selectedHop = null, onSelectHop }: WorldMapProps) => {
  const chartDivRef = useRef<HTMLDivElement | null>(null);
  // Let the chart fill whatever space the panel gets in the no-scroll layout
  // (fixed heights make the map feel tiny when zoomed out on larger screens)

  // Keep amCharts instances stable to avoid flicker/black frames during frequent hop updates
  const rootRef = useRef<am5.Root | null>(null);
  const chartRef = useRef<am5map.MapChart | null>(null);
  const lineSeriesRef = useRef<am5map.MapLineSeries | null>(null);
  const pointSeriesRef = useRef<am5map.MapPointSeries | null>(null);
  const particleSeriesRef = useRef<am5map.MapPointSeries | null>(null);
  const particleTickRef = useRef<number | null>(null);
  const particlesRef = useRef<ParticleDef[]>([]);
  const particleItemByIdRef = useRef<Record<string, am5.DataItem<any> | undefined>>({});
  
  // Focus optimization refs
  const didInitialFocusRef = useRef(false);
  const focusedOriginKeyRef = useRef<string | null>(null);

  const selectedHopRef = useRef<number | null>(selectedHop);
  const onSelectHopRef = useRef<WorldMapProps["onSelectHop"]>(onSelectHop);

  useEffect(() => {
    selectedHopRef.current = selectedHop;
  }, [selectedHop]);

  useEffect(() => {
    onSelectHopRef.current = onSelectHop;
  }, [onSelectHop]);

  // Helper function to check if an IP is private
  const isPrivateIp = (ip?: string | null) => {
    if (!ip) return true;
    if (ip.startsWith("10.")) return true;
    if (ip.startsWith("192.168.")) return true;
    if (ip.startsWith("172.")) {
      const parts = ip.split(".");
      if (parts.length > 1) {
        const secondOctet = Number(parts[1]);
        return secondOctet >= 16 && secondOctet <= 31;
      }
    }
    return false;
  };

  // Helper function to check if hop has valid geo
  const hasValidGeo = (h: HopData) =>
    !!h.geo &&
    typeof h.geo.lat === "number" &&
    typeof h.geo.lng === "number" &&
    !(h.geo.lat === 0 && h.geo.lng === 0);

  // Normalize longitude pair to handle dateline wrapping
  const normalizeLngPair = (aLng: number, bLng: number) => {
    let b = bLng;
    const d = b - aLng;
    if (Math.abs(d) > 180) b = d > 0 ? b - 360 : b + 360;
    return [aLng, b] as const;
  };

  // Create curved geo line between two points
  function curvedGeoLine(
    start: [number, number], // [lng, lat]
    end: [number, number],
    seed: number,
    opts?: {
      steps?: number;          // how many points
      curveFactor?: number;    // curvature strength
      maxBendDeg?: number;     // max bend in degrees
    }
  ): [number, number][] {
    const { steps = 18, curveFactor = 0.18, maxBendDeg = 12 } = opts ?? {};

    let [lng1, lat1] = start;
    let [lng2, lat2] = end;

    // dateline normalization (shortest direction)
    const dLng = lng2 - lng1;
    if (Math.abs(dLng) > 180) lng2 = dLng > 0 ? lng2 - 360 : lng2 + 360;

    // "flat-ish" projection for curvature math (equirectangular-ish)
    const rad = Math.PI / 180;
    const avgLat = (lat1 + lat2) * 0.5;
    const x1 = lng1 * Math.cos(avgLat * rad);
    const y1 = lat1;
    const x2 = lng2 * Math.cos(avgLat * rad);
    const y2 = lat2;

    const dx = x2 - x1;
    const dy = y2 - y1;
    const dist = Math.hypot(dx, dy);

    // perpendicular normal
    const nx = -(dy / (dist || 1));
    const ny = dx / (dist || 1);

    // stable curve side (alternating by seed)
    const side = seed % 2 === 0 ? 1 : -1;

    // curvature magnitude in "degrees", clamped
    const bend = clamp(dist * curveFactor, 2, maxBendDeg) * side;

    // control point at midpoint + normal offset
    const mx = (x1 + x2) * 0.5 + nx * bend;
    const my = (y1 + y2) * 0.5 + ny * bend;

    // sample quadratic Bezier in this projected space
    const coords: [number, number][] = [];
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const it = 1 - t;

      const x = it * it * x1 + 2 * it * t * mx + t * t * x2;
      const y = it * it * y1 + 2 * it * t * my + t * t * y2;

      // back to lng using same avgLat scale
      const lng = x / Math.cos(avgLat * rad);
      const lat = y;

      // keep lng in [-180, 180] so amCharts behaves
      const wrappedLng = ((lng + 180) % 360 + 360) % 360 - 180;

      coords.push([wrappedLng, lat]);
    }

    return coords;
  }

  // Find the first public hop with valid geo coordinates for the origin
  const originGeo = useMemo(() => {
    const firstPublic = hops.find(h => h.ip && !isPrivateIp(h.ip) && hasValidGeo(h));
    return firstPublic || null;
  }, [hops]);

  // Filter for hops that are public and have valid geo coordinates
  const hopsWithGeo = useMemo(() => 
    hops.filter(h => h.ip && !isPrivateIp(h.ip) && hasValidGeo(h)), 
    [hops]
  );

  // Reset focus flags when a new trace starts
  useEffect(() => {
    // new trace: no geo points yet
    if (hopsWithGeo.length === 0) {
      didInitialFocusRef.current = false;
      focusedOriginKeyRef.current = null;
    }
  }, [hopsWithGeo.length]);

  useEffect(() => {
    if (!chartDivRef.current) return;
    if (rootRef.current) return;

    // Theme colors from semantic tokens (no hardcoded colors)
    const cBackground = hslCssToAm5Color("--background");
    const cCard = hslCssToAm5Color("--card");
    const cBorder = hslCssToAm5Color("--border");
    const cPrimary = hslCssToAm5Color("--primary");
    const cSecondary = hslCssToAm5Color("--secondary");
    const cAccent = hslCssToAm5Color("--accent");
    const cMuted = hslCssToAm5Color("--muted");

    const root = am5.Root.new(chartDivRef.current);
    rootRef.current = root;
    root.interfaceColors.set("text", cPrimary);

    const chart = root.container.children.push(
      am5map.MapChart.new(root, {
        projection: am5map.geoMercator(),
        // Allow free panning in both directions (user requested up/down + left/right drag)
        panX: "translateX",
        panY: "translateY",
        wheelX: "none",
        wheelY: "zoom",
        pinchZoom: true,
        minZoomLevel: 1.25,
        maxZoomLevel: 32,
        animationDuration: 650,
        animationEasing: am5.ease.out(am5.ease.sine),
        homeZoomLevel: 1.25,
        centerMapOnZoomOut: true,
        background: am5.Rectangle.new(root, {
          fill: cBackground,
          fillOpacity: 1,
        }),
      })
    );
    chartRef.current = chart;

    chart.chartContainer.setAll({ wheelable: true });

    const polygonSeries = chart.series.push(
      am5map.MapPolygonSeries.new(root, {
        geoJSON: am5geodata_worldLow as any,
        exclude: ["AQ"],
      })
    );
    polygonSeries.mapPolygons.template.setAll({
      fill: cCard,
      fillOpacity: 0.35,
      stroke: cBorder,
      strokeOpacity: 0.3,
      strokeWidth: 1,
    });

    const graticuleSeries = chart.series.push(am5map.GraticuleSeries.new(root, { step: 20 }));
    graticuleSeries.mapLines.template.setAll({
      stroke: cPrimary,
      strokeOpacity: 0.06,
      strokeWidth: 1,
    });

    const lineSeries = chart.series.push(am5map.MapLineSeries.new(root, {}));
    lineSeriesRef.current = lineSeries;
    lineSeries.mapLines.template.setAll({
      stroke: cPrimary,
      strokeOpacity: 0.55,
      strokeWidth: 2,
      strokeDasharray: [6, 6],
    });
    lineSeries.mapLines.template.events.on("dataitemchanged", (ev) => {
      const line = ev.target;
      const duration = 800;
      line.animate({ key: "strokeDashoffset", from: 0, to: -24, duration, loops: Infinity });
      line.animate({
        key: "strokeOpacity",
        from: 0.25,
        to: 0.75,
        duration: duration * 1.4,
        loops: Infinity,
        easing: am5.ease.inOut(am5.ease.sine),
      });
    });

    const particleSeries = chart.series.push(am5map.MapPointSeries.new(root, {}));
    particleSeriesRef.current = particleSeries;
    particleSeries.bullets.push(() => {
      const dot = am5.Circle.new(root, {
        radius: compact ? 2.5 : 3,
        fill: cAccent,
        // Keep particles crisp (no pulsing/glow) to avoid the "green pulse" effect
        fillOpacity: 0.85,
        strokeOpacity: 0,
        strokeWidth: 0,
      });
      return am5.Bullet.new(root, { sprite: dot });
    });

    const pointSeries = chart.series.push(am5map.MapPointSeries.new(root, {}));
    pointSeriesRef.current = pointSeries;
    pointSeries.bullets.push(() => {
      const circle = am5.Circle.new(root, {
        radius: compact ? 5 : 6,
        fillOpacity: 0.2,
        strokeWidth: 2,
      });

      const label = am5.Label.new(root, {
        centerX: am5.p50,
        centerY: am5.p50,
        fontSize: compact ? 10 : 11,
        fontFamily: "Orbitron, sans-serif",
        textAlign: "center",
        populateText: true,
      });

      const container = am5.Container.new(root, { centerX: am5.p50, centerY: am5.p50 });
      container.children.push(circle);
      container.children.push(label);

      container.events.on("click", (ev) => {
        const dataItem = (ev.target as any).dataItem as any;
        const ctx = dataItem?.dataContext as any;
        const coords = ctx?.geometry?.coordinates as [number, number] | undefined;
        const hopNumber = ctx?.hopNumber;
        if (typeof hopNumber === "number") onSelectHopRef.current?.(hopNumber);
        if (coords && typeof coords[0] === "number" && typeof coords[1] === "number") {
          chart.zoomToGeoPoint({ longitude: coords[0], latitude: coords[1] }, 3, true);
        }
      });

      container.adapters.add("tooltipText", (_text, target) => {
        const dataItem = (target as any).dataItem as any;
        const ctx = dataItem?.dataContext as any;
        const city = ctx?.city ? String(ctx.city) : "Unknown";
        const cc = ctx?.countryCode ? String(ctx.countryCode) : "";
        return cc ? `${city} (${cc})` : city;
      });

      circle.adapters.add("stroke", (_stroke, target) => {
        const dataItem = (target as any).dataItem as any;
        const ctx = dataItem?.dataContext as any;
        if (typeof ctx?.hopNumber === "number" && ctx.hopNumber === selectedHopRef.current) return cAccent;
        if (ctx?.role === "source") return cAccent;
        if (ctx?.role === "destination") return cSecondary;
        return cPrimary;
      });
      circle.adapters.add("fill", (_fill, target) => {
        const dataItem = (target as any).dataItem as any;
        const ctx = dataItem?.dataContext as any;
        if (typeof ctx?.hopNumber === "number" && ctx.hopNumber === selectedHopRef.current) return cAccent;
        if (ctx?.role === "source") return cAccent;
        if (ctx?.role === "destination") return cSecondary;
        return cPrimary;
      });
      circle.adapters.add("radius", (_radius, target) => {
        const dataItem = (target as any).dataItem as any;
        const ctx = dataItem?.dataContext as any;
        const base = compact ? 5 : 6;
        return typeof ctx?.hopNumber === "number" && ctx.hopNumber === selectedHopRef.current ? base + 2 : base;
      });
      circle.adapters.add("strokeWidth", (_sw, target) => {
        const dataItem = (target as any).dataItem as any;
        const ctx = dataItem?.dataContext as any;
        return typeof ctx?.hopNumber === "number" && ctx.hopNumber === selectedHopRef.current ? 3 : 2;
      });
      circle.adapters.add("fillOpacity", (_fo, target) => {
        const dataItem = (target as any).dataItem as any;
        const ctx = dataItem?.dataContext as any;
        return typeof ctx?.hopNumber === "number" && ctx.hopNumber === selectedHopRef.current ? 0.35 : 0.2;
      });

      label.adapters.add("text", (_text, target) => {
        const dataItem = (target as any).dataItem as any;
        const ctx = dataItem?.dataContext as any;
        return String(ctx?.markerLabel ?? "");
      });
      label.adapters.add("fill", (_fill, target) => {
        const dataItem = (target as any).dataItem as any;
        const ctx = dataItem?.dataContext as any;
        if (ctx?.role === "source") return cAccent;
        if (ctx?.role === "destination") return cSecondary;
        return cPrimary;
      });

      return am5.Bullet.new(root, { sprite: container });
    });

    chart.children.push(
      am5.Rectangle.new(root, {
        width: am5.p100,
        height: am5.p100,
        fill: cMuted,
        fillOpacity: 0.08,
        isMeasured: false,
      })
    );

    return () => {
      if (particleTickRef.current) window.clearInterval(particleTickRef.current);
      particleTickRef.current = null;
      root.dispose();
      rootRef.current = null;
      chartRef.current = null;
      lineSeriesRef.current = null;
      pointSeriesRef.current = null;
      particleSeriesRef.current = null;
    };
  }, []);

  useEffect(() => {
    const chart = chartRef.current;
    const lineSeries = lineSeriesRef.current;
    const pointSeries = pointSeriesRef.current;
    const particleSeries = particleSeriesRef.current;
    if (!chart || !lineSeries || !pointSeries || !particleSeries) return;

    const points = hopsWithGeo.map((hop, idx) => {
      // Determine role based on whether this is the first public hop with valid geo
      const isFirstPublic = originGeo && hop.hop === originGeo.hop;
      const role = isFirstPublic ? "source" : idx === hopsWithGeo.length - 1 ? "destination" : "hop";
      return {
        geometry: { type: "Point", coordinates: [hop.geo!.lng, hop.geo!.lat] },
        hopNumber: hop.hop,
        role,
        markerLabel: role === "source" ? "S" : role === "destination" ? "D" : String(hop.hop),
        city: hop.geo?.city,
        countryCode: hop.geo?.countryCode,
      };
    });
    pointSeries.data.setAll(points as any);

    const lines = hopsWithGeo.slice(0, -1).map((hop, idx) => {
      const next = hopsWithGeo[idx + 1];

      const start: [number, number] = [hop.geo!.lng, hop.geo!.lat];
      const end: [number, number] = [next.geo!.lng, next.geo!.lat];

      return {
        geometry: {
          type: "LineString",
          coordinates: curvedGeoLine(start, end, hop.hop, {
            steps: compact ? 14 : 18,
            curveFactor: 0.18,  // lower = less indirect
            maxBendDeg: 10,     // hard cap to prevent crazy curves
          }),
        },
      };
    });
    lineSeries.data.setAll(lines as any);

    if (particleTickRef.current) window.clearInterval(particleTickRef.current);
    particleTickRef.current = null;

    // If we don't have at least one segment, ensure no stray particles remain.
    if (hopsWithGeo.length < 2) {
      particlesRef.current = [];
      particleItemByIdRef.current = {};
      particleSeries.data.setAll([] as any);
      if (hopsWithGeo.length === 0) {
        chart.goHome(0);
      } else if (originGeo && originGeo.geo) {
        // If we have origin geo but not enough segments, focus on the origin
        chart.zoomToGeoPoint({ longitude: originGeo.geo.lng!, latitude: originGeo.geo.lat! }, 3, true);
      }
      return;
    }

    const segmentPairs = hopsWithGeo.slice(0, -1).map((hop, idx) => {
      const next = hopsWithGeo[idx + 1];
      return {
        start: [hop.geo!.lng, hop.geo!.lat] as [number, number],
        end: [next.geo!.lng, next.geo!.lat] as [number, number],
      };
    });

    const particles: ParticleDef[] = segmentPairs.flatMap((seg, i) =>
      [0, 1].map((j) => ({
        id: `p-${i}-${j}`,
        start: seg.start,
        end: seg.end,
        progress: ((j * 0.5) + (i * 0.15)) % 1,
        speed: (compact ? 0.008 : 0.011) + Math.random() * (compact ? 0.004 : 0.006),
      }))
    );
    particlesRef.current = particles;

    particleSeries.data.setAll(
      particles.map((p) => ({
        id: p.id,
        geometry: {
          type: "Point",
          coordinates: [
            p.start[0] + (p.end[0] - p.start[0]) * p.progress,
            p.start[1] + (p.end[1] - p.start[1]) * p.progress,
          ],
        },
      })) as any
    );

    // Build a stable lookup by id so we don't update the wrong dataItem (prevents "random dots").
    const byId: Record<string, am5.DataItem<any> | undefined> = {};
    for (const item of particleSeries.dataItems) {
      const ctx: any = item.dataContext as any;
      const id = ctx?.id;
      if (typeof id === "string") byId[id] = item as any;
    }
    particleItemByIdRef.current = byId;

    if (particles.length > 0) {
      particleTickRef.current = window.setInterval(() => {
        const ps = particlesRef.current;
        const map = particleItemByIdRef.current;
        for (let i = 0; i < ps.length; i++) {
          const p = ps[i];
          p.progress = (p.progress + p.speed) % 1;
          const lng = p.start[0] + (p.end[0] - p.start[0]) * p.progress;
          const lat = p.start[1] + (p.end[1] - p.start[1]) * p.progress;
          const item = map[p.id];
          if (!item) continue;
          item.set("geometry", { type: "Point", coordinates: [lng, lat] } as any);
        }
      }, 40);
    }
      
    // Focus on the origin point if it exists (only once per trace or origin change)
    if (originGeo?.geo?.lng != null && originGeo?.geo?.lat != null) {
      const key = `${originGeo.hop}:${originGeo.geo.lng}:${originGeo.geo.lat}`;

      // focus only once per trace (or if origin actually changes)
      if (!didInitialFocusRef.current || focusedOriginKeyRef.current !== key) {
        didInitialFocusRef.current = true;
        focusedOriginKeyRef.current = key;

        chart.zoomToGeoPoint(
          { longitude: originGeo.geo.lng, latitude: originGeo.geo.lat },
          3,
          true
        );
      }
    }
  }, [compact, hopsWithGeo, originGeo]);

  return (
    <div className="cyber-panel p-2 glow-border h-full flex flex-col">
      <div className="flex items-center gap-2 mb-2">
        <Globe className="w-3 h-3 text-primary" />
        <span className="font-display text-[10px] tracking-wider text-primary uppercase">
          Global Route
        </span>
        <span className="ml-auto text-[10px] text-muted-foreground font-mono">
          {hopsWithGeo.length} nodes
        </span>
      </div>

         <div className="relative bg-background/50 border border-border/50 rounded overflow-hidden flex-1 min-h-0">
          <div ref={chartDivRef} className="w-full h-full" />
         {hopsWithGeo.length === 0 && (
           <div className="absolute inset-0 flex items-center justify-center">
             <div className="text-[12px] text-muted-foreground font-mono">Awaiting trace data...</div>
           </div>
         )}
       </div>

    </div>
  );
};

export default WorldMap;