#!/usr/bin/env node
// scripts/new-webhook-secret.mjs
// Prints a 64-hex-char secret. Use for TELEGRAM_WEBHOOK_SECRET. One per deployment.

import { randomBytes } from "node:crypto";
console.log(randomBytes(32).toString("hex"));
