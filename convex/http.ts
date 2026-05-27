// convex/http.ts
//
// Telegram webhook entry point. Add commands by importing each example
// app's `buildXxxCommands(scheduler)` and concatenating their registrations.
//
// See convex/examples/helloWorld/sendHello.ts for the registration pattern.
import { httpRouter } from "convex/server";
import { buildHandleTelegramWebhook } from "./telegram/webhook";
import { buildHelloWorldCommands } from "./examples/helloWorld/sendHello";

const http = httpRouter();
http.route({
  path: "/telegram-webhook",
  method: "POST",
  handler: buildHandleTelegramWebhook((scheduler) => [
    ...buildHelloWorldCommands(scheduler),
  ]),
});
export default http;
