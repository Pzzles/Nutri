import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

type Phase = "idle" | "awaiting_otp" | "done" | "already_linked";
type DeletePhase = "idle" | "confirming" | "deleting" | "deleted";
type EquationSex = "male" | "female" | "";

interface HealthProfileForm {
  birthDate: string;
  equationSex: EquationSex;
  heightCm: string;
}

const EMPTY_HEALTH_PROFILE: HealthProfileForm = {
  birthDate: "",
  equationSex: "",
  heightCm: "",
};

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;

export default function AccountLink() {
  // ── Email-link flow ────────────────────────────────────────────────────────
  const [phase, setPhase] = useState<Phase>("idle");
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [healthProfile, setHealthProfile] = useState<HealthProfileForm>(EMPTY_HEALTH_PROFILE);
  const [profileLoading, setProfileLoading] = useState(true);
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [profileSaved, setProfileSaved] = useState(false);

  useEffect(() => {
    void loadHealthProfile();
  }, []);

  async function loadHealthProfile() {
    setProfileLoading(true);
    setProfileError(null);
    try {
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (userError) throw userError;
      if (!user) throw new Error("Not authenticated");

      const { data, error: fetchError } = await supabase
        .from("profiles")
        .select("birth_date, sex, height_cm")
        .eq("id", user.id)
        .maybeSingle();
      if (fetchError) throw fetchError;

      setHealthProfile({
        birthDate: data?.birth_date ?? "",
        equationSex: data?.sex === "male" || data?.sex === "female" ? data.sex : "",
        heightCm: data?.height_cm != null ? String(data.height_cm) : "",
      });
    } catch (err: any) {
      setProfileError(err.message ?? "Could not load your health profile.");
    } finally {
      setProfileLoading(false);
    }
  }

  async function handleSaveHealthProfile(e: React.FormEvent) {
    e.preventDefault();
    setProfileError(null);
    setProfileSaved(false);

    const heightCm = Number(healthProfile.heightCm);
    if (!healthProfile.birthDate || !healthProfile.equationSex || !healthProfile.heightCm) {
      setProfileError("Complete all three profile fields.");
      return;
    }
    if (!Number.isFinite(heightCm) || heightCm <= 0) {
      setProfileError("Height must be a positive number.");
      return;
    }

    const birthDate = new Date(`${healthProfile.birthDate}T12:00:00Z`);
    const today = new Date();
    let age = today.getUTCFullYear() - birthDate.getUTCFullYear();
    const birthdayPassed =
      today.getUTCMonth() > birthDate.getUTCMonth() ||
      (today.getUTCMonth() === birthDate.getUTCMonth() && today.getUTCDate() >= birthDate.getUTCDate());
    if (!birthdayPassed) age -= 1;
    if (Number.isNaN(birthDate.getTime()) || birthDate > today) {
      setProfileError("Enter a valid date of birth.");
      return;
    }
    if (age < 18) {
      setProfileError("Calorie target calculations are available for adults aged 18 or older.");
      return;
    }

    setProfileSaving(true);
    try {
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (userError) throw userError;
      if (!user) throw new Error("Not authenticated");

      const { error: saveError } = await supabase.from("profiles").upsert({
        id: user.id,
        birth_date: healthProfile.birthDate,
        sex: healthProfile.equationSex,
        height_cm: heightCm,
      }, { onConflict: "id" });
      if (saveError) throw saveError;
      setProfileSaved(true);
    } catch (err: any) {
      setProfileError(err.message ?? "Could not save your health profile.");
    } finally {
      setProfileSaving(false);
    }
  }

  // ── Export flow ────────────────────────────────────────────────────────────
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  // ── Delete-account flow ────────────────────────────────────────────────────
  const [deletePhase, setDeletePhase] = useState<DeletePhase>("idle");
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function handleRequestLink(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const { error: err } = await supabase.auth.updateUser({ email });
      if (err) {
        if (err.message.toLowerCase().includes("already")) {
          setPhase("already_linked");
          return;
        }
        throw err;
      }
      setPhase("awaiting_otp");
    } catch (err: any) {
      setError(err.message ?? "Could not send confirmation email.");
    } finally {
      setLoading(false);
    }
  }

  async function handleVerifyOtp(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const { error: err } = await supabase.auth.verifyOtp({
        email,
        token: otp.trim(),
        type: "email_change",
      });
      if (err) throw err;
      setPhase("done");
    } catch (err: any) {
      setError(err.message ?? "Verification failed.");
    } finally {
      setLoading(false);
    }
  }

  async function handleExport() {
    setExportError(null);
    setExporting(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) throw new Error("Not authenticated");

      const resp = await fetch(`${SUPABASE_URL}/functions/v1/export-my-data`, {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!resp.ok) {
        const json = await resp.json().catch(() => ({}));
        throw new Error((json as any)?.error?.message ?? "Export failed");
      }

      const blob = await resp.blob();
      const dateStr = new Date().toISOString().slice(0, 10);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `nutri-export-${dateStr}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      setExportError(err.message ?? "Export failed.");
    } finally {
      setExporting(false);
    }
  }

  async function handleDeleteAccount(e: React.FormEvent) {
    e.preventDefault();
    if (deleteConfirm !== "DELETE MY ACCOUNT") return;
    setDeleteError(null);
    setDeletePhase("deleting");
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) throw new Error("Not authenticated");

      const resp = await fetch(`${SUPABASE_URL}/functions/v1/delete-account`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ confirm: "DELETE MY ACCOUNT" }),
      });

      const json = await resp.json().catch(() => ({}));
      if (!resp.ok || !(json as any).success) {
        throw new Error((json as any)?.error?.message ?? "Deletion failed");
      }

      await supabase.auth.signOut();
      setDeletePhase("deleted");
    } catch (err: any) {
      setDeleteError(err.message ?? "Account deletion failed.");
      setDeletePhase("confirming");
    }
  }

  if (deletePhase === "deleted") {
    return (
      <div className="mx-auto max-w-md px-4 py-10">
        <div className="rounded-lg border border-border bg-surface px-4 py-6 text-center">
          <h1 className="font-display text-xl font-semibold text-ink">Account deleted</h1>
          <p className="mt-2 text-sm text-muted">
            Your account and all associated data have been permanently deleted.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-10 space-y-10">

      {/* ── Health profile section ───────────────────────────────────────────── */}
      <section className="rounded-xl border border-border bg-surface p-5 sm:p-6">
        <h1 className="font-display text-2xl font-semibold text-ink">Health profile</h1>
        <p className="mt-1 text-sm text-muted">
          These details are used to calculate calorie-target previews. Activity level and official
          weight are collected when you set a goal and log your weight.
        </p>

        {profileLoading ? (
          <p className="mt-6 text-sm text-muted">Loading profile…</p>
        ) : (
          <form onSubmit={handleSaveHealthProfile} className="mt-6 space-y-4">
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-ink">Date of birth</span>
              <input
                type="date"
                required
                value={healthProfile.birthDate}
                onChange={(e) => {
                  setHealthProfile((profile) => ({ ...profile, birthDate: e.target.value }));
                  setProfileSaved(false);
                }}
                className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink outline-none focus:ring-2 focus:ring-primary"
              />
            </label>

            <label className="block">
              <span className="mb-1 block text-sm font-medium text-ink">Sex used by the equation</span>
              <select
                required
                value={healthProfile.equationSex}
                onChange={(e) => {
                  setHealthProfile((profile) => ({ ...profile, equationSex: e.target.value as EquationSex }));
                  setProfileSaved(false);
                }}
                className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink outline-none focus:ring-2 focus:ring-primary"
              >
                <option value="">Select an option</option>
                <option value="female">Female</option>
                <option value="male">Male</option>
              </select>
              <span className="mt-1 block text-xs text-muted">
                The current calorie equation requires one of these two inputs.
              </span>
            </label>

            <label className="block">
              <span className="mb-1 block text-sm font-medium text-ink">Height (cm)</span>
              <input
                type="number"
                required
                min="1"
                step="0.1"
                inputMode="decimal"
                value={healthProfile.heightCm}
                onChange={(e) => {
                  setHealthProfile((profile) => ({ ...profile, heightCm: e.target.value }));
                  setProfileSaved(false);
                }}
                placeholder="175"
                className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink outline-none focus:ring-2 focus:ring-primary"
              />
            </label>

            <div className="flex items-center gap-3">
              <button
                type="submit"
                disabled={profileSaving}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-dark disabled:opacity-50"
              >
                {profileSaving ? "Saving…" : "Save profile"}
              </button>
              {profileSaved && <span className="text-sm text-confidence-high">Profile saved.</span>}
            </div>
            {profileError && <p role="alert" className="text-sm text-confidence-low">{profileError}</p>}
          </form>
        )}
      </section>

      {/* ── Email-link section ─────────────────────────────────────────────── */}
      <section>
        <h1 className="font-display text-2xl font-semibold text-ink">Save your account</h1>
        <p className="mt-1 text-sm text-muted">
          Your data is tied to this device. Add an email so you can sign in on any device and
          never lose your history.
        </p>

        {phase === "idle" && (
          <form onSubmit={handleRequestLink} className="mt-6 space-y-4">
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary"
            />
            <button
              type="submit"
              disabled={loading}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-dark disabled:opacity-50"
            >
              {loading ? "Sending…" : "Send confirmation code"}
            </button>
            {error && <p className="text-sm text-confidence-low">{error}</p>}
          </form>
        )}

        {phase === "awaiting_otp" && (
          <form onSubmit={handleVerifyOtp} className="mt-6 space-y-4">
            <p className="text-sm text-muted">
              A 6-digit code was sent to <strong>{email}</strong>. Enter it below.
            </p>
            <input
              type="text"
              inputMode="numeric"
              required
              maxLength={6}
              value={otp}
              onChange={(e) => setOtp(e.target.value)}
              placeholder="123456"
              className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary"
            />
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={loading}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-dark disabled:opacity-50"
              >
                {loading ? "Verifying…" : "Verify code"}
              </button>
              <button
                type="button"
                onClick={() => setPhase("idle")}
                className="rounded-lg border border-border px-4 py-2 text-sm text-muted"
              >
                Change email
              </button>
            </div>
            {error && <p className="text-sm text-confidence-low">{error}</p>}
          </form>
        )}

        {phase === "done" && (
          <div className="mt-6 rounded-lg bg-primary-light px-4 py-3 text-sm text-primary-dark">
            Account saved. You can now sign in with <strong>{email}</strong> on any device.
          </div>
        )}

        {phase === "already_linked" && (
          <div className="mt-6 rounded-lg bg-primary-light px-4 py-3 text-sm text-primary-dark">
            This account is already linked to an email address.
          </div>
        )}
      </section>

      <hr className="border-border" />

      {/* ── Data export section ────────────────────────────────────────────── */}
      <section>
        <h2 className="font-display text-lg font-semibold text-ink">Export your data</h2>
        <p className="mt-1 text-sm text-muted">
          Download a copy of all your personal data as a JSON file. This includes your
          weight logs, meals, goal phases, and all other records.
        </p>
        <button
          type="button"
          onClick={handleExport}
          disabled={exporting}
          className="mt-4 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-dark disabled:opacity-50"
        >
          {exporting ? "Preparing export…" : "Download my data"}
        </button>
        {exportError && <p className="mt-2 text-sm text-confidence-low">{exportError}</p>}
      </section>

      <hr className="border-border" />

      {/* ── Delete account section ─────────────────────────────────────────── */}
      <section>
        <h2 className="font-display text-lg font-semibold text-ink">Delete account</h2>
        <p className="mt-1 text-sm text-muted">
          Permanently delete your account and all associated data. This action cannot be undone.
        </p>

        {deletePhase === "idle" && (
          <button
            type="button"
            onClick={() => setDeletePhase("confirming")}
            className="mt-4 rounded-lg border border-confidence-low px-4 py-2 text-sm font-medium text-confidence-low hover:bg-red-50"
          >
            Delete my account
          </button>
        )}

        {deletePhase === "confirming" && (
          <form onSubmit={handleDeleteAccount} className="mt-4 space-y-3">
            <p className="text-sm text-muted">
              Type <strong>DELETE MY ACCOUNT</strong> to confirm.
            </p>
            <input
              type="text"
              required
              value={deleteConfirm}
              onChange={(e) => setDeleteConfirm(e.target.value)}
              placeholder="DELETE MY ACCOUNT"
              className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-confidence-low"
            />
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={deleteConfirm !== "DELETE MY ACCOUNT"}
                className="rounded-lg bg-confidence-low px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-40"
              >
                Permanently delete
              </button>
              <button
                type="button"
                onClick={() => { setDeletePhase("idle"); setDeleteConfirm(""); setDeleteError(null); }}
                className="rounded-lg border border-border px-4 py-2 text-sm text-muted"
              >
                Cancel
              </button>
            </div>
            {deleteError && <p className="text-sm text-confidence-low">{deleteError}</p>}
          </form>
        )}

        {deletePhase === "deleting" && (
          <p className="mt-4 text-sm text-muted">Deleting your account…</p>
        )}
      </section>
    </div>
  );
}
