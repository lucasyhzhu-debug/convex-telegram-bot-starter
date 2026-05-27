// convex/http.ts (intermediate — replaced in Phase 4 Task 4.2)
import { httpRouter } from "convex/server";
import { buildHandleTelegramWebhook } from "./telegram/webhook";

const http = httpRouter();
http.route({
  path: "/telegram-webhook",
  method: "POST",
  handler: buildHandleTelegramWebhook(() => []),  // empty registry; filled in Task 4.2
});
export default http;
