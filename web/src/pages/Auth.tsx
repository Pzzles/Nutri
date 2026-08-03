import { useState } from "react";
import { supabase } from "../lib/supabase";
import {
  TEST_PERSONAS,
  TEST_PERSONA_CONFIGURATION_ERROR,
} from "../lib/testPersonas";

type AuthMode = "sign_in" | "sign_up";

export default function Auth() {
  const [mode, setMode] = useState<AuthMode>("sign_in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [selectedPersonaId, setSelectedPersonaId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handlePersonaSelect(personaId: string) {
    setSelectedPersonaId(personaId);
    setError(null);
    if (!personaId) return;

    const persona = TEST_PERSONAS.find((candidate) => candidate.id === personaId);
    if (!persona) {
      setError("That test persona is not configured.");
      return;
    }

    const previousLocation = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    setLoading(true);
    window.history.replaceState(null, "", "/progress?tab=maintenance");

    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: persona.email,
        password: persona.password,
      });
      if (signInError) throw signInError;
    } catch (err: unknown) {
      window.history.replaceState(null, "", previousLocation);
      setSelectedPersonaId("");
      setError(err instanceof Error ? err.message : "Test persona sign-in failed.");
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (mode === "sign_up" && password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setLoading(true);
    try {
      if (mode === "sign_in") {
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (signInError) throw signInError;
        return;
      }

      const { data, error: signUpError } = await supabase.auth.signUp({
        email: email.trim(),
        password,
      });
      if (signUpError) throw signUpError;
      if (!data.session) {
        throw new Error(
          "Your account was created, but Supabase is still requiring email confirmation. Disable Confirm Email for this early-access flow.",
        );
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Authentication failed.");
    } finally {
      setLoading(false);
    }
  }

  function switchMode(nextMode: AuthMode) {
    setMode(nextMode);
    setPassword("");
    setConfirmPassword("");
    setError(null);
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-xl border border-border bg-surface p-6 shadow-sm">
        <h1 className="font-display text-2xl font-semibold text-ink">Nutrition Tracker</h1>
        <p className="mt-1 text-sm text-muted">
          {mode === "sign_in" ? "Sign in to continue." : "Create an account with email and password."}
        </p>

        <div className="mt-6 grid grid-cols-2 rounded-lg bg-background p-1">
          <button
            type="button"
            onClick={() => switchMode("sign_in")}
            className={`rounded-md px-3 py-2 text-sm font-medium ${
              mode === "sign_in" ? "bg-surface text-ink shadow-sm" : "text-muted"
            }`}
          >
            Sign in
          </button>
          <button
            type="button"
            onClick={() => switchMode("sign_up")}
            className={`rounded-md px-3 py-2 text-sm font-medium ${
              mode === "sign_up" ? "bg-surface text-ink shadow-sm" : "text-muted"
            }`}
          >
            Create account
          </button>
        </div>

        {mode === "sign_in" && TEST_PERSONAS.length > 0 && (
          <div className="mt-5 rounded-lg border border-primary/30 bg-primary/5 p-3">
            <label htmlFor="test-persona" className="block text-sm font-medium text-ink">
              Test persona (development only)
            </label>
            <p className="mt-1 text-xs text-muted">
              Selecting a persona signs in immediately and opens Progress → Maintenance.
            </p>
            <select
              id="test-persona"
              value={selectedPersonaId}
              disabled={loading}
              onChange={(event) => void handlePersonaSelect(event.target.value)}
              className="mt-3 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink outline-none focus:ring-2 focus:ring-primary disabled:opacity-50"
            >
              <option value="">{loading ? "Signing in…" : "Choose a test persona"}</option>
              {TEST_PERSONAS.map((persona) => (
                <option key={persona.id} value={persona.id}>
                  {persona.label}
                </option>
              ))}
            </select>
          </div>
        )}

        {mode === "sign_in" && TEST_PERSONA_CONFIGURATION_ERROR && (
          <p role="alert" className="mt-4 text-sm text-confidence-low">
            Test persona setup is incomplete. Run the authenticated persona seed command again.
          </p>
        )}

        <form onSubmit={handleSubmit} className="mt-5 space-y-4">
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-ink">Email</span>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
              className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink outline-none focus:ring-2 focus:ring-primary"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-sm font-medium text-ink">Password</span>
            <input
              type="password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === "sign_in" ? "current-password" : "new-password"}
              className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink outline-none focus:ring-2 focus:ring-primary"
            />
          </label>

          {mode === "sign_up" && (
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-ink">Confirm password</span>
              <input
                type="password"
                required
                minLength={8}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                autoComplete="new-password"
                className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink outline-none focus:ring-2 focus:ring-primary"
              />
            </label>
          )}

          {mode === "sign_up" && (
            <p className="text-xs text-muted">
              Email verification is temporarily disabled. No confirmation message will be sent.
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-primary px-3 py-2 text-sm font-medium text-white hover:bg-primary-dark disabled:opacity-50"
          >
            {loading ? "Please wait…" : mode === "sign_in" ? "Sign in" : "Create account"}
          </button>
          {error && <p role="alert" className="text-sm text-confidence-low">{error}</p>}
        </form>
      </div>
    </div>
  );
}
