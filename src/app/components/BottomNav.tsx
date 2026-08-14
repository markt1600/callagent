"use client";

// App-style bottom tab bar, shown on mobile only (see globals.css).

export default function BottomNav({
  active,
  isAdmin,
}: {
  active: "reservations" | "account" | "admin";
  isAdmin?: boolean;
}) {
  return (
    <nav className="bottomnav">
      <a href="/" className={active === "reservations" ? "active" : ""}>
        <span className="icon">📞</span>
        Reservations
      </a>
      <a href="/account" className={active === "account" ? "active" : ""}>
        <span className="icon">👤</span>
        Account
      </a>
      {isAdmin && (
        <a href="/admin" className={active === "admin" ? "active" : ""}>
          <span className="icon">⚙️</span>
          Admin
        </a>
      )}
    </nav>
  );
}
