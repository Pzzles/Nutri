import { useState } from "react";
import { supabase } from "../lib/supabase";

type Phase = "idle" | "awaiting_otp" | "done" | "already_linked";

export default function AccountLink() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <div className="mx-auto max-w-md px-4 py-10">
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
    </div>
  );
}
