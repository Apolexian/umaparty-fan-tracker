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
      <header className="border-b-4 border-teal-600 bg-teal-500">
        <div className="flex items-center gap-4 px-5 py-2.5">
          <Link to="/" className="font-display text-xl font-extrabold text-cream-50">
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
                      ? "chunky bg-cream-50 text-teal-800 [--chunky-lip:var(--color-cream-300)]"
                      : "capsule text-cream-50/90 hover:bg-teal-600"
                  }`
                }
              >
                {item.label}
              </NavLink>
            ))}
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
