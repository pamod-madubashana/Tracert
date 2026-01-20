import { listen } from "@tauri-apps/api/event";
import { useEffect, useRef, useState } from "react";

export type TraceLineEvent = {
  trace_id: string;
  line_no: number;
  line: string;
};

export function useTraceStream(activeTraceId: string | null) {
  const [lines, setLines] = useState<TraceLineEvent[]>([]);
  const activeIdRef = useRef<string | null>(null);

  useEffect(() => {
    activeIdRef.current = activeTraceId;
  }, [activeTraceId]);

  useEffect(() => {
    let unlisten: null | (() => void) = null;

    (async () => {
      unlisten = await listen<TraceLineEvent>("trace:line", (event) => {
        // ignore events from old traces
        if (!activeIdRef.current) return;
        if (event.payload.trace_id !== activeIdRef.current) return;

        setLines((prev) => [...prev, event.payload]);
      });
    })();

    return () => {
      if (unlisten) unlisten();
    };
  }, []);

  const reset = () => setLines([]);

  return { lines, reset };
}