// convex/http.ts
//
// Telegram webhook entry point. The empty registry below is the
// minimum viable wiring — add commands by importing each example app's
// `buildXxxCommands(scheduler)` and concatenating their registrations.
//
// See convex/examples/helloWorld/sendHello.ts and convex/examples/packList/sendPackList.ts
// (added in later phases) for the registration pattern.
import { httpRouter } from "convex/server";
import { buildHandleTelegramWebhook } from "./telegram/webhook";

const http = httpRouter();
http.route({
  path: "/telegram-webhook",
  method: "POST",
  handler: buildHandleTelegramWebhook(() => []),  // empty registry — extend in your example app
});
export default http;
