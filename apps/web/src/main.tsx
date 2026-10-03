import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { OfflineBanner, PwaUpdatePrompt } from "./components/PwaStatus";
import { startInstallPromptCapture } from "./lib/install-prompt";
import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import "./theme.css";
import "./styles.css";
import "./shell.css";
import "./catalog.css";
import "./review.css";
import "./duplicates.css";
import "./views.css";
import "./mobile.css";
import "./pwa.css";

startInstallPromptCapture();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
    <OfflineBanner />
    <PwaUpdatePrompt />
  </React.StrictMode>
);
