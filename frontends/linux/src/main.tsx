import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./app/App";
import "./styles/global.css";
import {
  applyDocumentPreferences,
  readStoredFontSize,
  readStoredLocale,
  readStoredTheme,
} from "./lib/preferences";

applyDocumentPreferences(readStoredLocale(), readStoredTheme(), readStoredFontSize());

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
