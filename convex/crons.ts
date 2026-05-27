// convex/crons.ts
import { cronJobs } from "convex/server";
// import { internal } from "./_generated/api";  // uncomment alongside ANY cron entry below

const crons = cronJobs();

// Hello-world daily — UNCOMMENT to enable. Posts at 12:00 UTC every day.
// To activate: uncomment the `import { internal }` line above AND the block below.
// crons.daily(
//   "hello-world daily",
//   { hourUTC: 12, minuteUTC: 0 },
//   internal.examples.helloWorld.sendHello.sendHello,
//   { reason: "cron" as const },
// );

// Pack-list morning — UNCOMMENT to enable. 00:00 UTC = 07:00 in UTC+7 timezones.
// crons.daily(
//   "pack-list morning",
//   { hourUTC: 0, minuteUTC: 0 },
//   internal.examples.packList.sendPackList.sendPackList,
//   { reason: "morning" as const },
// );

// Pack-list midday reminder — UNCOMMENT to enable. 06:00 UTC = 13:00 in UTC+7.
// crons.daily(
//   "pack-list midday",
//   { hourUTC: 6, minuteUTC: 0 },
//   internal.examples.packList.sendPackList.sendPackList,
//   { reason: "midday" as const },
// );

export default crons;
