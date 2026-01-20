// src/debug/traps.ts
import { invoke } from "@tauri-apps/api/core";

const log = async (level: "debug" | "info" | "warn" | "error", msg: string) => {
  try {
    await invoke(`log_${level}`, { message: msg });
  } catch {
    // ignore if backend not ready
    console.log(`[${level}] ${msg}`);
  }
};

export function installTraps() {
  // Detect page reload / navigation
  window.addEventListener("beforeunload", () => {
    void log("warn", "[TRAP] beforeunload fired (page is reloading/navigating)");
  });

  window.addEventListener("unhandledrejection", (e) => {
    void log("error", `[TRAP] unhandledrejection: ${String(e.reason)}`);
  });

  window.addEventListener("error", (e) => {
    void log("error", `[TRAP] window error: ${e.message}`);
  });

  // Trap window.open
  const originalOpen = window.open;
  window.open = function (...args) {
    void log("warn", `[TRAP] window.open called with args=${JSON.stringify(args)}\nstack=${new Error().stack}`);
    // @ts-ignore
    return originalOpen.apply(window, args);
  };

  // Trap location changes
  const originalAssign = window.location.assign.bind(window.location);
  window.location.assign = ((url: string | URL) => {
    void log("warn", `[TRAP] location.assign called: ${String(url)}\nstack=${new Error().stack}`);
    originalAssign(url);
  }) as any;

  const originalReplace = window.location.replace.bind(window.location);
  window.location.replace = ((url: string | URL) => {
    void log("warn", `[TRAP] location.replace called: ${String(url)}\nstack=${new Error().stack}`);
    originalReplace(url);
  }) as any;

  // Trap link clicks that might navigate
  document.addEventListener(
    "click",
    (e) => {
      const el = e.target as HTMLElement | null;
      const a = el?.closest?.("a") as HTMLAnchorElement | null;
      if (a?.href) {
        void log("info", `[TRAP] Anchor clicked href=${a.href} target=${a.target || "(none)"}`);
      }
    },
    true
  );

  void log("info", "[TRAP] Debug traps installed");
}
