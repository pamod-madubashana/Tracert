import { Activity, Clock, Wifi } from "lucide-react";

interface StatusBarProps {
  isTracing: boolean;
  target: string;
  hopCount: number;
}

const StatusBar = ({ isTracing, target, hopCount }: StatusBarProps) => {
  const currentTime = new Date().toLocaleTimeString();

  return (
    <div className="cyber-panel px-4 py-2 glow-border">
      <div className="flex items-center justify-between text-xs">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${isTracing ? "bg-accent animate-pulse" : "bg-muted-foreground"}`} />
            <span className="text-muted-foreground">Status:</span>
            <span className={isTracing ? "text-accent" : "text-foreground"}>
              {isTracing ? "TRACING" : "READY"}
            </span>
          </div>
          <div className="h-4 w-px bg-border" />
          <div className="flex items-center gap-2">
            <Wifi className="w-3 h-3 text-primary" />
            <span className="text-muted-foreground">Target:</span>
            <span className="text-foreground font-mono">{target || "—"}</span>
          </div>
          <div className="h-4 w-px bg-border" />
          <div className="flex items-center gap-2">
            <Activity className="w-3 h-3 text-primary" />
            <span className="text-muted-foreground">Hops:</span>
            <span className="text-foreground">{hopCount}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Clock className="w-3 h-3 text-muted-foreground" />
          <span className="text-muted-foreground font-mono">{currentTime}</span>
        </div>
      </div>
    </div>
  );
};

export default StatusBar;
