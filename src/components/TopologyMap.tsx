import { HopData } from "@/types/trace";
import { useEffect, useState } from "react";

interface TopologyMapProps {
  hops: HopData[];
  target: string;
}

interface Particle {
  id: number;
  progress: number;
  speed: number;
  lineIndex: number;
}

const TopologyMap = ({ hops, target }: TopologyMapProps) => {
  const [particles, setParticles] = useState<Particle[]>([]);

  // Generate particles for animation
  useEffect(() => {
    if (hops.length < 2) {
      setParticles([]);
      return;
    }

    const lineCount = Math.min(hops.length, 5);
    const newParticles: Particle[] = [];
    
    for (let i = 0; i < lineCount; i++) {
      // Multiple particles per line
      for (let j = 0; j < 3; j++) {
        newParticles.push({
          id: i * 10 + j,
          progress: (j * 33) % 100,
          speed: 0.5 + Math.random() * 0.5,
          lineIndex: i,
        });
      }
    }
    
    setParticles(newParticles);
  }, [hops.length]);

  // Animate particles
  useEffect(() => {
    if (particles.length === 0) return;

    const interval = setInterval(() => {
      setParticles(prev =>
        prev.map(p => ({
          ...p,
          progress: (p.progress + p.speed) % 100,
        }))
      );
    }, 30);

    return () => clearInterval(interval);
  }, [particles.length]);

  const displayHops = hops.slice(0, 5);
  const nodeCount = displayHops.length + 2; // Source + hops + destination

  return (
    <div className="cyber-panel p-6 glow-border min-h-[280px]">
      <div className="flex items-center gap-2 mb-6">
        <div className="w-2 h-2 rounded-full bg-accent pulse-glow" />
        <span className="font-display text-xs tracking-wider text-primary uppercase">
          Network Topology Map
        </span>
      </div>

      {hops.length === 0 ? (
        <div className="flex items-center justify-center h-48 text-muted-foreground">
          <span className="font-mono text-sm">Awaiting trace data...</span>
        </div>
      ) : (
        <div className="relative">
          {/* SVG for particles */}
          <svg 
            className="absolute inset-0 w-full h-full pointer-events-none z-10"
            style={{ height: 120 }}
            preserveAspectRatio="none"
          >
            <defs>
              <linearGradient id="lineGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="hsl(185 100% 50% / 0.1)" />
                <stop offset="50%" stopColor="hsl(185 100% 50% / 0.4)" />
                <stop offset="100%" stopColor="hsl(185 100% 50% / 0.1)" />
              </linearGradient>
              <filter id="particleGlow">
                <feGaussianBlur stdDeviation="2" result="coloredBlur" />
                <feMerge>
                  <feMergeNode in="coloredBlur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>

            {/* Connection lines */}
            {displayHops.map((_, index) => {
              const startX = `${((index + 1) / nodeCount) * 100}%`;
              const endX = `${((index + 2) / nodeCount) * 100}%`;
              return (
                <line
                  key={`line-${index}`}
                  x1={startX}
                  y1="50%"
                  x2={endX}
                  y2="50%"
                  stroke="url(#lineGradient)"
                  strokeWidth="3"
                />
              );
            })}

            {/* Source to first hop line */}
            <line
              x1={`${(0.5 / nodeCount) * 100}%`}
              y1="50%"
              x2={`${(1.5 / nodeCount) * 100}%`}
              y2="50%"
              stroke="url(#lineGradient)"
              strokeWidth="3"
            />

            {/* Last hop to destination line */}
            {displayHops.length > 0 && (
              <line
                x1={`${((displayHops.length + 0.5) / nodeCount) * 100}%`}
                y1="50%"
                x2={`${((displayHops.length + 1.5) / nodeCount) * 100}%`}
                y2="50%"
                stroke="url(#lineGradient)"
                strokeWidth="3"
              />
            )}

            {/* Animated particles */}
            {particles.map((particle) => {
              const segmentStart = (particle.lineIndex + 0.5) / nodeCount;
              const segmentEnd = (particle.lineIndex + 1.5) / nodeCount;
              const x = segmentStart + (segmentEnd - segmentStart) * (particle.progress / 100);
              
              return (
                <g key={particle.id} filter="url(#particleGlow)">
                  <circle
                    cx={`${x * 100}%`}
                    cy="50%"
                    r="4"
                    fill="hsl(185 100% 70%)"
                  />
                  <circle
                    cx={`${x * 100}%`}
                    cy="50%"
                    r="2"
                    fill="white"
                  />
                </g>
              );
            })}
          </svg>

          {/* Nodes */}
          <div className="relative z-20 flex items-center justify-between" style={{ minHeight: 120 }}>
            {/* Source node */}
            <div className="flex flex-col items-center gap-2">
              <div className="w-14 h-14 rounded-full bg-card border-2 border-accent flex items-center justify-center pulse-glow relative">
                <span className="font-display text-xs text-accent">SRC</span>
                <div className="absolute inset-0 rounded-full border-2 border-accent/30 animate-ping" />
              </div>
              <span className="text-xs text-muted-foreground font-mono">Local</span>
            </div>

            {/* Hop nodes */}
            {displayHops.map((hop, index) => (
              <div 
                key={hop.hop} 
                className="flex flex-col items-center gap-2 fade-in-up"
                style={{ animationDelay: `${index * 0.1}s` }}
              >
                <div 
                  className={`relative w-12 h-12 rounded-full bg-card border-2 flex items-center justify-center transition-all duration-300 ${
                    hop.status === "success" 
                      ? "border-primary shadow-glow-sm" 
                      : hop.status === "timeout"
                      ? "border-destructive/50"
                      : "border-muted"
                  }`}
                >
                  <span className="font-display text-xs text-primary">{hop.hop}</span>
                  
                  {/* Pulsing ring for active nodes */}
                  {hop.status === "success" && (
                    <div className="absolute inset-0 rounded-full border border-primary/50 animate-ping" style={{ animationDuration: '2s' }} />
                  )}
                  
                  {/* Latency badge */}
                  {hop.avgLatency && (
                    <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 px-1.5 py-0.5 bg-background border border-primary/50 rounded text-[10px] text-primary whitespace-nowrap">
                      {hop.avgLatency}ms
                    </div>
                  )}
                </div>
                <div className="text-center">
                  <span className="text-[10px] text-muted-foreground font-mono max-w-16 truncate block">
                    {hop.host || hop.ip || "* * *"}
                  </span>
                  {hop.geo && (
                    <span className="text-[9px] text-primary/70 block">
                      {hop.geo.city}, {hop.geo.countryCode}
                    </span>
                  )}
                </div>
              </div>
            ))}

            {/* Destination node */}
            <div className="flex flex-col items-center gap-2">
              <div className="w-14 h-14 rounded-full bg-card border-2 border-secondary flex items-center justify-center pulse-glow relative">
                <span className="font-display text-xs text-secondary">DST</span>
                <div className="absolute inset-0 rounded-full border-2 border-secondary/30 animate-ping" />
              </div>
              <span className="text-xs text-muted-foreground font-mono max-w-20 truncate">{target}</span>
            </div>
          </div>

          {/* Legend */}
          <div className="mt-8 pt-4 border-t border-border/50 flex items-center justify-center gap-6 text-xs">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full border-2 border-primary" />
              <span className="text-muted-foreground">Active Hop</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full border-2 border-destructive/50" />
              <span className="text-muted-foreground">Timeout</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="relative w-6 h-0.5 bg-primary/30 overflow-hidden">
                <div className="absolute w-2 h-full bg-primary rounded-full animate-slide-particle" />
              </div>
              <span className="text-muted-foreground">Data Flow</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default TopologyMap;
