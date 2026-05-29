// The Convex backend source (reachable through the generated `api` type graph)
// references Node's `process.env`. The web tsconfig deliberately omits the
// `node` type lib (it's a browser app), so we declare the minimal shape here to
// keep `tsc` happy without dragging in all of @types/node. This is type-only;
// it emits nothing.
declare const process: {
  env: Record<string, string | undefined>;
};
