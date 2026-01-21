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
    logger.info(`[use-trace] Processing streaming lines, isTracing: ${isTracing}, lines count: ${lines.length}`);
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
    logger.info(`[use-trace] isTracing state changed to: ${isTracing}`);
  }, [isTracing]);
  
  // Handle completion event from backend
  useEffect(() => {
    logger.info(`[use-trace] Completion effect triggered, completion: ${JSON.stringify(completion)}`);
    if (completion && !useSimulation) {
      logger.info('Received trace completion event, updating state');
      logger.info(`[use-trace] Processing completion event for trace_id= ${completion.trace_id}`);
      setResult(completion.result);
      // Update currentHops with the final result when trace completes
      setCurrentHops(completion.result.hops);
      logger.info('[use-trace] Setting isTracing to false');
      setIsTracing(false);
      setActiveTraceId(null);
      resetLines();
    }
  }, [completion, useSimulation]); // Removed resetLines from dependencies
  
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
      
      logger.debug(`Invoking run_trace command with: ${JSON.stringify({ target, options })}`);
      
      // Call Tauri command for real traceroute - now returns trace ID
      const id = await invoke<string>("run_trace", {
        target,
        options: {
          maxHops: options.maxHops || 30,
          timeoutMs: options.timeoutMs || 5000,
          probesPerHop: options.probesPerHop || 3,
          resolveDns: options.resolveDns !== false
        }
      });

      setActiveTraceId(id);
      setIsTracing(true);
      logger.debug(`[React] Received trace ID: ${id}`);
            
      // Validate that we got a proper trace ID
      if (!id || typeof id !== 'string' || id.trim() === '') {
        const errorMsg = `Invalid trace ID received: ${JSON.stringify(id)}`;
        setError(errorMsg);
        logger.error(errorMsg);
        throw new Error(errorMsg);
      }
            
      // Note: We don't wait for completion anymore since we're streaming
      // The UI will update in real-time via events
            
      // For backwards compatibility, we could poll for completion or
      // wait for a completion event, but for now we'll just return
      return id;

    } catch (err) {
      // Properly handle Tauri invoke errors
      const errorMessage = err instanceof Error ? err.message : "Unknown error occurred";
      setError(errorMessage);
      logger.error("Trace failed:", errorMessage);
      
      // Reset state on error
      setIsTracing(false);
      setActiveTraceId(null);
      throw err; // Throw the error to propagate it properly
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
  
  // Check for timeout lines first
  if (trimmedLine.includes("Request timed out")) {
    // Extract hop number from timeout line
    const hopMatch = trimmedLine.match(/^(\d+)/);
    const hopNum = hopMatch ? parseInt(hopMatch[1]) : 0;
    if (hopNum > 0) {
      return {
        hop: hopNum,
        host: undefined,
        ip: undefined,
        latencies: [undefined, undefined, undefined],
        avgLatency: undefined,
        status: "timeout"
      };
    }
    return undefined;
  }
  
  // Windows tracert format: " 1     7 ms     4 ms     2 ms  192.168.1.1"
  // Split by whitespace and filter out empty strings
  const parts = trimmedLine.split(/\s+/).filter(part => part.length > 0);
  if (parts.length < 2) return undefined;
  
  // Extract hop number (first part)
  const hopNum = parseInt(parts[0]);
  if (isNaN(hopNum)) return undefined;
  
  // Extract latencies and IP
  const latencies: (number | undefined)[] = [];
  let ipPart: string | undefined = undefined;
  let hostPart: string | undefined = undefined;
  
  // Process parts after hop number to find latencies and IP
  let i = 1;
  let latencyCount = 0;
  
  // First, collect all latency values (numbers followed by "ms")
  while (i < parts.length && latencyCount < 3) {
    const currentPart = parts[i];
    const nextPart = i + 1 < parts.length ? parts[i + 1] : null;
    
    // Look for the pattern: "number" followed by "ms"
    if (nextPart === "ms" && !isNaN(parseFloat(currentPart)) && latencyCount < 3) {
      // This is a latency value
      const time = parseFloat(currentPart.replace("<", ""));
      latencies.push(isNaN(time) ? undefined : time);
      i += 2; // Skip both value and "ms"
      latencyCount++;
    } else if (currentPart === "*" && latencyCount < 3) {
      // Timeout marker
      latencies.push(undefined);
      i++;
      latencyCount++;
    } else {
      // Not a latency pattern, move to next
      i++;
    }
  }
  
  // Now look for IP address after the latency values
  for (let j = i; j < parts.length; j++) {
    const part = parts[j];
    // Check if this looks like an IP address (contains dots or colons)
    if ((part.includes('.') && isValidIPFormat(part)) || part.includes(':')) {
      ipPart = part;
      break;
    }
  }
  
  // If we found fewer than 3 latencies, pad with undefined
  while (latencies.length < 3) {
    latencies.push(undefined);
  }
  
  // Calculate average latency from valid samples and round to integer
  const validLatencies = latencies.filter(lat => lat !== undefined) as number[];
  const avgLatency = validLatencies.length > 0 
    ? Math.round(validLatencies.reduce((sum, val) => sum + val, 0) / validLatencies.length)
    : undefined;
    
  return {
    hop: hopNum,
    host: hostPart,
    ip: ipPart,
    latencies: latencies as (number | undefined)[],
    avgLatency,
    status: validLatencies.length > 0 ? "success" : "timeout"
  };
}

// Helper function to validate IP address format
function isValidIPFormat(str: string): boolean {
  // Check if it's a valid IPv4 format (basic validation)
  const ipv4Pattern = /^(\d{1,3}\.){3}\d{1,3}$/;
  if (ipv4Pattern.test(str)) {
    // Further validate each octet is between 0-255
    const octets = str.split('.');
    return octets.every(octet => {
      const num = parseInt(octet);
      return num >= 0 && num <= 255;
    });
  }
  // For now, just check if it has multiple dots (IPv4) or colons (IPv6)
  return str.split('.').length > 2 || str.includes(':');
}

// Export the original simulation hook for explicit usage
export { useTraceSimulation };