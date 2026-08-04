import assert from "node:assert/strict";
import test from "node:test";
import {
  analyzeDeploymentState,
  parseMigrationLedger,
  resolveLinkedProjectRef,
} from "./deployment-preflight.mjs";
import {
  isLoopbackUrl,
  parseLocalSupabaseStatus,
} from "../web/scripts/start-local-dev.mjs";

test("parses the Supabase migration ledger without inventing missing versions", () => {
  const ledger = parseMigrationLedger(JSON.stringify({ migrations: [
    { local: "0032", remote: "0032" },
    { local: "0033", remote: "" },
  ] }));
  assert.deepEqual(ledger, [
    { local: "0032", remote: "0032" },
    { local: "0033", remote: null },
  ]);
});

test("reports migration and function drift independently", () => {
  const state = analyzeDeploymentState(
    ["0032", "0033"],
    [{ local: "0032", remote: "0032" }, { local: "0033", remote: null }],
    ["existing", "missing"],
    ["existing"],
  );
  assert.deepEqual(state, {
    pendingMigrations: ["0033"],
    remoteOnlyMigrations: [],
    missingFromLedger: [],
    missingFunctions: ["missing"],
  });
});

test("requires migration and function checks to use the same linked project", () => {
  const projectRef = "abcdefghijklmnopqrst";
  assert.equal(resolveLinkedProjectRef(null, `${projectRef}\n`), projectRef);
  assert.equal(resolveLinkedProjectRef(projectRef, projectRef), projectRef);
  assert.throws(
    () => resolveLinkedProjectRef("zyxwvutsrqponmlkjihg", projectRef),
    /does not match/,
  );
});

test("accepts only loopback Supabase URLs for the default development command", () => {
  assert.equal(isLoopbackUrl("http://127.0.0.1:54321"), true);
  assert.equal(isLoopbackUrl("http://localhost:54321"), true);
  assert.equal(isLoopbackUrl("https://project.supabase.co"), false);
  assert.deepEqual(
    parseLocalSupabaseStatus(JSON.stringify({ API_URL: "http://127.0.0.1:54321", ANON_KEY: "local-key" })),
    { url: "http://127.0.0.1:54321", anonKey: "local-key" },
  );
  assert.throws(() => parseLocalSupabaseStatus(JSON.stringify({
    API_URL: "https://project.supabase.co",
    ANON_KEY: "remote-key",
  })));
});
