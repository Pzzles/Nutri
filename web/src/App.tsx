import { useEffect, useState } from "react";
import { BrowserRouter, Routes, Route, Link, Navigate, useLocation } from "react-router-dom";
import { supabase } from "./lib/supabase";
import LogMeal from "./pages/LogMeal";
import Dashboard from "./pages/Dashboard";
import SearchFood from "./pages/SearchFood";
import AccountLink from "./pages/AccountLink";

export default function App() {
  const [ready, setReady] = useState(false);
  const [darkMode, setDarkMode] = useState(() => {
    const saved = localStorage.getItem("theme");
    return saved ? saved === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches;
  });

  useEffect(() => {
    document.documentElement.classList.toggle("dark", darkMode);
    localStorage.setItem("theme", darkMode ? "dark" : "light");
  }, [darkMode]);

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      if (!data.session) {
        const { data: anonData } = await supabase.auth.signInAnonymously();
        if (anonData.user) {
          // Ensure a profile row exists (FK required by meals, ai_parse_requests, etc.)
          await supabase.from("profiles").upsert({ id: anonData.user.id }, { onConflict: "id" });
        }
      }
      setReady(true);
    });

    const { data: sub } = supabase.auth.onAuthStateChange(() => {});
    return () => sub.subscription.unsubscribe();
  }, []);

  if (!ready) return null;

  return (
    <BrowserRouter>
      <div className="min-h-screen">
        <NavBar darkMode={darkMode} onToggleTheme={() => setDarkMode((value) => !value)} />
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/log" element={<LogMeal />} />
          <Route path="/search" element={<SearchFood />} />
          <Route path="/account" element={<AccountLink />} />
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
    <nav className="flex items-center justify-between border-b border-border bg-surface px-4 py-3">
      <span className="font-display text-sm font-semibold text-ink">Nutrition Tracker</span>
      <div className="flex items-center gap-1">
        <Link
          to="/"
          className={`rounded-full px-3 py-1.5 text-sm ${isActive("/") ? "bg-primary text-white" : "text-muted"}`}
        >
          Today
        </Link>
        <Link
          to="/log"
          className={`rounded-full px-3 py-1.5 text-sm ${isActive("/log") ? "bg-primary text-white" : "text-muted"}`}
        >
          Log meal
        </Link>
        <Link
          to="/search"
          className={`rounded-full px-3 py-1.5 text-sm ${isActive("/search") ? "bg-primary text-white" : "text-muted"}`}
        >
          Search
        </Link>
        <Link
          to="/account"
          className={`rounded-full px-3 py-1.5 text-sm ${isActive("/account") ? "bg-primary text-white" : "text-muted"}`}
        >
          Account
        </Link>
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
