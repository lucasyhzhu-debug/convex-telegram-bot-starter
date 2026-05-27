// convex/http.ts
//
// Telegram webhook entry point. Add commands by importing each example
// app's `buildXxxCommands(scheduler)` and concatenating their registrations.
import { httpRouter } from "convex/server";
import { buildHandleTelegramWebhook } from "./telegram/webhook";
import { buildHelloWorldCommands } from "./examples/helloWorld/sendHello";
import { buildPackListCommands } from "./examples/packList/sendPackList";

const http = httpRouter();
http.route({
  path: "/telegram-webhook",
  method: "POST",
  handler: buildHandleTelegramWebhook((scheduler) => [
    ...buildHelloWorldCommands(scheduler),
    ...buildPackListCommands(scheduler),
  ]),
});
export default http;
