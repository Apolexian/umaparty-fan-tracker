import { Link, NavLink, useLocation } from "react-router-dom";
import type { ReactNode } from "react";

const NAV = [
  { to: "/", label: "Clubs" },
  { to: "/standings", label: "Standings" },
];

export function Layout({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();

  return (
    <div className="min-h-dvh bg-cream-100">
      <header className="border-b border-cream-300 bg-cream-50">
        <div className="mx-auto flex max-w-5xl items-center gap-4 px-4 py-3">
          <Link to="/" className="font-display text-lg font-extrabold text-ink-900">
            Uma<span className="text-teal-700">Party</span>
          </Link>

          <nav className="ml-auto flex gap-1">
            {NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === "/"}
                className={({ isActive }) =>
                  `capsule px-3 py-1.5 text-sm font-semibold transition-colors ${
                    isActive || (item.to === "/" && pathname.startsWith("/club"))
                      ? "bg-teal-500 text-cream-50"
                      : "text-ink-600 hover:bg-cream-200"
                  }`
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-6">{children}</main>

      <footer className="mx-auto flex max-w-5xl items-center gap-3 px-4 pt-4 pb-10 text-xs text-ink-400">
        <span>Fan data from chronogenesis.net, refreshed daily after 10:00 UTC.</span>
        <Link to="/officers" className="ml-auto hover:text-teal-700">
          Officers
        </Link>
      </footer>
    </div>
  );
}
