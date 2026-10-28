import { useState } from "react";
import { applyTheme, getInitialTheme, saveTheme, type Theme } from "../theme";
import { MoonIcon, SunIcon } from "../icons";
import { useLanguage } from "../language";

/**
 * Header theme toggle. Applies the theme document-wide (via CSS variables)
 * and persists the user's explicit choice in localStorage.
 */
export default function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(() => getInitialTheme());
  const { t } = useLanguage();

  const toggle = () => {
    const next: Theme = theme === "dark" ? "light" : "dark";
    applyTheme(next);
    saveTheme(next);
    setTheme(next);
  };

  const nextLabel =
    theme === "dark"
      ? t("Theme mode light")
      : t("Theme mode dark");
  const modeName = nextLabel.startsWith("Theme mode ")
    ? theme === "dark" ? "light" : "dark"
    : nextLabel;
  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={toggle}
      aria-label={t("Switch to {mode} mode", { mode: modeName })}
      title={t("Switch to {mode} mode", { mode: modeName })}
    >
      {theme === "dark" ? <SunIcon size={18} /> : <MoonIcon size={18} />}
    </button>
  );
}
