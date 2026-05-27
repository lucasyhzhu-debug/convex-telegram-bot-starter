// HTML escape + sendMessage helper for Telegram's HTML parse mode.
// pattern: see ./constantTimeEqual.ts

/**
 * Escape &, <, > for Telegram HTML parse_mode. Quotes and apostrophes are
 * NOT escaped — Telegram's HTML mode allows them raw. Order matters:
 * & must be replaced first, otherwise we'd double-encode &lt; etc.
 */
export function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

interface TelegramSendResponse {
  ok: boolean;
  result?: { message_id: number };
  description?: string;
}

/**
 * POST to Telegram sendMessage with parse_mode: HTML.
 * Throws on transport error, non-OK HTTP, or ok:false in the JSON body.
 */
export async function sendTelegramHtml(
  token: string,
  chatId: string,
  html: string,
): Promise<{ message_id: number }> {
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: html,
      parse_mode: "HTML",
      disable_web_page_preview: true,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Telegram sendMessage HTTP ${res.status}: ${body}`);
  }
  const json = (await res.json()) as TelegramSendResponse;
  if (!json.ok || !json.result) {
    throw new Error(`Telegram sendMessage failed: ${json.description ?? "unknown"}`);
  }
  return json.result;
}
