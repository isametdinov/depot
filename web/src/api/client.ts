import type { ErrorBody } from "./types";

/** Base URL of the Go API, configured via VITE_API_BASE_URL. */
export const API_BASE_URL: string =
  (import.meta.env.VITE_API_BASE_URL as string | undefined) || "http://localhost:8080";

const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * A failed API call. `code` is the backend's error code for HTTP errors, or
 * one of the transport codes below for failures before/without a response:
 * - "network_error": the server could not be reached
 * - "timeout": the request timed out (the outcome may be ambiguous server-side)
 * - "invalid_response": the response was not readable JSON
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

/** True for aborts initiated by the caller (stale requests); not an error. */
export function isAbort(e: unknown): boolean {
  return e instanceof DOMException && e.name === "AbortError";
}

interface RequestOptions {
  method?: "GET" | "POST";
  body?: unknown;
  headers?: Record<string, string>;
  /** Caller-controlled cancellation for stale requests. */
  signal?: AbortSignal;
  timeoutMs?: number;
}

/**
 * Performs a JSON request against the Go API and parses the backend's error
 * format. Errors are always thrown — never swallowed, never faked.
 */
export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const controller = new AbortController();
  const timeoutId = setTimeout(
    () => controller.abort(new DOMException("Request timed out", "TimeoutError")),
    options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  );
  const onCallerAbort = () => controller.abort();
  options.signal?.addEventListener("abort", onCallerAbort, { once: true });

  try {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (options.body !== undefined) headers["Content-Type"] = "application/json";
    Object.assign(headers, options.headers ?? {});

    const res = await fetch(API_BASE_URL + path, {
      method: options.method ?? "GET",
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
    });

    const text = await res.text();
    let json: unknown = null;
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        json = null;
      }
    }

    if (!res.ok) {
      const errBody = json as ErrorBody | null;
      const code = errBody?.error?.code ?? "http_error";
      const message = errBody?.error?.message ?? `Request failed with status ${res.status}.`;
      throw new ApiError(res.status, code, message);
    }
    if (json === null) {
      throw new ApiError(res.status, "invalid_response", "The server returned an unreadable response.");
    }
    return json as T;
  } catch (e) {
    if (e instanceof ApiError) throw e;
    if (isAbort(e)) {
      // A caller cancel (stale request) propagates unchanged so callers can
      // ignore it; our own timeout becomes an explicit, honest error.
      if (options.signal?.aborted) throw e;
      throw new ApiError(
        0,
        "timeout",
        "The request timed out. It may or may not have been processed — retrying with the same idempotency key is safe.",
      );
    }
    throw new ApiError(
      0,
      "network_error",
      "Cannot reach the API. Check that the backend is running and VITE_API_BASE_URL is correct.",
    );
  } finally {
    clearTimeout(timeoutId);
    options.signal?.removeEventListener("abort", onCallerAbort);
  }
}
