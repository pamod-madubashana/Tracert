import { useState, useCallback, useRef, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
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
  
  // Handle hop updates for real-time location updates
  useEffect(() => {
    if (!window.__TAURI_INTERNALS__) return;
    
    console.info('[React] Installing hop:update listener...');
    
    let unlisten: (() => void) | null = null;
    
    listen('hop:update', (event: { payload: { trace_id: string, hop_data: HopData } }) => {
      console.info('[React] hop:update received:', event.payload);
      
      // Only process if this hop update is for the current trace
      if (event.payload.trace_id === activeTraceId) {
        console.info('[React] Processing hop update for current trace');
        
        // Update currentHops with the new hop data
        setCurrentHops(prevHops => {
          const updatedHops = [...prevHops];
          const hopIndex = updatedHops.findIndex(h => h.hop === event.payload.hop_data.hop);
          
          if (hopIndex >= 0) {
            // Update existing hop
            updatedHops[hopIndex] = event.payload.hop_data;
          } else {
            // Add new hop
            updatedHops.push(event.payload.hop_data);
          }
          
          // Sort hops by hop number to maintain order
          updatedHops.sort((a, b) => a.hop - b.hop);
          
          return updatedHops;
        });
      } else {
        console.info('[React] Ignoring hop update for different trace:', event.payload.trace_id);
      }
    }).then(unlistenFn => {
      console.info('[React] hop:update listener installed');
      unlisten = unlistenFn;
    }).catch(err => {
      console.error('[React] Error installing hop:update listener:', err);
    });

    return () => {
      if (unlisten) {
        console.info('[React] Uninstalling hop:update listener...');
        unlisten();
      }
    };
  }, [activeTraceId]);

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
  console.log(`[PARSE] Called with line: "${line}"`);
  
  // Trim the line
  const trimmedLine = line.trim();
  
  // Skip empty lines and header lines
  if (!trimmedLine || 
      trimmedLine.startsWith("Tracing") || 
      trimmedLine.startsWith("over a maximum") || 
      trimmedLine.startsWith("Trace complete")) {
    console.log(`[PARSE] Skipping line: "${trimmedLine}"`);
    return undefined;
  }
  
  // Check for timeout lines first
  if (trimmedLine.includes("Request timed out")) {
    // Extract hop number from timeout line
    const hopMatch = trimmedLine.match(/^(\d+)/);
    const hopNum = hopMatch ? parseInt(hopMatch[1]) : 0;
    if (hopNum > 0) {
      console.debug(`[DEBUG] Timeout line parsed: hop=${hopNum}`);
      return {
        hop: hopNum,
        host: undefined,
        ip: undefined,
        latencies: [undefined, undefined, undefined],
        avgLatency: undefined,
        status: "timeout",
        geo: undefined // Will be populated by the backend with real geolocation data
      };
    }
    return undefined;
  }
  
  // Windows tracert format: " 1     7 ms     4 ms     2 ms  192.168.1.1"
  // Split by whitespace and filter out empty strings
  const parts = trimmedLine.split(/\s+/).filter(part => part.length > 0);
  if (parts.length < 5) {
    console.log(`[PARSE] Not enough parts (${parts.length}), returning undefined`);
    return undefined; // Need at least hop#, 3 times, and IP
  }
  
  console.debug(`[DEBUG] Parsing line: "${trimmedLine}", parts:`, parts);
  
  // Extract hop number (first part)
  const hopNum = parseInt(parts[0]);
  if (isNaN(hopNum)) {
    console.log(`[PARSE] Invalid hop number: "${parts[0]}"`);
    return undefined;
  }
  
  // Extract latencies - look for exactly 3 latency values with "ms" units
  const latencies: (number | undefined)[] = [];
  let ipPart: string | undefined = undefined;
  let hostPart: string | undefined = undefined;
  
  // Find latency values (number followed by "ms")
  let latencyCount = 0;
  let i = 1; // Start after hop number
  
  // Look for the pattern: number ms number ms number ms
  while (i < parts.length - 1 && latencyCount < 3) {
    if (parts[i + 1] === "ms" && !isNaN(parseFloat(parts[i]))) {
      const time = parseFloat(parts[i].replace("<", ""));
      const latencyValue = isNaN(time) ? undefined : time;
      latencies.push(latencyValue);
      console.debug(`[DEBUG] Found latency: ${latencyValue} at position ${i}`);
      i += 2; // Skip number and "ms"
      latencyCount++;
    } else if (parts[i] === "*") {
      latencies.push(undefined);
      console.debug(`[DEBUG] Found timeout marker at position ${i}`);
      i++;
      latencyCount++;
    } else {
      console.debug(`[DEBUG] Stopping latency parsing at position ${i}, part="${parts[i]}"`);
      break; // Stop if we don't find the expected pattern
    }
  }
  
  console.debug(`[DEBUG] Latency parsing complete: ${latencies.length} latencies found`);
  
  // The IP address should be the last part
  if (i < parts.length) {
    const lastPart = parts[parts.length - 1];
    console.debug(`[DEBUG] Checking last part for IP: "${lastPart}"`);
    // Check if it's a valid IP address
    if (lastPart.includes('.') && isValidIPFormat(lastPart)) {
      ipPart = lastPart;
      console.debug(`[DEBUG] Valid IP found: ${ipPart}`);
    } else {
      console.debug(`[DEBUG] Last part is not a valid IP: "${lastPart}"`);
    }
  }
  
  // Pad latencies to exactly 3 values if needed
  while (latencies.length < 3) {
    latencies.push(undefined);
    console.debug(`[DEBUG] Padded latencies to maintain 3 elements`);
  }
  
  // Calculate average latency from valid samples and round to integer
  const validLatencies = latencies.filter(lat => lat !== undefined) as number[];
  const avgLatency = validLatencies.length > 0 
    ? Math.round(validLatencies.reduce((sum, val) => sum + val, 0) / validLatencies.length)
    : undefined;
    
  console.debug(`[DEBUG] Final parsed hop: ${hopNum}, ip: "${ipPart}", latencies: [${latencies.join(', ')}], status: ${validLatencies.length > 0 ? "success" : "timeout"}`);
  
  return {
    hop: hopNum,
    host: hostPart,
    ip: ipPart,
    latencies: [], // Empty array since we only show average
    avgLatency,
    status: validLatencies.length > 0 ? "success" : "timeout",
    geo: undefined // Will be populated by the backend with real geolocation data
  };
}

// Helper function to validate IP address format
function isValidIPFormat(str: string): boolean {
  console.debug(`[DEBUG] Validating IP format: "${str}"`);
  // Check if it's a valid IPv4 format
  const ipv4Pattern = /^(\d{1,3}\.){3}\d{1,3}$/;
  if (ipv4Pattern.test(str)) {
    // Further validate each octet is between 0-255
    const octets = str.split('.');
    const isValid = octets.every(octet => {
      const num = parseInt(octet);
      return num >= 0 && num <= 255;
    });
    console.debug(`[DEBUG] IP "${str}" validation result: ${isValid}`);
    return isValid;
  }
  console.debug(`[DEBUG] IP "${str}" failed initial pattern test`);
  return false;
}

// Export the original simulation hook for explicit usage
export { useTraceSimulation };