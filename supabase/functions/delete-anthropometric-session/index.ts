/** Deletes one complete anthropometric session owned by the authenticated user. */
import { ok, fail, preflight } from "../_shared/envelope.ts";
import { getServiceClient, getUserClient } from "../_shared/supabaseClient.ts";
import { AnthropometryValidationError } from "../_shared/anthropometry.ts";
import { optionalUuid } from "../_shared/anthropometryApi.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return preflight();
  if (req.method !== "DELETE") return fail("METHOD_NOT_ALLOWED", "Use DELETE", 405);

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return fail("UNAUTHENTICATED", "Missing Authorization header", 401);
    const userClient = getUserClient(authHeader);
    const { data: userData, error: userError } = await userClient.auth.getUser();
    if (userError || !userData.user) return fail("UNAUTHENTICATED", "Invalid session", 401);

    const body = await req.json().catch(() => null) as Record<string, unknown> | null;
    const sessionId = optionalUuid(body?.session_id, "session_id");
    if (!sessionId) return fail("VALIDATION_ERROR", "session_id is required");

    const service = getServiceClient();
    const { data, error } = await service.from("anthropometric_sessions")
      .delete().eq("id", sessionId).eq("user_id", userData.user.id).select("id").maybeSingle();
    if (error) throw error;
    if (!data) return fail("NOT_FOUND", "Anthropometric session not found", 404);
    return ok({ deleted_session_id: sessionId });
  } catch (error) {
    if (error instanceof AnthropometryValidationError) {
      return fail(error.code, error.message);
    }
    console.error(error);
    return fail("INTERNAL_ERROR", "Unexpected error deleting anthropometric session", 500);
  }
});
