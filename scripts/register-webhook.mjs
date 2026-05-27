#!/usr/bin/env node
// scripts/register-webhook.mjs
// Registers (or removes) your Telegram webhook against api.telegram.org/setWebhook.
//
// Usage:
//   node scripts/register-webhook.mjs \
//     --token=<bot-token> \
//     --deployment=<convex-deployment-name> \
//     --secret=<64-hex-secret>
//
//   node scripts/register-webhook.mjs --token=<...> --remove
//
// Why this script exists: passing `allowed_updates=["message"]` via curl on
// PowerShell splits on `[`. Constructing the JSON body in Node sidesteps it.

function getArg(name) {
  const m = process.argv.find((a) => a.startsWith(`--${name}=`));
  return m ? m.slice(`--${name}=`.length) : undefined;
}

async function main() {
  const token = getArg("token");
  const deployment = getArg("deployment");
  const secret = getArg("secret");
  const remove = process.argv.includes("--remove");

  if (!token) {
    console.error("Usage: --token=<bot-token> [--deployment=<name> --secret=<hex>] [--remove]");
    process.exit(2);
  }
  const base = `https://api.telegram.org/bot${token}`;

  if (remove) {
    const res = await fetch(`${base}/deleteWebhook`, { method: "POST" });
    console.log("deleteWebhook:", await res.text());
    return;
  }

  if (!deployment || !secret) {
    console.error("Both --deployment and --secret are required for setWebhook");
    process.exit(2);
  }

  const url = `https://${deployment}.convex.site/telegram-webhook`;
  const body = {
    url,
    secret_token: secret,
    allowed_updates: ["message"],
    drop_pending_updates: true,
  };
  const res = await fetch(`${base}/setWebhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  console.log("setWebhook:", JSON.stringify(json, null, 2));
  if (!json.ok) process.exit(1);

  const info = await fetch(`${base}/getWebhookInfo`);
  console.log("getWebhookInfo:", JSON.stringify(await info.json(), null, 2));
}

main().catch((err) => { console.error(err); process.exit(1); });
