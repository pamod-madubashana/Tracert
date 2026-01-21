import { useState, useCallback, useRef, useEffect } from "react";
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
  const { lines, completion, reset: resetLines } = useTraceStream(activeTraceId);

  // Fallback to simulation if requested or Tauri unavailable
  const useSimulation = USE_SIM || typeof window.__TAURI_INTERNALS__ === 'undefined';
  
  const { startTrace: startSimTrace, isTracing: isSimTracing, result: simResult, currentHops: simHops } = useTraceSimulation();

  // When using simulation, proxy the simulation hook's state
  const effectiveIsTracing = useSimulation ? isSimTracing : isTracing;
  const effectiveResult = useSimulation ? simResult : result;
  
  // Process streaming lines to update hops in real-time when not using simulation
  useEffect(() => {
    console.log(' [use-trace] Processing streaming lines, isTracing:', isTracing, 'lines count:', lines.length);
    if (useSimulation || !lines || lines.length === 0 || !isTracing) return;
    
    // Parse the streaming lines to update hops in real-time
    const newHops: HopData[] = [];
    
    lines.forEach((lineEvent) => {
      const hopData = parseTracerouteLine(lineEvent.line);
      if (hopData) {
        // Check if this hop already exists to avoid duplicates
        const existingIndex = newHops.findIndex(h => h.hop === hopData.hop);
        if (existingIndex >= 0) {
          newHops[existingIndex] = hopData; // Update existing hop
        } else {
          newHops.push(hopData); // Add new hop
        }
      }
    });
    
    // Sort hops by hop number
    newHops.sort((a, b) => a.hop - b.hop);
    
    setCurrentHops(newHops);
  }, [lines, useSimulation, isTracing]);
  
  // Use real-time hops during tracing, final result hops after completion
  const effectiveHops = useSimulation ? simHops : (isTracing ? currentHops : (result ? result.hops : currentHops));
  
  // Log when isTracing changes
  useEffect(() => {
    console.log(' [use-trace] isTracing state changed to:', isTracing);
  }, [isTracing]);
  
  // Handle completion event from backend
  useEffect(() => {
    console.log(' [use-trace] Completion effect triggered, completion:', completion);
    if (completion && !useSimulation) {
      logger.info('Received trace completion event, updating state');
      console.log(' [use-trace] Processing completion event for trace_id=', completion.trace_id);
      setResult(completion.result);
      // Update currentHops with the final result when trace completes
      setCurrentHops(completion.result.hops);
      console.log(' [use-trace] Setting isTracing to false');
      setIsTracing(false);
      setActiveTraceId(null);
      resetLines();
    }
  }, [completion, useSimulation, resetLines]);
  
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

      console.log('[use-trace] Raw trace ID received from Rust:', traceId, 'Type:', typeof traceId);
      logger.debug('Received trace ID:', traceId);
      
      // Validate that we got a proper trace ID
      if (!traceId || typeof traceId !== 'string' || traceId.trim() === '') {
        const errorMsg = `Invalid trace ID received: ${JSON.stringify(traceId)}`;
        setError(errorMsg);
        logger.error(errorMsg);
        throw new Error(errorMsg);
      }
      
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
      if (activeTraceId) {
        await invoke("stop_trace", { trace_id: activeTraceId });
      }
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

// Simple parser for traceroute output lines
function parseTracerouteLine(line: string): HopData | undefined {
  // Trim the line
  const trimmedLine = line.trim();
  
  // Skip empty lines and header lines
  if (!trimmedLine || 
      trimmedLine.startsWith("Tracing") || 
      trimmedLine.startsWith("over a maximum") || 
      trimmedLine.startsWith("Trace complete")) {
    return undefined;
  }
  
  // Split into parts
  const parts = trimmedLine.split(/\s+/);
  if (parts.length < 2) return undefined;
  
  // Extract hop number
  const hopNum = parseInt(parts[0]);
  if (isNaN(hopNum)) return undefined;
  
  // Check for timeout
  if (trimmedLine.includes("Request timed out")) {
    return {
      hop: hopNum,
      host: undefined,
      ip: undefined,
      latencies: [undefined, undefined, undefined],
      avgLatency: undefined,
      status: "timeout"
    };
  }
  
  // Extract latencies and IP
  const latencies: (number | "*")[] = [];
  let ipPart: string | undefined = undefined;
  
  // Look for latency values and IP address
  for (let i = 1; i < parts.length; i++) {
    const part = parts[i];
      
    if (part.endsWith("ms")) {
      const timeStr = part.slice(0, -2).replace("<", "");
      const time = parseFloat(timeStr);
      latencies.push(isNaN(time) ? "*" : time);
    } else if (part === "*") {
      latencies.push("*");
    } else if (!part.endsWith("ms") && part !== "ms" && part !== "*" && !isNaN(parseFloat(part))) {
      // Likely an IP address or host
      if (part.includes('.') || part.includes(':')) {
        ipPart = part;
      }
    }
  }
    
  // Calculate average latency
  const validLatencies = latencies.filter(lat => lat !== "*") as number[];
  const avgLatency = validLatencies.length > 0 
    ? validLatencies.reduce((sum, val) => sum + val, 0) / validLatencies.length
    : undefined;
    
  return {
    hop: hopNum,
    host: undefined,
    ip: ipPart,
    latencies,
    avgLatency,
    status: validLatencies.length > 0 ? "success" : "timeout"
  };
}

// Export the original simulation hook for explicit usage
export { useTraceSimulation };