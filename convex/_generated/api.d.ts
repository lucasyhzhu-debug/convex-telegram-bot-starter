/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as crons from "../crons.js";
import type * as examples_helloWorld_helloFormat from "../examples/helloWorld/helloFormat.js";
import type * as examples_helloWorld_sendHello from "../examples/helloWorld/sendHello.js";
import type * as examples_packList_packListFormat from "../examples/packList/packListFormat.js";
import type * as examples_packList_packListQuery from "../examples/packList/packListQuery.js";
import type * as examples_packList_sendPackList from "../examples/packList/sendPackList.js";
import type * as http from "../http.js";
import type * as lib_chunking from "../lib/chunking.js";
import type * as lib_constantTimeEqual from "../lib/constantTimeEqual.js";
import type * as lib_dateAnchors from "../lib/dateAnchors.js";
import type * as lib_telegramHtml from "../lib/telegramHtml.js";
import type * as telegram_commands from "../telegram/commands.js";
import type * as telegram_webhook from "../telegram/webhook.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  crons: typeof crons;
  "examples/helloWorld/helloFormat": typeof examples_helloWorld_helloFormat;
  "examples/helloWorld/sendHello": typeof examples_helloWorld_sendHello;
  "examples/packList/packListFormat": typeof examples_packList_packListFormat;
  "examples/packList/packListQuery": typeof examples_packList_packListQuery;
  "examples/packList/sendPackList": typeof examples_packList_sendPackList;
  http: typeof http;
  "lib/chunking": typeof lib_chunking;
  "lib/constantTimeEqual": typeof lib_constantTimeEqual;
  "lib/dateAnchors": typeof lib_dateAnchors;
  "lib/telegramHtml": typeof lib_telegramHtml;
  "telegram/commands": typeof telegram_commands;
  "telegram/webhook": typeof telegram_webhook;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
