// convex/crons.ts
import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Hello-world example: daily at noon UTC, post a "hello" to the configured chat.
// Uncomment to enable. The internalAction must accept the args you pass here.
// crons.daily(
//   "hello-world daily",
//   { hourUTC: 12, minuteUTC: 0 },
//   internal.examples.helloWorld.sendHello.sendHello,
//   {},
// );

export default crons;
