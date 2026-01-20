import { useState } from "react";
import TracerHeader from "@/components/TracerHeader";
import InputPanel from "@/components/InputPanel";
import TopologyMap from "@/components/TopologyMap";
import WorldMap from "@/components/WorldMap";
import HopsTable from "@/components/HopsTable";
import TerminalOutput from "@/components/TerminalOutput";
import StatusBar from "@/components/StatusBar";
import { useTrace } from "@/hooks/use-trace";

const Index = () => {
  const [target, setTarget] = useState("");
  const { isTracing, result, currentHops, startTrace, streamingLines } = useTrace();

  const handleTrace = (newTarget: string) => {
    setTarget(newTarget);
    startTrace(newTarget);
  };

  return (
    <div className="h-screen bg-background grid-pattern overflow-hidden flex flex-col">
      <div className="container max-w-7xl mx-auto px-3 py-2 flex flex-col flex-1 gap-2 overflow-hidden">
        {/* Header + Status + Input row */}
        <div className="flex items-center gap-4 flex-wrap">
          <TracerHeader compact />
          <div className="flex-1">
            <StatusBar 
              isTracing={isTracing} 
              target={target} 
              hopCount={currentHops.length} 
            />
          </div>
          <div className="flex-1 min-w-[300px]">
            <InputPanel onTrace={handleTrace} isTracing={isTracing} compact />
          </div>
        </div>

        {/* Main content - Two column layout */}
        <div className="flex-1 grid grid-cols-1 lg:grid-cols-2 gap-2 overflow-hidden min-h-0">
          {/* Left column: Topology + Hops Table */}
          <div className="flex flex-col gap-2 overflow-hidden">
            <TopologyMap hops={currentHops} target={target} />
            <div className="flex-1 min-h-0 overflow-hidden">
              <HopsTable hops={currentHops} compact />
            </div>
          </div>

          {/* Right column: World Map + Streaming Terminal */}
          <div className="flex flex-col gap-2 overflow-hidden">
            <div className="flex-1 min-h-0">
              <WorldMap hops={currentHops} compact />
            </div>
            <div className="flex-1 min-h-0 overflow-hidden">
              {/* Show streaming output in real-time, fall back to final result */}
              <TerminalOutput 
                output={streamingLines.length > 0 
                  ? streamingLines.map(l => l.line).join('\n')
                  : result?.rawOutput || ""
                } 
                target={target}
                compact
              />
            </div>
          </div>
        </div>

        {/* Footer */}
        <footer className="text-center py-1 border-t border-border/30">
          <p className="text-[10px] text-muted-foreground font-mono">
            TRACERT v2.0 // Network Path Analysis Terminal
          </p>
        </footer>
      </div>
    </div>
  );
};

export default Index;