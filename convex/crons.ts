// convex/crons.ts
import { cronJobs } from "convex/server";
// import { internal } from "./_generated/api";  // uncomment alongside the cron entry below

const crons = cronJobs();

// Hello-world daily — UNCOMMENT to enable. Posts at 12:00 UTC every day.
// To activate: uncomment the `import { internal }` line above AND the block below.
// crons.daily(
//   "hello-world daily",
//   { hourUTC: 12, minuteUTC: 0 },
//   internal.examples.helloWorld.sendHello.sendHello,
//   { reason: "cron" as const },
// );

export default crons;
