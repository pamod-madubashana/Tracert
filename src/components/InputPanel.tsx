import { useState } from "react";
import { Play, Loader2 } from "lucide-react";

interface InputPanelProps {
  onTrace: (target: string) => void;
  isTracing: boolean;
}

const InputPanel = ({ onTrace, isTracing }: InputPanelProps) => {
  const [target, setTarget] = useState("8.8.8.8");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (target.trim()) {
      onTrace(target.trim());
    }
  };

  return (
    <div className="cyber-panel p-4 glow-border">
      <div className="flex items-center gap-2 mb-3">
        <div className="w-2 h-2 rounded-full bg-primary pulse-glow" />
        <span className="font-display text-xs tracking-wider text-primary uppercase">
          Target Configuration
        </span>
      </div>

      <form onSubmit={handleSubmit} className="flex gap-3">
        <div className="flex-1 relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">
            {">"}_
          </span>
          <input
            type="text"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            placeholder="Enter IP address or hostname..."
            className="cyber-input w-full pl-10 rounded font-mono"
            disabled={isTracing}
          />
        </div>
        <button
          type="submit"
          disabled={isTracing || !target.trim()}
          className="cyber-button flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isTracing ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>Tracing</span>
            </>
          ) : (
            <>
              <Play className="h-4 w-4" />
              <span>Initiate Trace</span>
            </>
          )}
        </button>
      </form>
    </div>
  );
};

export default InputPanel;
