/// <reference types="vite/client" />

// Typing for the one env var the app reads at runtime.
interface ImportMetaEnv {
  readonly VITE_CONVEX_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
