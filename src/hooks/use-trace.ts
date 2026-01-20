import { useState, useCallback } from "react";
import { HopData, TraceResult, GeoLocation } from "@/types/trace";
import { invoke, isTauri } from "@tauri-apps/api/core";
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

// Improved parser for different traceroute output formats
const parseTracerouteOutput = (output: string, target: string): HopData[] => {
  const lines = output.split(/\r?\n/);
  const hops: HopData[] = [];
  
  for (const line of lines) {
    // Try Windows format first
    const winHop = parseWindowsHop(line);
    if (winHop) {
      hops.push(winHop);
      continue;
    }
    
    // Parse Unix format: 1  192.168.1.1  0.500 ms  0.400 ms  0.300 ms
    const unixPattern = /^\s*(\d+)\s+(.+)?\s+((?:\d+\.\d+\s+ms\s+){2,}(?:\d+\.\d+\s+ms|\*))$/;
    const unixMatch = line.match(unixPattern);
    if (unixMatch) {
      const [, hopStr, hostPart, msPart] = unixMatch;
      const hopNum = parseInt(hopStr);
      
      // Parse host and IP
      const hostParts = hostPart ? hostPart.trim().split(/[\s]+/) : [];
      let ip = "";
      let host = "";
      
      if (hostParts.length > 0) {
        const lastPart = hostParts[hostParts.length - 1];
        if (isValidIP(lastPart)) {
          ip = lastPart;
          host = hostParts.length > 1 ? hostParts.slice(0, -1).join(" ") : undefined;
        } else {
          host = hostPart?.trim();
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

// Robust Windows tracert line parser
const parseWindowsHop = (line: string): HopData | null => {
  // Example:
  //  1    <1 ms    <1 ms    <1 ms  192.168.1.1
  //  2     *        *        *     Request timed out.
  //  3    12 ms    11 ms    13 ms  router [192.168.1.1]

  const m = line.match(/^\s*(\d+)\s+(.*)$/);
  if (!m) return null;

  const hop = parseInt(m[1], 10);
  const rest = m[2];

  // Grab three latency "tokens" (either "*", "<1 ms", "12 ms")
  const latencyTokens = rest.match(/(\*|<\s*\d+\s*ms|\d+\s*ms)/gi);
  if (!latencyTokens || latencyTokens.length < 3) return null;

  const latencies: (number | "*")[] = latencyTokens.slice(0, 3).map(t => {
    const cleaned = t.replace(/\s+/g, "").toLowerCase(); // "<1ms" or "12ms" or "*"
    if (cleaned === "*") return "*";
    const num = parseInt(cleaned.replace(/[<ms]/g, ""), 10);
    return Number.isNaN(num) ? "*" : num;
  });

  const afterLatencies = rest.split(latencyTokens.slice(0, 3).join("")).pop()?.trim() ?? rest;

  // Timeout line
  if (/request timed out/i.test(rest)) {
    return { hop, latencies, status: "timeout" };
  }

  // Extract IP from brackets or last token
  const ipBracket = rest.match(/\[([0-9a-fA-F:.]+)\]/);
  const ipLoose = rest.match(/((?:\d{1,3}\.){3}\d{1,3}|[0-9a-fA-F:.]{2,})/);

  const ip = ipBracket?.[1] ?? ipLoose?.[1];
  let host: string | undefined;

  if (ipBracket) {
    host = rest.split("[")[0].trim().split(/\s+/).slice(3).join(" ").trim() || undefined;
  }

  const hasTimeout = latencies.some(l => l === "*");
  const nums = latencies.filter(l => typeof l === "number") as number[];
  const avgLatency = nums.length ? Math.round(nums.reduce((a, b) => a + b, 0) / nums.length) : undefined;

  return {
    hop,
    host,
    ip,
    latencies,
    status: hasTimeout ? "timeout" : "success",
    avgLatency,
  };
};

const isValidIP = (str: string): boolean => {
  // Simple regex for IPv4
  const ipv4Regex = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
  // Simple regex for IPv6
  const ipv6Regex = /^(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$|^(?:[0-9a-fA-F]{1,4}:)*::(?:[0-9a-fA-F]{1,4}:)*[0-9a-fA-F]{1,4}$/;
  return ipv4Regex.test(str) || ipv6Regex.test(str);
};

// Generate placeholder geo data for visualization
const generatePlaceholderGeo = (index: number, totalHops: number): GeoLocation => {
  // Distribute hops along a rough path from source to destination
  const progress = totalHops > 1 ? index / (totalHops - 1) : 0;
  
  // Start from roughly North America (San Francisco area)
  const startLat = 37.7749;
  const startLng = -122.4194;
  
  // End at roughly destination (could be anywhere, using Europe as example)
  const endLat = 51.5074; // London
  const endLng = -0.1278; // London
  
  // Interpolate position
  const lat = startLat + (endLat - startLat) * progress;
  const lng = startLng + (endLng - startLng) * progress;
  
  // Add some variation to make it look more realistic
  const variance = 5;
  const variedLat = lat + (Math.random() - 0.5) * variance;
  const variedLng = lng + (Math.random() - 0.5) * variance;
  
  // Simple city mapping based on progress
  const cities = [
    { city: "San Francisco", country: "United States", countryCode: "US" },
    { city: "Denver", country: "United States", countryCode: "US" },
    { city: "Chicago", country: "United States", countryCode: "US" },
    { city: "New York", country: "United States", countryCode: "US" },
    { city: "London", country: "United Kingdom", countryCode: "GB" },
    { city: "Frankfurt", country: "Germany", countryCode: "DE" },
    { city: "Amsterdam", country: "Netherlands", countryCode: "NL" },
    { city: "Paris", country: "France", countryCode: "FR" }
  ];
  
  const cityIndex = Math.min(Math.floor(progress * cities.length), cities.length - 1);
  const selectedCity = cities[cityIndex];
  
  return {
    lat: variedLat,
    lng: variedLng,
    city: selectedCity.city,
    country: selectedCity.country,
    countryCode: selectedCity.countryCode
  };
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
      
      // Use Tauri invoke - proper Tauri v2 detection
      if (isTauri) {
        rawOutput = await (window as any).__TAURI__.invoke("run_traceroute", { target });
        console.log("REAL TRACEROUTE OUTPUT START", rawOutput.slice(0, 200));
      } else {
        // Force error - no fallback for real tracing
        throw new Error("Tauri context not available - cannot perform real traceroute. Run as desktop app.");
      }
      
      // Parse the output to extract hop data
      const hops = parseTracerouteOutput(rawOutput, target);
      
      // Add placeholder geo data for visualization
      const hopsWithGeo = hops.map((hop, index) => ({
        ...hop,
        geo: generatePlaceholderGeo(index, hops.length)
      }));
      
      // Update hops progressively for UI feedback
      for (let i = 0; i < hopsWithGeo.length; i++) {
        await new Promise((resolve) => setTimeout(resolve, 100)); // Small delay for visual effect
        setCurrentHops((prev) => [...prev, hopsWithGeo[i]]);
      }

      setResult({
        target,
        resolvedIp: target, // In a real implementation, this would be resolved from DNS
        hops: hopsWithGeo,
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
