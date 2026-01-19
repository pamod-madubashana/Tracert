import { HopData } from "@/types/trace";
import { ChevronRight, Clock, Server, MapPin } from "lucide-react";

interface HopsTableProps {
  hops: HopData[];
}

const HopsTable = ({ hops }: HopsTableProps) => {
  return (
    <div className="cyber-panel p-4 glow-border">
      <div className="flex items-center gap-2 mb-4">
        <ChevronRight className="w-4 h-4 text-primary" />
        <span className="font-display text-xs tracking-wider text-primary uppercase">
          Parsed Hops Data
        </span>
        <span className="ml-auto text-xs text-muted-foreground font-mono">
          {hops.length} nodes detected
        </span>
      </div>

      {hops.length === 0 ? (
        <div className="py-8 text-center text-muted-foreground text-sm">
          No hop data available
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="cyber-table">
            <thead>
              <tr>
                <th className="w-12">
                  <span>#</span>
                </th>
                <th>
                  <div className="flex items-center gap-1">
                    <Server className="w-3 h-3" />
                    <span>Host / IP</span>
                  </div>
                </th>
                <th className="w-32">
                  <div className="flex items-center gap-1">
                    <MapPin className="w-3 h-3" />
                    <span>Location</span>
                  </div>
                </th>
                <th className="w-20">
                  <div className="flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    <span>Avg</span>
                  </div>
                </th>
                <th className="w-40">
                  <span>Latency</span>
                </th>
                <th className="w-20">Status</th>
              </tr>
            </thead>
            <tbody className="stagger-children">
              {hops.map((hop) => (
                <tr key={hop.hop} className="group">
                  <td>
                    <span className="text-primary font-semibold">{hop.hop}</span>
                  </td>
                  <td>
                    <div className="flex flex-col">
                      {hop.host && (
                        <span className="text-foreground">{hop.host}</span>
                      )}
                      <span className={hop.host ? "text-muted-foreground text-xs" : "text-foreground"}>
                        {hop.ip || "* * *"}
                      </span>
                    </div>
                  </td>
                  <td>
                    {hop.geo ? (
                      <div className="flex flex-col">
                        <span className="text-foreground text-xs">{hop.geo.city}</span>
                        <span className="text-muted-foreground text-[10px]">{hop.geo.country}</span>
                      </div>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td>
                    {hop.avgLatency ? (
                      <span className="text-accent font-semibold">{hop.avgLatency} ms</span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {hop.latencies.map((lat, i) => (
                        <span 
                          key={i}
                          className={`px-1.5 py-0.5 rounded text-[10px] ${
                            lat === "*" 
                              ? "text-muted-foreground" 
                              : "bg-primary/10 text-primary border border-primary/30"
                          }`}
                        >
                          {lat === "*" ? "*" : `${lat}`}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td>
                    <span 
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold ${
                        hop.status === "success"
                          ? "bg-accent/20 text-accent border border-accent/30"
                          : hop.status === "timeout"
                          ? "bg-destructive/20 text-destructive border border-destructive/30"
                          : "bg-muted text-muted-foreground"
                      }`}
                    >
                      <span className={`w-1.5 h-1.5 rounded-full ${
                        hop.status === "success" ? "bg-accent" : 
                        hop.status === "timeout" ? "bg-destructive" : "bg-muted-foreground"
                      }`} />
                      {hop.status === "success" ? "OK" : hop.status === "timeout" ? "TIMEOUT" : "—"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default HopsTable;
