import { useState, useCallback } from "react";
import { HopData, TraceResult, GeoLocation } from "@/types/trace";

// Sample geo locations for simulation
const geoLocations: GeoLocation[] = [
  { lat: 37.7749, lng: -122.4194, city: "San Francisco", country: "United States", countryCode: "US" },
  { lat: 47.6062, lng: -122.3321, city: "Seattle", country: "United States", countryCode: "US" },
  { lat: 51.5074, lng: -0.1278, city: "London", country: "United Kingdom", countryCode: "GB" },
  { lat: 52.5200, lng: 13.4050, city: "Berlin", country: "Germany", countryCode: "DE" },
  { lat: 48.8566, lng: 2.3522, city: "Paris", country: "France", countryCode: "FR" },
  { lat: 35.6762, lng: 139.6503, city: "Tokyo", country: "Japan", countryCode: "JP" },
  { lat: 1.3521, lng: 103.8198, city: "Singapore", country: "Singapore", countryCode: "SG" },
  { lat: -33.8688, lng: 151.2093, city: "Sydney", country: "Australia", countryCode: "AU" },
  { lat: 55.7558, lng: 37.6173, city: "Moscow", country: "Russia", countryCode: "RU" },
  { lat: 40.7128, lng: -74.0060, city: "New York", country: "United States", countryCode: "US" },
];

// Simulated hop data for demo
const simulateHops = (target: string): HopData[] => {
  const hopCount = Math.floor(Math.random() * 5) + 5; // 5-10 hops
  const hops: HopData[] = [];

  const sampleHosts = [
    { host: "router.local", ip: "192.168.1.1" },
    { host: "gateway.isp.net", ip: "10.0.0.1" },
    { host: "core-rtr-1.isp.net", ip: "200.212.92.234" },
    { host: "edge-rtr.isp.net", ip: "93.163.36.15" },
    { host: "peer.cdn.net", ip: "172.16.0.1" },
    { host: "dns.google", ip: target },
  ];

  // Shuffle and pick geo locations for variety
  const shuffledGeos = [...geoLocations].sort(() => Math.random() - 0.5);

  for (let i = 1; i <= hopCount; i++) {
    const isTimeout = Math.random() < 0.1; // 10% chance of timeout
    const baseLatency = i * 2 + Math.random() * 5;
    
    if (isTimeout) {
      hops.push({
        hop: i,
        latencies: ["*", "*", "*"],
        status: "timeout",
      });
    } else {
      const hostData = sampleHosts[Math.min(i - 1, sampleHosts.length - 1)];
      const latencies = [
        Math.round(baseLatency + Math.random() * 2),
        Math.round(baseLatency + Math.random() * 2),
        Math.round(baseLatency + Math.random() * 2),
      ];
      const avgLatency = Math.round(latencies.reduce((a, b) => a + b, 0) / 3);
      const geo = shuffledGeos[i % shuffledGeos.length];

      hops.push({
        hop: i,
        host: i === hopCount ? target : hostData.host,
        ip: i === hopCount ? target : hostData.ip,
        latencies: latencies as (number | "*")[],
        avgLatency,
        status: "success",
        geo: i > 1 ? geo : { lat: 37.7749, lng: -122.4194, city: "Local", country: "Your Location", countryCode: "LC" },
      });
    }
  }

  return hops;
};

const generateRawOutput = (target: string, hops: HopData[]): string => {
  let output = `Tracing route to ${target} [${target}]\n`;
  output += `over a maximum of 30 hops:\n\n`;

  hops.forEach((hop) => {
    const latStr = hop.latencies
      .map((l) => (l === "*" ? "  *  " : `${String(l).padStart(3)} ms`))
      .join("  ");
    const hostStr = hop.host
      ? `${hop.host} [${hop.ip}]`
      : hop.ip || "Request timed out.";
    const geoStr = hop.geo ? ` (${hop.geo.city}, ${hop.geo.countryCode})` : "";
    output += `${String(hop.hop).padStart(2)}    ${latStr}  ${hostStr}${geoStr}\n`;
  });

  output += `\nTrace complete.`;
  return output;
};

export const useTraceSimulation = () => {
  const [isTracing, setIsTracing] = useState(false);
  const [result, setResult] = useState<TraceResult | null>(null);
  const [currentHops, setCurrentHops] = useState<HopData[]>([]);

  const startTrace = useCallback(async (target: string) => {
    setIsTracing(true);
    setCurrentHops([]);
    setResult(null);

    const startTime = new Date();
    const simulatedHops = simulateHops(target);

    // Simulate progressive hop discovery
    for (let i = 0; i < simulatedHops.length; i++) {
      await new Promise((resolve) => setTimeout(resolve, 300 + Math.random() * 200));
      setCurrentHops((prev) => [...prev, simulatedHops[i]]);
    }

    const rawOutput = generateRawOutput(target, simulatedHops);

    setResult({
      target,
      resolvedIp: target,
      hops: simulatedHops,
      rawOutput,
      startTime,
      endTime: new Date(),
    });

    setIsTracing(false);
  }, []);

  return {
    isTracing,
    result,
    currentHops,
    startTrace,
  };
};
