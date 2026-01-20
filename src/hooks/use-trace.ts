import { useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { HopData, TraceResult } from "@/types/trace";

// Extend Window interface for Tauri internals
declare global {
  interface Window {
    __TAURI_INTERNALS__?: any;
  }
}

// Feature flag to switch between real and simulation mode
const USE_SIM = import.meta.env.VITE_TRACE_SIM === "true";

// Import simulation hook for fallback/demo mode
import { useTraceSimulation } from "./useTraceSimulation";

// Trace options for real implementation
interface TraceOptions {
  maxHops?: number;
  timeoutMs?: number;
  probesPerHop?: number;
  resolveDns?: boolean;
}

// Real traceroute hook that mirrors useTraceSimulation API
export const useTrace = () => {
  const [isTracing, setIsTracing] = useState(false);
  const [result, setResult] = useState<TraceResult | null>(null);
  const [currentHops, setCurrentHops] = useState<HopData[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Fallback to simulation if requested or Tauri unavailable
  const useSimulation = USE_SIM || typeof window.__TAURI_INTERNALS__ === 'undefined';
  
  const { startTrace: startSimTrace } = useTraceSimulation();

  const startTrace = useCallback(async (target: string, options: TraceOptions = {}) => {
    // Use simulation mode if requested
    if (useSimulation) {
      return startSimTrace(target);
    }

    setIsTracing(true);
    setCurrentHops([]);
    setResult(null);
    setError(null);

    try {
      const startTime = new Date();
      
      // Call Tauri command for real traceroute
      const traceResult = await invoke<TraceResult>("run_trace", {
        target,
        options: {
          maxHops: options.maxHops || 30,
          timeoutMs: options.timeoutMs || 5000,
          probesPerHop: options.probesPerHop || 3,
          resolveDns: options.resolveDns !== false
        }
      });

      // Validate the result before using it
      if (!traceResult || !Array.isArray(traceResult.hops)) {
        throw new Error("Invalid trace result received from backend");
      }

      // Update state with real results
      setCurrentHops(traceResult.hops);
      setResult({
        ...traceResult,
        startTime,
        endTime: new Date()
      });

    } catch (err) {
      // Properly handle Tauri invoke errors
      const errorMessage = err instanceof Error ? err.message : "Unknown error occurred";
      setError(errorMessage);
      console.error("Trace failed:", errorMessage);
      
      // Reset state on error
      setIsTracing(false);
      return Promise.reject(err);
    } finally {
      // Ensure we only set isTracing to false once
      // Note: We don't check 'error' here because it refers to the error state before the catch block
      setIsTracing(false);
    }
  }, [useSimulation, startSimTrace]);

  const stopTrace = useCallback(async () => {
    if (!isTracing || useSimulation) return;

    try {
      await invoke("stop_trace");
    } catch (err) {
      console.error("Failed to stop trace:", err);
    }
  }, [isTracing, useSimulation]);

  return {
    isTracing,
    result,
    currentHops,
    error,
    startTrace,
    stopTrace,
    isSimulation: useSimulation
  };
};

// Export the original simulation hook for explicit usage
export { useTraceSimulation };