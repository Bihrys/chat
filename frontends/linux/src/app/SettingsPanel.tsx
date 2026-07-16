import { useEffect } from "react";
import type {
  Locale,
  ThemeMode,
  Translation,
} from "../lib/preferences";
import { MoonIcon, SunIcon } from "./PreferenceIcons";

interface SettingsPanelProps {
  open: boolean;
  locale: Locale;
  theme: ThemeMode;
  t: Translation;
  onLocaleChange(locale: Locale): void;
  onThemeChange(theme: ThemeMode): void;
  onClose(): void;
}

export function SettingsPanel({
  open,
  locale,
  theme,
  t,
  onLocaleChange,
  onThemeChange,
  onClose,
}: SettingsPanelProps) {
  useEffect(() => {
    if (!open) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, open]);

  if (!open) {
    return null;
  }

  return (
    <div className="settings-overlay" role="presentation" onMouseDown={onClose}>
      <section
        className="settings-panel"
        role="dialog"
        aria-modal="true"
        aria-label={t.settings}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="settings-header">
          <h2>{t.settings}</h2>
          <button
            className="icon-button settings-close"
            type="button"
            title={t.closeSettings}
            aria-label={t.closeSettings}
            onClick={onClose}
          >
            ×
          </button>
        </header>

        <div className="settings-section">
          <h3>{t.language}</h3>
          <div className="language-options" role="group" aria-label={t.language}>
            <button
              className={`preference-option ${locale === "zh-CN" ? "selected" : ""}`}
              type="button"
              aria-pressed={locale === "zh-CN"}
              onClick={() => onLocaleChange("zh-CN")}
            >
              <strong>{t.chinese}</strong>
              <span>简体中文</span>
            </button>
            <button
              className={`preference-option ${locale === "en" ? "selected" : ""}`}
              type="button"
              aria-pressed={locale === "en"}
              onClick={() => onLocaleChange("en")}
            >
              <strong>{t.english}</strong>
              <span>English</span>
            </button>
          </div>
        </div>

        <div className="settings-section">
          <h3>{t.appearance}</h3>
          <div className="theme-options" role="group" aria-label={t.appearance}>
            <button
              className={`theme-option ${theme === "dark" ? "selected" : ""}`}
              type="button"
              aria-pressed={theme === "dark"}
              onClick={() => onThemeChange("dark")}
            >
              <span className="theme-icon moon"><MoonIcon /></span>
              <span className="theme-option-copy">
                <strong>{t.darkMode}</strong>
                <small>{t.darkModeDescription}</small>
              </span>
            </button>
            <button
              className={`theme-option ${theme === "light" ? "selected" : ""}`}
              type="button"
              aria-pressed={theme === "light"}
              onClick={() => onThemeChange("light")}
            >
              <span className="theme-icon sun"><SunIcon /></span>
              <span className="theme-option-copy">
                <strong>{t.lightMode}</strong>
                <small>{t.lightModeDescription}</small>
              </span>
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
