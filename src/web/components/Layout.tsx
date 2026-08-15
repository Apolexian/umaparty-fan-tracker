import { Link, NavLink, useLocation } from "react-router-dom";
import type { ReactNode } from "react";
import { Moon, Sun } from "lucide-react";

import { toggleTheme, useTheme } from "../lib/theme.ts";

const NAV = [
  { to: "/", label: "Clubs" },
  { to: "/standings", label: "Standings" },
];

export function Layout({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const theme = useTheme();

  return (
    <div className="min-h-dvh bg-cream-100">
      <header className="border-b-4 border-[var(--color-header-border)] bg-[var(--color-header-bg)]">
        <div className="flex items-center gap-4 px-5 py-2.5">
          <Link to="/" className="font-display text-xl font-extrabold text-white">
            Umaparty
          </Link>

          <nav className="ml-auto flex gap-1">
            {NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === "/"}
                className={({ isActive }) =>
                  `px-3 py-1.5 text-sm font-bold transition-colors ${
                    isActive || (item.to === "/" && pathname.startsWith("/club"))
                      ? "chunky bg-white text-teal-800 [--chunky-lip:oklch(85%_0.01_260)]"
                      : "capsule text-white/90 hover:bg-black/15"
                  }`
                }
              >
                {item.label}
              </NavLink>
            ))}

            <button
              type="button"
              onClick={toggleTheme}
              title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
              className="capsule flex h-8 w-8 items-center justify-center text-white/90 hover:bg-black/15"
            >
              {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
            </button>
          </nav>
        </div>
      </header>

      <main className="px-5 py-5">{children}</main>

      <footer className="flex items-center gap-3 px-5 pt-4 pb-8 text-xs text-ink-400">
        <span>Fan data from chronogenesis.net, refreshed daily after 10:00 UTC.</span>
        <Link to="/officers" className="ml-auto hover:text-teal-700">
          Officers
        </Link>
      </footer>
    </div>
  );
}
