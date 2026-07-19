// health
// Public endpoint. Returns service status and database connectivity.

import { ok, fail, preflight } from "../_shared/envelope.ts";
import { getServiceClient } from "../_shared/supabaseClient.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return preflight();
  try {
    const service = getServiceClient();
    const { error } = await service.from("system_settings").select("key").limit(1);
    if (error) return fail("DB_UNAVAILABLE", "Database connectivity check failed", 503);
    const ipResp = await fetch("https://api.ipify.org?format=json").catch(() => null);
    const outboundIp = ipResp ? (await ipResp.json().catch(() => ({}))).ip ?? "unknown" : "unknown";
    return ok({ status: "ok", database: "connected", timestamp: new Date().toISOString(), outbound_ip: outboundIp });
  } catch (err) {
    console.error(err);
    return fail("INTERNAL_ERROR", "Health check failed", 500);
  }
});
