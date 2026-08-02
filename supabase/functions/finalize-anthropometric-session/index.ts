/** Frozen Phase 10 finalization contract: status is server-selected. */
import { handleAnthropometricSessionSave } from "../_handlers/anthropometricSession.ts";

Deno.serve((req) => handleAnthropometricSessionSave(req, "finalized"));
