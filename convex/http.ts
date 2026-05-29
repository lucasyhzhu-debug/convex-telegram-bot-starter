// convex/http.ts
//
// Telegram webhook entry point. Add commands by importing each app's
// `buildXxxCommands(scheduler)` and concatenating their registrations.
//
// v2: `buildRegistryCommands` adds the self-registration built-ins (/register,
// /start), and the `{ trackLastSeen: true }` option wires non-command messages
// to touchChatLastSeen so the admin UI shows live "last seen" stamps. If you
// don't use the registry, drop the registry import and the options arg.
import { httpRouter } from "convex/server";
import { buildHandleTelegramWebhook } from "./telegram/webhook";
import { buildRegistryCommands } from "./telegram/registryCommands";
import { buildHelloWorldCommands } from "./examples/helloWorld/sendHello";
import { buildPackListCommands } from "./examples/packList/sendPackList";

const http = httpRouter();
http.route({
  path: "/telegram-webhook",
  method: "POST",
  handler: buildHandleTelegramWebhook(
    (scheduler) => [
      ...buildRegistryCommands(scheduler),
      ...buildHelloWorldCommands(scheduler),
      ...buildPackListCommands(scheduler),
    ],
    { trackLastSeen: true },
  ),
});
export default http;
