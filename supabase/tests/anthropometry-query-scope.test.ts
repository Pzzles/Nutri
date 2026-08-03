import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function source(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), "..", "functions", relativePath), "utf8");
}

describe("privileged anthropometry query ownership audit", () => {
  it("scopes saved-session parent and both child loads by authenticated owner", () => {
    const handler = source("_handlers/anthropometricSession.ts");
    expect(handler).toContain("async function loadOwnedSession(");
    expect(handler).toContain("authenticatedUserId: string");
    expect(handler.match(/\.eq\("user_id", authenticatedUserId\)/g)).toHaveLength(3);
    expect(handler).toContain("const saved = await loadOwnedSession(service, userId, result.session_id)");
  });

  it("scopes history, progress, deletion, and export children by authenticated owner", () => {
    const history = source("get-anthropometric-sessions/index.ts");
    expect(history).toContain('.eq("user_id", userData.user.id).in("session_id", ids)');
    expect(history).toContain('.eq("anthropometric_representatives.user_id", userData.user.id)');

    const progress = source("get-anthropometric-progress/index.ts");
    expect(progress).toContain('.eq("anthropometric_representatives.user_id", userId)');
    expect(progress).toContain('.eq("anthropometric_readings.user_id", userId)');

    const deletion = source("delete-anthropometric-session/index.ts");
    expect(deletion).toContain('service.rpc("fn_delete_anthropometric_session"');
    expect(deletion).toContain("p_user_id: userData.user.id");

    const exportHandler = source("export-my-data/index.ts");
    expect(exportHandler.match(/\.eq\("user_id", userId\)/g)?.length).toBeGreaterThanOrEqual(10);
    expect(exportHandler).toContain('svc.from("anthropometric_readings").select("*")');
    expect(exportHandler).toContain('svc.from("anthropometric_representatives").select("*")');
  });
});

describe("privacy-safe structured logging audit", () => {
  it("does not put measurements, notes, credentials, emails, or raw errors in audited logs", () => {
    const audited = [
      "_handlers/anthropometricSession.ts",
      "get-anthropometric-sessions/index.ts",
      "get-anthropometric-progress/index.ts",
      "delete-anthropometric-session/index.ts",
      "delete-account/index.ts",
    ].map(source).join("\n");

    const logStatements = audited.match(/console\.(?:log|error)\([\s\S]*?\);/g) ?? [];
    expect(logStatements.length).toBeGreaterThan(0);
    for (const statement of logStatements) {
      expect(statement).not.toMatch(
        /value_cm|representative_cm|raw_readings|notes|authorization|jwt|service_role|email/i,
      );
      expect(statement).not.toMatch(/console\.error\((?:error|_error|rpcError)\)/);
    }
  });
});
