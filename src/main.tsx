import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { installTraps } from "./debug/traps";
import { invoke } from "@tauri-apps/api/core";

// Extend Window interface to include our custom property
declare global {
  interface Window {
    __sessionId?: string;
    __TAURI_INTERNALS__?: any;
  }
}

// Generate and log session ID for detecting app restarts
const generateSessionId = () => {
  return 'session_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
};

const logToFrontend = (message: string) => {
  console.log(`[FRONTEND] ${message}`);
};

const logToRust = async (level: "debug" | "info" | "warn" | "error", message: string) => {
  try {
    // Check if Tauri is available before attempting to invoke
    if (typeof window !== 'undefined' && window.__TAURI_INTERNALS__ !== undefined) {
      await invoke(`log_${level}`, { message });
    } else {
      logToFrontend(`Fallback log - ${level.toUpperCase()}: ${message}`);
    }
  } catch (e) {
    logToFrontend(`Fallback log - ${level.toUpperCase()}: ${message}`);
  }
};

// Initialize session tracking
const currentSessionId = generateSessionId();
window.__sessionId = currentSessionId;

const lastSessionId = localStorage.getItem('__frontend_session_id');

if (lastSessionId && lastSessionId !== currentSessionId) {
  logToFrontend(`App restarted/reloaded - Previous session: ${lastSessionId}, Current session: ${currentSessionId}`);
  logToRust('warn', `[FRONTEND] App reloaded/restarted - prev_session=${lastSessionId}, curr_session=${currentSessionId}`);
} else {
  logToFrontend(`New app session: ${currentSessionId}`);
  logToRust('info', `[FRONTEND] New app session started: ${currentSessionId}`);
}

localStorage.setItem('__frontend_session_id', currentSessionId);

installTraps();
createRoot(document.getElementById("root")!).render(<App />);