import "../ui/zod-config";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../ui/styles.css";
import { SettingsPage } from "./Settings";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <SettingsPage />
  </StrictMode>,
);
