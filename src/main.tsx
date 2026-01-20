import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { installTraps } from "./debug/traps";
installTraps();
createRoot(document.getElementById("root")!).render(<App />);
