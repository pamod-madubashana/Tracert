// src/debug/traps.ts
import { invoke } from "@tauri-apps/api/core";

const log = async (level: "debug" | "info" | "warn" | "error", msg: string) => {
  try {
    await invoke(`log_${level}`, { message: msg });
  } catch {
    // fallback if invoke not available
    console.log(`[${level}] ${msg}`);
  }
};

export function installTraps() {
  // Detect reload / navigation
  window.addEventListener("beforeunload", () => {
    void log("warn", "[TRAP] beforeunload fired (reload/navigation)");
  });

  // History navigation traps (SPA route changes)
  const origPushState = history.pushState;
  history.pushState = function (...args) {
    void log("warn", `[TRAP] history.pushState called: ${JSON.stringify(args)}\nstack=${new Error().stack}`);
    // @ts-ignore
    return origPushState.apply(this, args);
  };

  const origReplaceState = history.replaceState;
  history.replaceState = function (...args) {
    void log("warn", `[TRAP] history.replaceState called: ${JSON.stringify(args)}\nstack=${new Error().stack}`);
    // @ts-ignore
    return origReplaceState.apply(this, args);
  };
  const oldReplaceState = history.replaceState.bind(history);
  history.replaceState = function (...args) {
    const url = args[2];
    if (typeof url === "string" && url.startsWith("http")) {
      // log only suspicious ones
    }
    return oldReplaceState(...args as any);
  };
  
  window.addEventListener("popstate", () => {
    void log("warn", `[TRAP] popstate fired: href=${location.href}`);
  });

  // Trap window.open (often used by libraries)
  const originalOpen = window.open;
  window.open = function (...args) {
    void log("warn", `[TRAP] window.open called args=${JSON.stringify(args)}\nstack=${new Error().stack}`);
    // @ts-ignore
    return originalOpen.apply(window, args);
  };

  // Trap anchor navigation
  document.addEventListener(
    "click",
    (e) => {
      const el = e.target as HTMLElement | null;
      const a = el?.closest?.("a") as HTMLAnchorElement | null;
      if (!a) return;

      // Note: this does NOT stop navigation, it logs it.
      const href = a.getAttribute("href");
      void log("info", `[TRAP] Anchor click href=${href} full=${a.href} target=${a.target || "(none)"}`);
    },
    true
  );

  // Trap form submit (still the #1 “why is this reloading” issue)
  document.addEventListener(
    "submit",
    (e) => {
      const form = e.target as HTMLFormElement | null;
      void log(
        "warn",
        `[TRAP] FORM submit detected action=${form?.action || "(none)"} method=${form?.method || "(none)"}\nstack=${new Error().stack}`
      );
    },
    true
  );

  // JS errors
  window.addEventListener("unhandledrejection", (e) => {
    void log("error", `[TRAP] unhandledrejection: ${String(e.reason)}`);
  });

  window.addEventListener("error", (e) => {
    void log("error", `[TRAP] window error: ${e.message}`);
  });

  void log("info", "[TRAP] Debug traps installed");
}
