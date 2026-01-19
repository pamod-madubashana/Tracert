import { useState } from "react";
import TracerHeader from "@/components/TracerHeader";
import InputPanel from "@/components/InputPanel";
import TopologyMap from "@/components/TopologyMap";
import WorldMap from "@/components/WorldMap";
import HopsTable from "@/components/HopsTable";
import TerminalOutput from "@/components/TerminalOutput";
import StatusBar from "@/components/StatusBar";
import { useTraceSimulation } from "@/hooks/useTraceSimulation";

const Index = () => {
  const [target, setTarget] = useState("");
  const { isTracing, result, currentHops, startTrace } = useTraceSimulation();

  const handleTrace = (newTarget: string) => {
    setTarget(newTarget);
    startTrace(newTarget);
  };

  return (
    <div className="min-h-screen bg-background grid-pattern">
      <div className="container max-w-7xl mx-auto px-4 py-6 space-y-6">
        {/* Header */}
        <TracerHeader />

        {/* Status bar */}
        <StatusBar 
          isTracing={isTracing} 
          target={target} 
          hopCount={currentHops.length} 
        />

        {/* Input section */}
        <InputPanel onTrace={handleTrace} isTracing={isTracing} />

        {/* Main content */}
        <div className="space-y-6">
          {/* Topology visualization */}
          <TopologyMap hops={currentHops} target={target} />

          {/* World Map */}
          <WorldMap hops={currentHops} />

          {/* Data grid */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Hops table */}
            <HopsTable hops={currentHops} />

            {/* Terminal output */}
            <TerminalOutput 
              output={result?.rawOutput || ""} 
              target={target} 
            />
          </div>
        </div>

        {/* Footer */}
        <footer className="text-center py-4 border-t border-border/30">
          <p className="text-xs text-muted-foreground font-mono">
            TRACERT v2.0 // Network Path Analysis Terminal // Powered by Cyber Systems
          </p>
        </footer>
      </div>
    </div>
  );
};

export default Index;
