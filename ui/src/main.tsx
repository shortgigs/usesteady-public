import { StrictMode } from "react";
import { createRoot }  from "react-dom/client";
import posthog         from "posthog-js";
import "./index.css";
import App             from "./App.js";

const PH_KEY = import.meta.env["VITE_POSTHOG_KEY"] as string | undefined;
if (PH_KEY) {
  posthog.init(PH_KEY, {
    api_host:          "https://us.i.posthog.com",
    capture_pageview:  true,
    capture_pageleave: true,
    person_profiles:   "identified_only",
  });
}

const root = document.getElementById("root");
if (!root) throw new Error("No #root element found.");
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
