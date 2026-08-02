/** Saves a draft, or finalizes when status is explicitly finalized. */
import { handleAnthropometricSessionSave } from "../_handlers/anthropometricSession.ts";

Deno.serve((req) => handleAnthropometricSessionSave(req));
