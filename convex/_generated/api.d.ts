/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as lib_chunking from "../lib/chunking.js";
import type * as lib_constantTimeEqual from "../lib/constantTimeEqual.js";
import type * as lib_dateAnchors from "../lib/dateAnchors.js";
import type * as lib_telegramHtml from "../lib/telegramHtml.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  "lib/chunking": typeof lib_chunking;
  "lib/constantTimeEqual": typeof lib_constantTimeEqual;
  "lib/dateAnchors": typeof lib_dateAnchors;
  "lib/telegramHtml": typeof lib_telegramHtml;
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
