import { useEffect, useState } from "react";
import InventoryPage from "./pages/InventoryPage";
import ReservationsPage from "./pages/ReservationsPage";
import DashboardPage from "./pages/DashboardPage";
import ThemeToggle from "./components/ThemeToggle";
import { ToastsProvider } from "./components/Toasts";
import { LanguageProvider, useLanguage, type Language } from "./language";

type Page = "dashboard" | "inventory" | "reservations";

/**
 * Application shell: brand, compact navigation, theme toggle and the two
 * pages. Navigation is plain state — this small app does not need a router
 * dependency. Opening a created reservation passes its id to the
 * Reservations page, which performs the (real) lookup.
 */
export default function App() {
  return (
    <LanguageProvider>
      <AppShell />
    </LanguageProvider>
  );
}

function AppShell() {
  const [page, setPage] = useState<Page>("dashboard");
  const [lookupId, setLookupId] = useState<string>("");
  const { language, setLanguage, t } = useLanguage();
  useEffect(() => {
    document.title = `DEPOT — ${t(page === "dashboard" ? "Dashboard" : page === "inventory" ? "Inventory" : "Reservations")}`;
  }, [language, page]);

  const openReservation = (id: string) => {
    setLookupId(id);
    setPage("reservations");
  };

  return (
    <ToastsProvider>
      <header className="app-header">
        <div className="app-header-inner">
          <span className="brand">
            <span className="brand-mark">DEPOT</span>
            <span className="brand-sub">{t("Inventory")}</span>
          </span>
          <nav className="app-nav" aria-label={t("Main navigation")}>
            <button
              type="button"
              className="nav-link"
              aria-current={page === "dashboard" ? "page" : undefined}
              onClick={() => setPage("dashboard")}
            >
              {t("Dashboard")}
            </button>
            <button
              type="button"
              className="nav-link"
              aria-current={page === "inventory" ? "page" : undefined}
              onClick={() => setPage("inventory")}
            >
              {t("Inventory")}
            </button>
            <button
              type="button"
              className="nav-link"
              aria-current={page === "reservations" ? "page" : undefined}
              onClick={() => setPage("reservations")}
            >
              {t("Reservations")}
            </button>
          </nav>
          <label className="language-select-label">
            <span className="sr-only">{t("Language")}</span>
            <select
              className="language-select"
              aria-label={t("Language")}
              value={language}
              onChange={(event) => setLanguage(event.target.value as Language)}
            >
              <option value="en">English</option>
              <option value="ru">Русский</option>
            </select>
          </label>
          <ThemeToggle />
        </div>
      </header>

      <main className="app-main">
        {page === "dashboard" ? (
          <DashboardPage
            onOpenInventory={() => setPage("inventory")}
            onOpenReservations={() => setPage("reservations")}
          />
        ) : page === "inventory" ? (
          <InventoryPage onOpenReservation={openReservation} />
        ) : (
          <ReservationsPage initialLookupId={lookupId} />
        )}
      </main>

      <footer className="app-footer">
        <div className="app-footer-inner">
          <div className="footer-brand">
            <span className="brand-mark">DEPOT</span>
            <p>{t("Inventory, kept in view.")}</p>
            <small>{t("Live stock and reservation management.")}</small>
          </div>
          <div className="footer-contact">
            <h2>{t("Contact us")}</h2>
            <p>Marcus <span className="footer-role">{t("Developer")}</span></p>
            <a href="tel:941251128">94 125 11 28</a>
            <span>{t("Tashkent, Uzbekistan")}</span>
          </div>
          <div className="footer-navigation">
            <h2>{t("Quick link")}</h2>
            <button type="button" className="footer-dashboard-link" onClick={() => setPage("dashboard")}>
              {t("Back to dashboard")}
            </button>
          </div>
          <div className="footer-bottom">
            <span>{t("© {year} DEPOT. Inventory reservation service.", { year: new Date().getFullYear() })}</span>
            <span>{t("All figures come from the live API.")}</span>
          </div>
        </div>
      </footer>
    </ToastsProvider>
  );
}
