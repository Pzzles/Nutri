// Authenticated, retry-safe account deletion.
//
// The only destructive operation is Supabase Auth's hard user deletion.
// profiles.id references auth.users(id) ON DELETE CASCADE, and every private
// application root is connected to profiles with cascading foreign keys.
// PostgreSQL therefore deletes Auth plus application data in one transaction:
// either every cascade commits, or the Auth user and all private rows remain.

import { ok, fail, preflight } from "../_shared/envelope.ts";
import { getUserClient, getServiceClient } from "../_shared/supabaseClient.ts";

function authUserAlreadyGone(error: { status?: number; code?: string; message?: string }): boolean {
  const code = error.code?.toLowerCase() ?? "";
  const message = error.message?.toLowerCase() ?? "";
  return error.status === 404 || code === "user_not_found" || message.includes("user not found");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return preflight();
  if (req.method !== "POST" && req.method !== "DELETE") {
    return fail("METHOD_NOT_ALLOWED", "Use POST or DELETE to delete your account", 405);
  }

  const startedAt = Date.now();
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return fail("UNAUTHENTICATED", "Missing Authorization header", 401);

    const userClient = getUserClient(authHeader);
    const { data: userData, error: userError } = await userClient.auth.getUser();
    if (userError || !userData?.user) return fail("UNAUTHENTICATED", "Invalid session", 401);
    const userId = userData.user.id;

    const body: Record<string, unknown> = await req.json().catch(() => ({}));
    if (Object.keys(body).some((key) => key !== "confirm")) {
      return fail("FORBIDDEN_FIELD", "Account deletion does not accept a target user ID", 422);
    }
    if (body.confirm !== "DELETE MY ACCOUNT") {
      return fail(
        "CONFIRMATION_REQUIRED",
        'Supply { "confirm": "DELETE MY ACCOUNT" } to confirm permanent deletion.',
        400,
      );
    }

    const service = getServiceClient();
    const { error: deletionError } = await service.auth.admin.deleteUser(userId, false);
    if (deletionError && !authUserAlreadyGone(deletionError)) {
      console.error(JSON.stringify({
        event: "account_deletion_failed",
        user_id_prefix: userId.slice(0, 8),
        status: "retry_required",
        error_code: "AUTH_DELETE_TRANSACTION_FAILED",
        duration_ms: Date.now() - startedAt,
      }));
      return fail(
        "ACCOUNT_DELETION_RETRY_REQUIRED",
        "Account deletion could not complete. Your account and data remain; retry safely.",
        503,
      );
    }

    console.log(JSON.stringify({
      event: "account_deletion_complete",
      user_id_prefix: userId.slice(0, 8),
      status: "complete",
      duration_ms: Date.now() - startedAt,
    }));
    return ok({ status: "ACCOUNT_DELETION_COMPLETE", deleted: true });
  } catch (_error) {
    console.error(JSON.stringify({
      event: "account_deletion_failed",
      status: "retry_required",
      error_code: "UNEXPECTED_ERROR",
      duration_ms: Date.now() - startedAt,
    }));
    return fail(
      "ACCOUNT_DELETION_RETRY_REQUIRED",
      "Account deletion could not complete. Retry safely.",
      503,
    );
  }
});
