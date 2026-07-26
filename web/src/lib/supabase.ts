import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  console.warn(
    "VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are not set — copy web/.env.example to web/.env.local and fill them in.",
  );
}

export const supabase = createClient(url ?? "", anonKey ?? "");

// Small helper — every Edge Function call needs the user's access token,
// and every response follows the { success, data, error } envelope.
export async function callFunction<T = unknown>(name: string, body: unknown): Promise<T> {
  const { data: session } = await supabase.auth.getSession();
  const token = session.session?.access_token;
  if (!token) throw new Error("Not authenticated");

  const resp = await fetch(`${url}/functions/v1/${name}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });

  const json = await resp.json();
  if (!json.success) {
    throw new Error(json.error?.message ?? `${name} failed`);
  }
  return json.data as T;
}

// GET variant — passes params as query string, used by read-only endpoints
// that read url.searchParams (e.g. get-weight-logs, get-daily-log-status).
export async function getFunction<T = unknown>(
  name: string,
  params: Record<string, string> = {},
): Promise<T> {
  const { data: session } = await supabase.auth.getSession();
  const token = session.session?.access_token;
  if (!token) throw new Error("Not authenticated");

  const qs = new URLSearchParams(params).toString();
  const resp = await fetch(`${url}/functions/v1/${name}${qs ? `?${qs}` : ""}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });

  const json = await resp.json();
  if (!json.success) {
    throw new Error(json.error?.message ?? `${name} failed`);
  }
  return json.data as T;
}
