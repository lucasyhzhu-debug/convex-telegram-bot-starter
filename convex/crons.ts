// convex/crons.ts
import { cronJobs } from "convex/server";
// import { internal } from "./_generated/api";  // uncomment alongside the cron entry below

const crons = cronJobs();

// Hello-world example: daily at noon UTC, post a "hello" to the configured chat.
// To enable: uncomment the `import { internal }` line above AND the block below.
// crons.daily(
//   "hello-world daily",
//   { hourUTC: 12, minuteUTC: 0 },
//   internal.examples.helloWorld.sendHello.sendHello,
//   {},
// );

export default crons;
