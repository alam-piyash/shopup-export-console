import { supabase } from "./supabase";

/** An error answer from the Go API. `message` is shown to the user as is. */
export class ApiError extends Error {
  constructor(message: string, public status: number, public code?: string, public details?: string, public hint?: string) {
    super(message);
  }
}

async function accessToken(refresh = false): Promise<string | undefined> {
  if (refresh) {
    const { data } = await supabase.auth.refreshSession();
    return data.session?.access_token;
  }
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token;
}

/** Calls the Go API at /api<path> as the signed-in user. */
export async function api<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
  const send = async (token?: string) =>
    fetch(`/api${path}`, {
      method,
      cache: "no-store",
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  let res = await send(await accessToken());
  if (res.status === 401) res = await send(await accessToken(true)); // token expired: refresh once
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    const e = (data ?? {}) as { message?: string; code?: string; details?: string; hint?: string };
    throw new ApiError(e.message || `Request failed (${res.status})`, res.status, e.code, e.details, e.hint);
  }
  return data as T;
}

export const get = <T = unknown>(path: string) => api<T>("GET", path);
export const post = <T = unknown>(path: string, body?: unknown) => api<T>("POST", path, body ?? {});
export const patch = <T = unknown>(path: string, body?: unknown) => api<T>("PATCH", path, body ?? {});
export const put = <T = unknown>(path: string, body?: unknown) => api<T>("PUT", path, body ?? {});
export const del = <T = unknown>(path: string) => api<T>("DELETE", path);

/** Builds a query string, skipping empty values. */
export function qs(params: Record<string, string | number | boolean | string[] | undefined | null>) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0)) continue;
    p.set(k, Array.isArray(v) ? v.join(",") : String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : "";
}
