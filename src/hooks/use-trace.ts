import { useState, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { HopData, TraceResult } from "@/types/trace";
import { logger } from "@/lib/logger";
import { useTraceStream, TraceLineEvent } from "./useTraceStream";

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
  const [activeTraceId, setActiveTraceId] = useState<string | null>(null);
  
  // Use the streaming hook for real-time updates
  const { lines, reset: resetLines } = useTraceStream(activeTraceId);

  // Fallback to simulation if requested or Tauri unavailable
  const useSimulation = USE_SIM || typeof window.__TAURI_INTERNALS__ === 'undefined';
  
  const { startTrace: startSimTrace, isTracing: isSimTracing, result: simResult, currentHops: simHops } = useTraceSimulation();

  // When using simulation, proxy the simulation hook's state
  const effectiveIsTracing = useSimulation ? isSimTracing : isTracing;
  const effectiveResult = useSimulation ? simResult : result;
  const effectiveHops = useSimulation ? simHops : currentHops;
  
  const startTrace = useCallback(async (target: string, options: TraceOptions = {}) => {
    logger.debug(`startTrace called with target: ${target}, options:`, options);
    
    // Use simulation mode if requested
    if (useSimulation) {
      logger.info('Using simulation mode for tracing');
      return startSimTrace(target);
    }

    logger.info(`Starting real traceroute to: ${target}`);
    setIsTracing(true);
    setCurrentHops([]);
    setResult(null);
    setError(null);
    resetLines(); // Clear previous lines

    try {
      const startTime = new Date();
      
      logger.debug('Invoking run_trace command with:', { target, options });
      
      // Call Tauri command for real traceroute - now returns trace ID
      const traceId = await invoke<string>("run_trace", {
        target,
        options: {
          maxHops: options.maxHops || 30,
          timeoutMs: options.timeoutMs || 5000,
          probesPerHop: options.probesPerHop || 3,
          resolveDns: options.resolveDns !== false
        }
      });

      logger.debug('Received trace ID:', traceId);
      setActiveTraceId(traceId);

      // Note: We don't wait for completion anymore since we're streaming
      // The UI will update in real-time via events
      
      // For backwards compatibility, we could poll for completion or
      // wait for a completion event, but for now we'll just return
      return traceId;

    } catch (err) {
      // Properly handle Tauri invoke errors
      const errorMessage = err instanceof Error ? err.message : "Unknown error occurred";
      setError(errorMessage);
      logger.error("Trace failed:", errorMessage);
      
      // Reset state on error
      setIsTracing(false);
      setActiveTraceId(null);
      return Promise.reject(err);
    }
  }, [useSimulation, startSimTrace, resetLines]);

  const stopTrace = useCallback(async () => {
    logger.debug(`stopTrace called, isTracing: ${isTracing}, useSimulation: ${useSimulation}`);
    
    if (!isTracing || useSimulation) {
      logger.debug('Skipping stopTrace - not tracing or using simulation');
      return;
    }

    try {
      logger.info('Attempting to stop current trace');
      await invoke("stop_trace");
      logger.info('Successfully sent stop command');
      setIsTracing(false);
      setActiveTraceId(null);
    } catch (err) {
      logger.error("Failed to stop trace:", err);
    }
  }, [isTracing, useSimulation]);

  // Expose the streaming lines for UI components to consume
  const streamingLines = lines;

  return {
    isTracing: effectiveIsTracing,
    result: effectiveResult,
    currentHops: effectiveHops,
    error,
    startTrace,
    stopTrace,
    isSimulation: useSimulation,
    streamingLines // New: expose the real-time streaming lines
  };
};

// Export the original simulation hook for explicit usage
export { useTraceSimulation };