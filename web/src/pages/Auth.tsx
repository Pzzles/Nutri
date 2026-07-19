import { useState } from "react";
import { supabase } from "../lib/supabase";

export default function Auth() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const { error } = await supabase.auth.signInWithOtp({ email });
    if (error) setError(error.message);
    else setSent(true);
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <h1 className="font-display text-2xl font-semibold text-ink">Nutrition Tracker</h1>
        <p className="mt-1 text-sm text-muted">Sign in with a magic link — no password needed.</p>

        {sent ? (
          <p className="mt-6 rounded-lg bg-primary-light px-4 py-3 text-sm text-primary-dark">
            Check your email for a sign-in link.
          </p>
        ) : (
          <form onSubmit={handleSubmit} className="mt-6 space-y-3">
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
              className="w-full rounded-lg bg-primary px-3 py-2 text-sm font-medium text-white hover:bg-primary-dark"
            >
              Send magic link
            </button>
            {error && <p className="text-sm text-confidence-low">{error}</p>}
          </form>
        )}
      </div>
    </div>
  );
}
