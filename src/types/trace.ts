export interface GeoLocation {
  lat?: number;
  lng?: number;
  city?: string;
  country?: string;
  countryCode?: string;
}

export interface HopData {
  hop: number;
  host?: string;
  ip?: string;
  latencies: (number | "*")[];
  avgLatency?: number;
  status: "success" | "timeout" | "pending";
  geo?: GeoLocation;
}

export interface TraceResult {
  target: string;
  resolvedIp?: string;
  hops: HopData[];
  rawOutput: string;
  startTime: Date;
  endTime?: Date;
}
