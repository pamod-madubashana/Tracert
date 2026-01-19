import { useState, useCallback } from "react";
import { HopData, TraceResult, GeoLocation } from "@/types/trace";

// Type declaration for Tauri invoke
interface Window {
  __TAURI__: {
    invoke: (cmd: string, args?: Record<string, unknown>) => Promise<any>;
  };
}

declare global {
  interface Window {
    __TAURI__: {
      invoke: (cmd: string, args?: Record<string, unknown>) => Promise<any>;
    };
  }
}

// Regular expressions for parsing different traceroute output formats
const parseTracerouteOutput = (output: string, target: string): HopData[] => {
  const lines = output.split("\n");
  const hops: HopData[] = [];
  
  // Regex patterns for different OS traceroute formats
  const windowsPattern = /^\s*(\d+)\s+(?:<(\d+)ms|\*)\s+(?:<(\d+)ms|\*)\s+(?:<(\d+)ms|\*)\s+(.+)$/;
  const unixPattern = /^\s*(\d+)\s+(.+)\s+((?:\d+\.\d+\s+ms\s+){2,}(?:\d+\.\d+\s+ms|\*))$/;
  
  for (const line of lines) {
    // Parse Windows format: 1    <1 ms    <1 ms    <1 ms     192.168.1.1
    const winMatch = line.match(windowsPattern);
    if (winMatch) {
      const [, hopStr, ms1, ms2, ms3, hostPart] = winMatch;
      const hopNum = parseInt(hopStr);
      
      // Extract host/IP from the last part
      const hostParts = hostPart.trim().split(/[\s]+/);
      const ip = hostParts[hostParts.length - 1]?.replace(/[\[\]]/g, "") || "";
      const host = hostParts.length > 1 ? hostParts.slice(0, -1).join(" ") : undefined;
      
      const latencies: (number | "*")[] = [];
      if (ms1 !== undefined) latencies.push(ms1 === "*" ? "*" : parseInt(ms1));
      if (ms2 !== undefined) latencies.push(ms2 === "*" ? "*" : parseInt(ms2));
      if (ms3 !== undefined) latencies.push(ms3 === "*" ? "*" : parseInt(ms3));
      
      const hasTimeout = latencies.some(lat => lat === "*");
      
      const hop: HopData = {
        hop: hopNum,
        host,
        ip,
        latencies,
        status: hasTimeout ? "timeout" : "success",
      };
      
      if (!hasTimeout) {
        const nums = latencies.filter(l => typeof l === "number") as number[];
        if (nums.length > 0) {
          const avg = Math.round(nums.reduce((sum, val) => sum + val, 0) / nums.length);
          hop.avgLatency = avg;
        }
      }
      
      hops.push(hop);
    }
    
    // Parse Unix format: 1  192.168.1.1  0.500 ms  0.400 ms  0.300 ms
    const unixMatch = line.match(unixPattern);
    if (unixMatch) {
      const [, hopStr, hostPart, msPart] = unixMatch;
      const hopNum = parseInt(hopStr);
      
      // Parse host and IP
      const hostParts = hostPart.trim().split(/[\s]+/);
      let ip = "";
      let host = "";
      
      if (hostParts.length > 0) {
        const lastPart = hostParts[hostParts.length - 1];
        if (isValidIP(lastPart)) {
          ip = lastPart;
          host = hostParts.length > 1 ? hostParts.slice(0, -1).join(" ") : undefined;
        } else {
          host = hostPart.trim();
        }
      }
      
      // Parse latency values
      const latencyMatches = msPart.match(/(\d+\.\d+|\*)\s+ms/g);
      const latencies: (number | "*")[] = [];
      
      if (latencyMatches) {
        latencyMatches.forEach(match => {
          const trimmed = match.replace(/\s+ms$/, "").trim();
          latencies.push(trimmed === "*" ? "*" : parseFloat(trimmed));
        });
      }
      
      const hasTimeout = latencies.some(lat => lat === "*");
      
      const hop: HopData = {
        hop: hopNum,
        host: host || undefined,
        ip: ip || undefined,
        latencies,
        status: hasTimeout ? "timeout" : "success",
      };
      
      if (!hasTimeout) {
        const nums = latencies.filter(l => typeof l === "number") as number[];
        if (nums.length > 0) {
          const avg = Math.round(nums.reduce((sum, val) => sum + val, 0) / nums.length);
          hop.avgLatency = avg;
        }
      }
      
      hops.push(hop);
    }
  }
  
  return hops;
};

const isValidIP = (str: string): boolean => {
  // Simple regex for IPv4
  const ipv4Regex = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
  // Simple regex for IPv6
  const ipv6Regex = /^(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$|^(?:[0-9a-fA-F]{1,4}:)*::(?:[0-9a-fA-F]{1,4}:)*[0-9a-fA-F]{1,4}$/;
  return ipv4Regex.test(str) || ipv6Regex.test(str);
};

export const useTraceSimulation = () => {
  const [isTracing, setIsTracing] = useState(false);
  const [result, setResult] = useState<TraceResult | null>(null);
  const [currentHops, setCurrentHops] = useState<HopData[]>([]);

  const startTrace = useCallback(async (target: string) => {
    setIsTracing(true);
    setCurrentHops([]);
    setResult(null);

    try {
      const startTime = new Date();
      
      // Call the Tauri command to run actual traceroute
      let rawOutput: string;
      
      // Debug logging
      console.log("Window object:", typeof window !== 'undefined' ? "Available" : "Not available");
      console.log("Tauri object:", typeof window !== 'undefined' && (window as any).__TAURI__ ? "Available" : "Not available");
      
      // Try multiple ways to detect Tauri context
      const isTauriContext = typeof window !== 'undefined' && (
        (window as any).__TAURI__ ||
        (window as any).__TAURI_INTERNALS__ ||
        typeof (window as any).ipc !== 'undefined'
      );
      
      console.log("Is Tauri context:", isTauriContext);
      
      if (isTauriContext) {
        try {
          // Running in Tauri context
          console.log("Attempting to call Tauri command...");
          if ((window as any).__TAURI__) {
            rawOutput = await (window as any).__TAURI__.invoke("run_traceroute", { target });
          } else if ((window as any).__TAURI_INTERNALS__) {
            rawOutput = await (window as any).__TAURI_INTERNALS__.invoke("run_traceroute", { target });
          } else {
            throw new Error("Tauri invoke method not found");
          }
          console.log("Tauri command successful");
        } catch (tauriError) {
          console.error("Tauri command failed:", tauriError);
          throw tauriError;
        }
      } else {
        // Fallback for browser development - return mock data
        console.log("Using mock data fallback");
        rawOutput = `Tracing route to ${target} [${target}]
over a maximum of 30 hops:

  1    <1 ms    <1 ms    <1 ms  192.168.1.1
  2     2 ms     1 ms     1 ms  10.0.0.1
  3     3 ms     2 ms     2 ms  ${target} [${target}]

Trace complete.`;
      }
      
      // Parse the output to extract hop data
      const hops = parseTracerouteOutput(rawOutput, target);
      
      // Update hops progressively for UI feedback
      for (let i = 0; i < hops.length; i++) {
        await new Promise((resolve) => setTimeout(resolve, 100)); // Small delay for visual effect
        setCurrentHops((prev) => [...prev, hops[i]]);
      }

      setResult({
        target,
        resolvedIp: target, // In a real implementation, this would be resolved from DNS
        hops,
        rawOutput,
        startTime,
        endTime: new Date(),
      });
    } catch (error) {
      console.error("Traceroute error:", error);
      // Handle error case
      setResult({
        target,
        hops: [],
        rawOutput: `Error: ${(error as Error).message}`,
        startTime: new Date(),
        endTime: new Date(),
      });
    } finally {
      setIsTracing(false);
    }
  }, []);

  return {
    isTracing,
    result,
    currentHops,
    startTrace,
  };
};
