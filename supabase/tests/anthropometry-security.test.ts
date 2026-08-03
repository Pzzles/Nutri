import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  ANON_KEY,
  SUPABASE_URL,
  anonClient,
  createTestUser,
  deleteTestUser,
  signInAs,
  svcClient,
  testEmail,
} from "./helpers.js";

const EMAIL_A = testEmail("anthropometry-security-a");
const EMAIL_B = testEmail("anthropometry-security-b");
let userA = "";
let userB = "";
let tokenA = "";
let tokenB = "";
let clientA: SupabaseClient;
let clientB: SupabaseClient;
let sessionA = "";
let sessionB = "";
let readingA = "";

async function finalize(token: string, key: string, site: string): Promise<string> {
  const response = await fetch(`${SUPABASE_URL}/functions/v1/finalize-anthropometric-session`, {
    method: "POST",
    headers: {
      apikey: ANON_KEY,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      measured_at: "2026-08-01T06:00:00.000Z",
      protocol_version: "anthropometry_protocol_v1",
      idempotency_key: key,
      sites: [{ site_code: site, readings_cm: [80, 80.4] }],
    }),
  });
  const body = await response.json();
  if (response.status !== 201) throw new Error(`Fixture finalisation failed: ${response.status}`);
  return body.data.session.id as string;
}

beforeAll(async () => {
  userA = await createTestUser(EMAIL_A);
  userB = await createTestUser(EMAIL_B);
  ({ client: clientA } = await signInAs(EMAIL_A));
  ({ client: clientB } = await signInAs(EMAIL_B));
  tokenA = (await clientA.auth.getSession()).data.session!.access_token;
  tokenB = (await clientB.auth.getSession()).data.session!.access_token;
  sessionA = await finalize(tokenA, `security-a-${Date.now()}`, "waist");
  sessionB = await finalize(tokenB, `security-b-${Date.now()}`, "hips");
  readingA = (await svcClient().from("anthropometric_readings")
    .select("id").eq("user_id", userA).eq("session_id", sessionA).limit(1).single()).data!.id;
});

afterAll(async () => {
  await deleteTestUser(userA);
  await deleteTestUser(userB);
});

describe("direct owner-scoped reads", () => {
  it("allows an authenticated owner to select all three record types", async () => {
    const [sessions, readings, representatives] = await Promise.all([
      clientA.from("anthropometric_sessions").select("id").eq("id", sessionA),
      clientA.from("anthropometric_readings").select("id").eq("session_id", sessionA),
      clientA.from("anthropometric_representatives").select("site_code").eq("session_id", sessionA),
    ]);
    expect(sessions.error).toBeNull();
    expect(readings.error).toBeNull();
    expect(representatives.error).toBeNull();
    expect(sessions.data).toHaveLength(1);
    expect(readings.data).toHaveLength(2);
    expect(representatives.data).toHaveLength(1);
  });

  it("directly hides every child and parent row from a different user", async () => {
    const [sessions, readings, representatives] = await Promise.all([
      clientB.from("anthropometric_sessions").select("id").eq("id", sessionA),
      clientB.from("anthropometric_readings").select("id").eq("session_id", sessionA),
      clientB.from("anthropometric_representatives").select("site_code").eq("session_id", sessionA),
    ]);
    expect(sessions.data).toEqual([]);
    expect(readings.data).toEqual([]);
    expect(representatives.data).toEqual([]);
  });
});

describe("frozen direct mutation privileges", () => {
  it("rejects authenticated INSERT on sessions, readings, and representatives", async () => {
    const [session, reading, representative] = await Promise.all([
      clientA.from("anthropometric_sessions").insert({ user_id: userA, status: "draft" }),
      clientA.from("anthropometric_readings").insert({
        session_id: sessionB,
        user_id: userB,
        site_code: "hips",
        reading_number: 3,
        value_cm: 80.5,
      }),
      clientA.from("anthropometric_representatives").insert({
        session_id: sessionB,
        user_id: userB,
        site_code: "hips",
      }),
    ]);
    expect(session.error).toBeTruthy();
    expect(reading.error).toBeTruthy();
    expect(representative.error).toBeTruthy();
  });

  it("rejects authenticated UPDATE on sessions, readings, and representatives", async () => {
    const [session, reading, representative] = await Promise.all([
      clientA.from("anthropometric_sessions").update({ notes: "forbidden" }).eq("id", sessionB),
      clientA.from("anthropometric_readings").update({ value_cm: 81 }).eq("session_id", sessionB),
      clientA.from("anthropometric_representatives").update({ representative_cm: 81 })
        .eq("session_id", sessionB),
    ]);
    expect(session.error).toBeTruthy();
    expect(reading.error).toBeTruthy();
    expect(representative.error).toBeTruthy();
  });

  it("rejects authenticated DELETE on sessions, readings, and representatives", async () => {
    const [session, reading, representative] = await Promise.all([
      clientA.from("anthropometric_sessions").delete().eq("id", sessionB),
      clientA.from("anthropometric_readings").delete().eq("session_id", sessionB),
      clientA.from("anthropometric_representatives").delete().eq("session_id", sessionB),
    ]);
    expect(session.error).toBeTruthy();
    expect(reading.error).toBeTruthy();
    expect(representative.error).toBeTruthy();
  });

  it("leaves another user's complete graph unchanged after all attempts", async () => {
    const service = svcClient();
    const [session, readings, representatives] = await Promise.all([
      service.from("anthropometric_sessions").select("id").eq("id", sessionB),
      service.from("anthropometric_readings").select("id").eq("user_id", userB)
        .eq("session_id", sessionB),
      service.from("anthropometric_representatives").select("site_code").eq("user_id", userB)
        .eq("session_id", sessionB),
    ]);
    expect(session.data).toHaveLength(1);
    expect(readings.data).toHaveLength(2);
    expect(representatives.data).toHaveLength(1);
  });
});

describe("anonymous operation coverage", () => {
  it.each(["anthropometric_sessions", "anthropometric_readings", "anthropometric_representatives"])(
    "rejects anonymous SELECT, INSERT, UPDATE, and DELETE on %s",
    async (table) => {
      const anon = anonClient();
      const select = await anon.from(table).select("*").limit(1);
      const insert = await anon.from(table).insert({});
      const update = await anon.from(table).update({}).eq("id", crypto.randomUUID());
      const deletion = await anon.from(table).delete().eq("id", crypto.randomUUID());
      expect(select.error).toBeTruthy();
      expect(insert.error).toBeTruthy();
      expect(update.error).toBeTruthy();
      expect(deletion.error).toBeTruthy();
    },
  );
});

describe("composite owner constraint", () => {
  it("rejects a privileged child insert whose owner differs from its parent", async () => {
    const { error } = await svcClient().from("anthropometric_readings").insert({
      session_id: sessionB,
      user_id: userA,
      site_code: "hips",
      reading_number: 3,
      value_cm: 80.5,
    });
    expect(error).toBeTruthy();
    expect(error!.message).toContain("ANTHROPOMETRIC_CHILD_OWNER_MISMATCH");
  });

  it("rejects privileged updates that try to move a child to another owner", async () => {
    const { error } = await svcClient().from("anthropometric_readings")
      .update({ user_id: userB }).eq("id", readingA);
    expect(error).toBeTruthy();
  });
});
