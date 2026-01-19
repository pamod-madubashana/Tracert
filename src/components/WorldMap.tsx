import { HopData } from "@/types/trace";
import { Globe, MapPin } from "lucide-react";
import { useMemo } from "react";

interface WorldMapProps {
  hops: HopData[];
}

// Convert lat/lng to SVG coordinates (Mercator-like projection)
const projectToSvg = (lat: number, lng: number, width: number, height: number) => {
  const x = ((lng + 180) / 360) * width;
  const latRad = (lat * Math.PI) / 180;
  const mercN = Math.log(Math.tan(Math.PI / 4 + latRad / 2));
  const y = height / 2 - (mercN * height) / (2 * Math.PI);
  return { x, y: Math.max(20, Math.min(height - 20, y)) };
};

const WorldMap = ({ hops }: WorldMapProps) => {
  const width = 800;
  const height = 400;

  const hopsWithGeo = useMemo(() => 
    hops.filter(h => h.geo && h.status === "success"), 
    [hops]
  );

  const points = useMemo(() => 
    hopsWithGeo.map(hop => ({
      ...projectToSvg(hop.geo!.lat, hop.geo!.lng, width, height),
      hop,
    })),
    [hopsWithGeo]
  );

  return (
    <div className="cyber-panel p-4 glow-border">
      <div className="flex items-center gap-2 mb-4">
        <Globe className="w-4 h-4 text-primary" />
        <span className="font-display text-xs tracking-wider text-primary uppercase">
          Global Route Visualization
        </span>
        <span className="ml-auto text-xs text-muted-foreground font-mono">
          {hopsWithGeo.length} locations mapped
        </span>
      </div>

      <div className="relative bg-background/30 border border-border/50 rounded overflow-hidden">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="w-full h-auto"
          style={{ minHeight: 300 }}
        >
          {/* Grid pattern */}
          <defs>
            <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
              <path
                d="M 40 0 L 0 0 0 40"
                fill="none"
                stroke="hsl(185 100% 50% / 0.05)"
                strokeWidth="0.5"
              />
            </pattern>
            
            {/* Glow filter */}
            <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="3" result="coloredBlur" />
              <feMerge>
                <feMergeNode in="coloredBlur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>

            {/* Animated gradient for paths */}
            <linearGradient id="pathGradient" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="hsl(185 100% 50% / 0.3)" />
              <stop offset="50%" stopColor="hsl(185 100% 50% / 0.8)" />
              <stop offset="100%" stopColor="hsl(185 100% 50% / 0.3)" />
            </linearGradient>

            {/* Particle gradient */}
            <radialGradient id="particleGradient">
              <stop offset="0%" stopColor="hsl(185 100% 70%)" />
              <stop offset="100%" stopColor="hsl(185 100% 50% / 0)" />
            </radialGradient>
          </defs>

          {/* Background grid */}
          <rect width={width} height={height} fill="url(#grid)" />

          {/* World map outline (simplified) */}
          <g opacity="0.3" stroke="hsl(185 100% 50% / 0.3)" fill="none" strokeWidth="0.5">
            {/* Simplified continents outline */}
            <ellipse cx={width / 2} cy={height / 2} rx={width * 0.45} ry={height * 0.4} />
            <line x1={0} y1={height / 2} x2={width} y2={height / 2} strokeDasharray="4 4" />
            <line x1={width / 2} y1={0} x2={width / 2} y2={height} strokeDasharray="4 4" />
          </g>

          {/* Connection paths with particles */}
          {points.slice(0, -1).map((point, index) => {
            const nextPoint = points[index + 1];
            if (!nextPoint) return null;

            const pathId = `path-${index}`;
            
            return (
              <g key={index}>
                {/* Base path */}
                <path
                  id={pathId}
                  d={`M ${point.x} ${point.y} Q ${(point.x + nextPoint.x) / 2} ${Math.min(point.y, nextPoint.y) - 30} ${nextPoint.x} ${nextPoint.y}`}
                  fill="none"
                  stroke="hsl(185 100% 50% / 0.2)"
                  strokeWidth="2"
                />
                
                {/* Animated path overlay */}
                <path
                  d={`M ${point.x} ${point.y} Q ${(point.x + nextPoint.x) / 2} ${Math.min(point.y, nextPoint.y) - 30} ${nextPoint.x} ${nextPoint.y}`}
                  fill="none"
                  stroke="url(#pathGradient)"
                  strokeWidth="2"
                  strokeDasharray="20 100"
                  className="animate-dash"
                  style={{ 
                    animation: `dash 2s linear infinite`,
                    animationDelay: `${index * 0.3}s`
                  }}
                />

                {/* Animated particles along path */}
                {[0, 1, 2].map((particleIndex) => (
                  <circle
                    key={particleIndex}
                    r="4"
                    fill="url(#particleGradient)"
                    filter="url(#glow)"
                  >
                    <animateMotion
                      dur={`${1.5 + particleIndex * 0.5}s`}
                      repeatCount="indefinite"
                      begin={`${particleIndex * 0.5}s`}
                    >
                      <mpath href={`#${pathId}`} />
                    </animateMotion>
                  </circle>
                ))}
              </g>
            );
          })}

          {/* Hop nodes */}
          {points.map((point, index) => (
            <g key={point.hop.hop} filter="url(#glow)">
              {/* Pulse ring */}
              <circle
                cx={point.x}
                cy={point.y}
                r="12"
                fill="none"
                stroke="hsl(185 100% 50% / 0.5)"
                strokeWidth="1"
                className="animate-ping"
                style={{ animationDuration: '2s', animationDelay: `${index * 0.2}s` }}
              />
              
              {/* Node circle */}
              <circle
                cx={point.x}
                cy={point.y}
                r="8"
                fill="hsl(220 20% 8%)"
                stroke={index === 0 ? "hsl(165 100% 45%)" : index === points.length - 1 ? "hsl(200 100% 45%)" : "hsl(185 100% 50%)"}
                strokeWidth="2"
              />
              
              {/* Node number */}
              <text
                x={point.x}
                y={point.y + 3}
                textAnchor="middle"
                fontSize="8"
                fill="hsl(185 100% 70%)"
                fontFamily="Orbitron"
              >
                {point.hop.hop}
              </text>

              {/* Label */}
              <g transform={`translate(${point.x}, ${point.y + 20})`}>
                <rect
                  x="-40"
                  y="-8"
                  width="80"
                  height="16"
                  fill="hsl(220 25% 8% / 0.9)"
                  stroke="hsl(185 100% 50% / 0.3)"
                  rx="2"
                />
                <text
                  x="0"
                  y="3"
                  textAnchor="middle"
                  fontSize="8"
                  fill="hsl(185 100% 70%)"
                  fontFamily="JetBrains Mono"
                >
                  {point.hop.geo?.city || "Unknown"}
                </text>
              </g>
            </g>
          ))}
        </svg>

        {/* Legend */}
        <div className="absolute bottom-2 left-2 flex items-center gap-4 text-[10px] bg-background/80 px-2 py-1 rounded border border-border/50">
          <div className="flex items-center gap-1">
            <div className="w-2 h-2 rounded-full bg-accent border border-accent" />
            <span className="text-muted-foreground">Source</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-2 h-2 rounded-full bg-primary border border-primary" />
            <span className="text-muted-foreground">Hop</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-2 h-2 rounded-full bg-secondary border border-secondary" />
            <span className="text-muted-foreground">Destination</span>
          </div>
        </div>
      </div>

      {/* Location list */}
      {hopsWithGeo.length > 0 && (
        <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-2">
          {hopsWithGeo.slice(0, 8).map((hop) => (
            <div
              key={hop.hop}
              className="flex items-center gap-2 px-2 py-1 bg-muted/20 rounded border border-border/30 text-xs"
            >
              <MapPin className="w-3 h-3 text-primary flex-shrink-0" />
              <div className="truncate">
                <span className="text-primary font-semibold">{hop.hop}.</span>{" "}
                <span className="text-foreground">{hop.geo?.city}</span>
                <span className="text-muted-foreground ml-1">({hop.geo?.countryCode})</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default WorldMap;
