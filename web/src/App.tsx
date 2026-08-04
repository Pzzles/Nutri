import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { BrowserRouter, Routes, Route, Link, Navigate, useLocation } from "react-router-dom";
import { supabase } from "./lib/supabase";
import Auth from "./pages/Auth";
import Log from "./pages/Log";
import Progress from "./pages/Progress";
import Dashboard from "./pages/Dashboard";
import LogMeal from "./pages/LogMeal";
import SearchFood from "./pages/SearchFood";
import AccountLink from "./pages/AccountLink";
import Goals from "./pages/Goals";
import WeightLogPage from "./pages/WeightLog";
import MealHistory from "./pages/MealHistory";
import Measurements from "./pages/Measurements";

export default function App() {
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [accountDeleted, setAccountDeleted] = useState(false);
  const [darkMode, setDarkMode] = useState(() => {
    const saved = localStorage.getItem("theme");
    return saved ? saved === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches;
  });

  useEffect(() => {
    document.documentElement.classList.toggle("dark", darkMode);
    localStorage.setItem("theme", darkMode ? "dark" : "light");
  }, [darkMode]);

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setReady(true);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setReady(true);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  if (!ready) {
    return (
      <div className="grid min-h-screen place-items-center text-sm text-muted">
        Loading…
      </div>
    );
  }

  if (accountDeleted) {
    return (
      <main className="grid min-h-screen place-items-center px-4">
        <section className="w-full max-w-md rounded-lg border border-border bg-surface px-4 py-6 text-center" aria-labelledby="account-deleted-heading">
          <h1 id="account-deleted-heading" className="font-display text-xl font-semibold text-ink">Account deleted</h1>
          <p className="mt-2 text-sm text-muted">Your account and all associated data have been permanently deleted.</p>
        </section>
      </main>
    );
  }

  if (!session) return <Auth />;

  return (
    <BrowserRouter>
      <div className="min-h-screen">
        <NavBar darkMode={darkMode} onToggleTheme={() => setDarkMode((value) => !value)} />
        <Routes>
          {/* Primary nav routes */}
          <Route path="/" element={<Dashboard />} />
          <Route path="/log" element={<Log />} />
          <Route path="/progress" element={<Progress />} />
          <Route path="/account" element={<AccountLink onAccountDeleted={() => setAccountDeleted(true)} />} />

          {/* Deep-link routes — not in nav, still accessible */}
          <Route path="/history" element={<MealHistory />} />
          <Route path="/search" element={<SearchFood />} />
          <Route path="/goals" element={<Goals />} />
          <Route path="/weight" element={<WeightLogPage />} />
          <Route path="/measurements" element={<Measurements />} />
          <Route path="/auth" element={<Navigate to="/" replace />} />

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
    </BrowserRouter>
  );
}

function NavBar({ darkMode, onToggleTheme }: { darkMode: boolean; onToggleTheme: () => void }) {
  const location = useLocation();
  const isActive = (path: string) => location.pathname === path;

  return (
    <nav className="flex items-center justify-between gap-2 border-b border-border bg-surface px-3 py-3 sm:px-4">
      <span className="shrink-0 font-display text-sm font-semibold text-ink">
        <span className="sm:hidden">Nutri</span>
        <span className="hidden sm:inline">Nutrition Tracker</span>
      </span>
      <div className="flex min-w-0 items-center gap-0.5 overflow-x-auto sm:gap-1">
        <NavLink to="/" label="Dashboard" active={isActive("/")} />
        <NavLink to="/log" label="Log" active={isActive("/log")} />
        <NavLink to="/progress" label="Progress" active={isActive("/progress")} />
        <NavLink to="/account" label="Account" active={isActive("/account")} />
        <button
          type="button"
          onClick={onToggleTheme}
          className="ml-1 grid h-8 w-8 place-items-center rounded-full border border-border text-muted transition-colors hover:border-primary hover:text-primary"
          aria-label={`Switch to ${darkMode ? "light" : "dark"} mode`}
          title={`Switch to ${darkMode ? "light" : "dark"} mode`}
        >
          {darkMode ? (
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <circle cx="12" cy="12" r="4" />
              <path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.42-1.42M17.66 6.34l1.41-1.41" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z" />
            </svg>
          )}
        </button>
      </div>
    </nav>
  );
}

function NavLink({ to, label, active }: { to: string; label: string; active: boolean }) {
  return (
    <Link
      to={to}
      className={`shrink-0 rounded-full px-2 py-1.5 text-xs transition-colors sm:px-3 sm:text-sm ${
        active ? "bg-primary text-white" : "text-muted hover:text-ink"
      }`}
    >
      {label}
    </Link>
  );
}
