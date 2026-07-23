// Integration tests for fn_set_daily_log_status and daily_log_status table.
// Requires: supabase start (migration 0009 applied)
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestUser, signInAs, deleteTestUser, svcClient, testEmail } from "./helpers.js";

const EMAIL_A = testEmail("dls-a");
const EMAIL_B = testEmail("dls-b");
let userA = "";
let userB = "";
let authedA: Awaited<ReturnType<typeof signInAs>>["client"];

async function setStatus(userId: string, date: string, status: string) {
  return svcClient().rpc("fn_set_daily_log_status", {
    p_user_id: userId,
    p_date: date,
    p_status: status,
  });
}

async function getRow(userId: string, date: string) {
  const { data } = await svcClient()
    .from("daily_log_status")
    .select("*")
    .eq("user_id", userId)
    .eq("logged_date", date)
    .maybeSingle();
  return data;
}

async function cleanupStatus(userId: string) {
  await svcClient().from("daily_log_status").delete().eq("user_id", userId);
}

beforeAll(async () => {
  userA = await createTestUser(EMAIL_A);
  userB = await createTestUser(EMAIL_B);
  ({ client: authedA } = await signInAs(EMAIL_A));
  await cleanupStatus(userA);
  await cleanupStatus(userB);
});

afterAll(async () => {
  await cleanupStatus(userA);
  await cleanupStatus(userB);
  await deleteTestUser(userA);
  await deleteTestUser(userB);
});

// ── Basic status transitions ───────────────────────────────────────────────────

describe("fn_set_daily_log_status — basic transitions", () => {
  const DATE = "2026-07-23";

  it("creates a 'complete' row with marked_complete_at set", async () => {
    const { data, error } = await setStatus(userA, DATE, "complete");
    expect(error).toBeNull();
    expect(data).toBeTruthy();
    expect(data.status).toBe("complete");
    expect(data.marked_complete_at).toBeTruthy();
    expect(data.reopened_at).toBeNull();
  });

  it("preserves marked_complete_at when reopened to partial", async () => {
    const before = await getRow(userA, DATE);
    const originalCompletedAt = before?.marked_complete_at;
    expect(originalCompletedAt).toBeTruthy();

    const { data, error } = await setStatus(userA, DATE, "partial");
    expect(error).toBeNull();
    expect(data.status).toBe("partial");
    expect(data.marked_complete_at).toBe(originalCompletedAt);
    expect(data.reopened_at).toBeTruthy();
  });

  it("can mark complete again after re-opening; stamps a new marked_complete_at", async () => {
    const before = await getRow(userA, DATE);
    const firstCompletedAt = before?.marked_complete_at;

    // Short sleep to ensure timestamps differ.
    await new Promise((r) => setTimeout(r, 10));

    const { data, error } = await setStatus(userA, DATE, "complete");
    expect(error).toBeNull();
    expect(data.status).toBe("complete");
    // marked_complete_at should be updated to a new timestamp.
    expect(data.marked_complete_at).not.toBe(firstCompletedAt);
  });

  it("transition to unknown preserves marked_complete_at audit trail", async () => {
    const { data, error } = await setStatus(userA, DATE, "unknown");
    expect(error).toBeNull();
    expect(data.status).toBe("unknown");
    expect(data.marked_complete_at).toBeTruthy(); // preserved
  });
});

// ── Idempotency ────────────────────────────────────────────────────────────────

describe("fn_set_daily_log_status — idempotency", () => {
  const DATE = "2026-07-24";

  it("calling complete twice returns the same status", async () => {
    await setStatus(userA, DATE, "complete");
    const { data } = await setStatus(userA, DATE, "complete");
    expect(data.status).toBe("complete");
  });

  it("calling partial twice is idempotent", async () => {
    await setStatus(userA, DATE, "partial");
    const { data } = await setStatus(userA, DATE, "partial");
    expect(data.status).toBe("partial");
  });
});

// ── Constraint: marked_complete_at required for complete ──────────────────────

describe("fn_set_daily_log_status — DB constraint on complete", () => {
  it("direct insert of status=complete without marked_complete_at fails", async () => {
    const { error } = await svcClient().from("daily_log_status").insert({
      user_id: userA,
      logged_date: "2026-07-30",
      status: "complete",
      marked_complete_at: null,
    });
    expect(error).toBeTruthy();
  });
});

// ── Unique constraint per user+date ───────────────────────────────────────────

describe("daily_log_status — unique per user+date", () => {
  const DATE = "2026-07-25";

  it("upsert does not create duplicate rows", async () => {
    await setStatus(userA, DATE, "partial");
    await setStatus(userA, DATE, "complete");

    const { data } = await svcClient()
      .from("daily_log_status")
      .select("id")
      .eq("user_id", userA)
      .eq("logged_date", DATE);

    expect(data).toHaveLength(1);
  });
});

// ── Invalid status value ───────────────────────────────────────────────────────

describe("fn_set_daily_log_status — invalid input", () => {
  it("rejects an unknown status string", async () => {
    const { error } = await setStatus(userA, "2026-07-26", "done");
    expect(error).toBeTruthy();
  });
});

// ── RLS isolation ─────────────────────────────────────────────────────────────

describe("daily_log_status RLS", () => {
  const DATE_B = "2026-07-27";

  it("user A cannot read user B's daily log status", async () => {
    await setStatus(userB, DATE_B, "complete");

    const { data } = await authedA
      .from("daily_log_status")
      .select("id")
      .eq("user_id", userB)
      .eq("logged_date", DATE_B);

    expect(data).toHaveLength(0);
  });

  it("user A cannot insert a row for user B", async () => {
    const { error } = await authedA.from("daily_log_status").insert({
      user_id: userB,
      logged_date: "2026-07-28",
      status: "partial",
    });
    expect(error).toBeTruthy();
  });

  it("user A can read their own rows", async () => {
    const myDate = "2026-07-29";
    await setStatus(userA, myDate, "partial");

    const { data } = await authedA
      .from("daily_log_status")
      .select("id, status")
      .eq("logged_date", myDate);

    expect(data).toHaveLength(1);
    expect(data![0].status).toBe("partial");
  });
});
