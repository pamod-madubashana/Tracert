import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useEffect, useRef, useState } from "react";
import { TraceResult } from "@/types/trace";

export type TraceLineEvent = {
  trace_id: string;
  line_no: number;
  line: string;
};

export type TraceCompleteEvent = {
  trace_id: string;
  result: TraceResult;
};

export function useTraceStream(activeTraceId: string | null) {
  const [lines, setLines] = useState<TraceLineEvent[]>([]);
  const [completion, setCompletion] = useState<TraceCompleteEvent | null>(null);
  const activeIdRef = useRef<string | null>(null);
  const lastExpectedTraceIdRef = useRef<string | null>(null); // Track the last expected trace ID
  const unlistenRef = useRef<UnlistenFn | null>(null);

  useEffect(() => {
    if (activeTraceId) {
      activeIdRef.current = activeTraceId;
      lastExpectedTraceIdRef.current = activeTraceId; // Keep track for completion events
    } else {
      activeIdRef.current = activeTraceId;
    }
  }, [activeTraceId]);

  useEffect(() => {
    // Check if we're in Tauri environment
    const isTauriAvailable = typeof window !== 'undefined' && 
      window.__TAURI_INTERNALS__ !== undefined;

    if (!isTauriAvailable) {
      console.warn('[useTraceStream] Tauri not available, skipping event listener setup');
      return;
    }

    let unlistenLine: UnlistenFn | null = null;
    let unlistenComplete: UnlistenFn | null = null;

    (async () => {
      try {
        // Listen for trace line events
        unlistenLine = await listen<TraceLineEvent>("trace:line", (event) => {
          // ignore events from old traces
          if (!activeIdRef.current) return;
          if (event.payload.trace_id !== activeIdRef.current) return;

          setLines((prev) => [...prev, event.payload]);
        });
        
        // Listen for trace completion events
        unlistenComplete = await listen<TraceCompleteEvent>("trace:complete", (event) => {
          console.log('[React] [useTraceStream] Received trace:complete event:', event);
          // For completion events, check both current and last expected trace ID
          // This handles potential race conditions where activeTraceId gets reset before
          // the completion event is processed
          if (!activeIdRef.current && !lastExpectedTraceIdRef.current) {
            console.log('[React] [useTraceStream] Rejecting completion event - no active trace ID');
            return;
          }
          if (event.payload.trace_id !== activeIdRef.current && 
              event.payload.trace_id !== lastExpectedTraceIdRef.current) {
            console.log('[React] [useTraceStream] Rejecting completion event - trace ID mismatch', {
              eventTraceId: event.payload.trace_id,
              activeId: activeIdRef.current,
              lastExpectedId: lastExpectedTraceIdRef.current
            });
            return;
          }

          console.log('[React] [useTraceStream] Accepting completion event for trace:', event.payload.trace_id);
          setCompletion(event.payload);
        });
        
        // Store both unlisten functions for proper cleanup
        unlistenRef.current = () => {
          if (unlistenLine) {
            unlistenLine();
          }
          if (unlistenComplete) {
            unlistenComplete();
          }
        };
      } catch (error) {
        console.error('[useTraceStream] Failed to setup event listeners:', error);
      }
    })();

    return () => {
      if (unlistenRef.current && typeof unlistenRef.current === 'function') {
        unlistenRef.current();
      }
    };
  }, []);

  const reset = () => {
    setLines([]);
    setCompletion(null);
  };

  return { lines, completion, reset };
}