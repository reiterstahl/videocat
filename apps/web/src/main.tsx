import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
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

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
