import { NavLink, Outlet } from "react-router-dom";

const navItems = [
  { to: "/", label: "Repos" },
  { to: "/reviews", label: "Reviews" },
  { to: "/settings", label: "Settings" },
];

export function Layout() {
  return (
    <div className="flex min-h-screen bg-slate-900 text-slate-100">
      <aside className="w-56 shrink-0 border-r border-slate-700 flex flex-col">
        <div className="px-6 py-5 border-b border-slate-700">
          <span className="text-lg font-bold text-amber-400">🦀 Rusty Bot</span>
        </div>
        <nav className="flex flex-col gap-1 p-3 mt-2">
          {navItems.map(({ to, label }) => (
            <NavLink
              key={to}
              to={to}
              end={to === "/"}
              className={({ isActive }) =>
                `px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                  isActive
                    ? "bg-slate-700 text-slate-100"
                    : "text-slate-400 hover:text-slate-100 hover:bg-slate-800"
                }`
              }
            >
              {label}
            </NavLink>
          ))}
        </nav>
      </aside>
      <main className="flex-1 p-8 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}
