import React from "react";
import ReactDOM from "react-dom/client";
import { ConvexProvider, ConvexReactClient } from "convex/react";
import App from "./App";
import "./index.css";

// VITE_CONVEX_URL is read at runtime (build does not require it). Point it at
// your deployment, e.g. https://<your-deployment>.convex.cloud — find it in the
// Convex dashboard or your .env.local CONVEX_URL.
const convexUrl = import.meta.env.VITE_CONVEX_URL;

// Construct the client even if the URL is missing so the app can render a clear
// message rather than crashing at import time.
const convex = new ConvexReactClient(convexUrl ?? "");

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {convexUrl ? (
      <ConvexProvider client={convex}>
        <App />
      </ConvexProvider>
    ) : (
      <div className="missing-url">
        <h1>Missing configuration</h1>
        <p>
          <code>VITE_CONVEX_URL</code> is not set. Add it to a <code>.env</code>{" "}
          or <code>.env.local</code> file at the repo root, e.g.{" "}
          <code>VITE_CONVEX_URL=https://your-deployment.convex.cloud</code>, then
          restart the dev server.
        </p>
      </div>
    )}
  </React.StrictMode>,
);
