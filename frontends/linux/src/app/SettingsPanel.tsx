import { useEffect, useState } from "react";
import type { Account } from "../lib/types";
import type { Locale, ThemeMode, Translation } from "../lib/preferences";
import { MoonIcon, SettingsIcon, SunIcon } from "./PreferenceIcons";

interface SettingsPanelProps {
  open: boolean;
  account?: Account | null;
  locale: Locale;
  theme: ThemeMode;
  t: Translation;
  onLocaleChange(locale: Locale): void;
  onThemeChange(theme: ThemeMode): void;
  onLogout?(): void;
  onClose(): void;
}

type SettingsPage = "account" | "general";

export function SettingsPanel({
  open,
  account,
  locale,
  theme,
  t,
  onLocaleChange,
  onThemeChange,
  onLogout,
  onClose,
}: SettingsPanelProps) {
  const [page, setPage] = useState<SettingsPage>(account ? "account" : "general");

  useEffect(() => {
    if (!open) return;
    setPage(account ? "account" : "general");
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [account, onClose, open]);

  if (!open) return null;

  return (
    <div className="settings-window-overlay" role="presentation" onMouseDown={onClose}>
      <section
        className="settings-window"
        role="dialog"
        aria-modal="true"
        aria-label={t.settings}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <button className="settings-window-close" type="button" onClick={onClose}>
          ×
        </button>

        <aside className="settings-nav">
          {account && (
            <button
              className={page === "account" ? "active" : ""}
              type="button"
              onClick={() => setPage("account")}
            >
              <span className="settings-nav-icon">♙</span>
              <span>{t.accountAndStorage}</span>
            </button>
          )}
          <button
            className={page === "general" ? "active" : ""}
            type="button"
            onClick={() => setPage("general")}
          >
            <SettingsIcon className="settings-nav-svg" />
            <span>{t.general}</span>
          </button>
        </aside>

        <div className="settings-content">
          {page === "account" && account ? (
            <AccountSettings account={account} t={t} onLogout={onLogout} />
          ) : (
            <GeneralSettings
              locale={locale}
              theme={theme}
              t={t}
              onLocaleChange={onLocaleChange}
              onThemeChange={onThemeChange}
            />
          )}
        </div>
      </section>
    </div>
  );
}

function AccountSettings({
  account,
  t,
  onLogout,
}: {
  account: Account;
  t: Translation;
  onLogout?: () => void;
}) {
  return (
    <div className="settings-page">
      <section className="settings-card account-settings-card">
        <div className="settings-account-row">
          <span className="settings-account-avatar">{initials(account.display_name)}</span>
          <span className="settings-account-copy">
            <strong>{account.display_name}</strong>
            <small>{t.chatId}: {account.chat_id}</small>
          </span>
          {onLogout && (
            <button className="settings-secondary-button" type="button" onClick={onLogout}>
              {t.logout}
            </button>
          )}
        </div>
        <div className="settings-row">
          <span>
            <strong>{t.accountUuid}</strong>
            <small>{account.account_id}</small>
          </span>
        </div>
      </section>

      <section className="settings-card">
        <div className="settings-row">
          <span>
            <strong>{t.keepChatHistory}</strong>
            <small>{t.keepChatHistoryDescription}</small>
          </span>
          <span className="fake-switch on" aria-hidden="true" />
        </div>
        <div className="settings-row">
          <span>
            <strong>{t.storageSpace}</strong>
            <small>{t.localDevelopmentStorage}</small>
          </span>
          <button className="settings-secondary-button" type="button" disabled>
            {t.manage}
          </button>
        </div>
      </section>
    </div>
  );
}

function GeneralSettings({
  locale,
  theme,
  t,
  onLocaleChange,
  onThemeChange,
}: {
  locale: Locale;
  theme: ThemeMode;
  t: Translation;
  onLocaleChange: (locale: Locale) => void;
  onThemeChange: (theme: ThemeMode) => void;
}) {
  return (
    <div className="settings-page">
      <section className="settings-card">
        <div className="settings-row">
          <span>
            <strong>{t.language}</strong>
            <small>{t.languageDescription}</small>
          </span>
          <select
            value={locale}
            aria-label={t.language}
            onChange={(event) => onLocaleChange(event.target.value as Locale)}
          >
            <option value="zh-CN">简体中文</option>
            <option value="en">English</option>
          </select>
        </div>
      </section>

      <section className="settings-card">
        <div className="settings-row">
          <span>
            <strong>{t.appearance}</strong>
            <small>{t.appearanceDescription}</small>
          </span>
          <div className="theme-segmented" role="group" aria-label={t.appearance}>
            <button
              className={theme === "dark" ? "active" : ""}
              type="button"
              onClick={() => onThemeChange("dark")}
              title={t.darkMode}
            >
              <MoonIcon />
              <span>{t.darkMode}</span>
            </button>
            <button
              className={theme === "light" ? "active" : ""}
              type="button"
              onClick={() => onThemeChange("light")}
              title={t.lightMode}
            >
              <SunIcon />
              <span>{t.lightMode}</span>
            </button>
          </div>
        </div>
      </section>

      <section className="settings-card">
        <div className="settings-row">
          <span>
            <strong>{t.fontSize}</strong>
            <small>{t.standard}</small>
          </span>
          <input className="font-size-range" type="range" min="0" max="4" defaultValue="1" />
        </div>
      </section>
    </div>
  );
}

function initials(value: string) {
  return value.trim().slice(0, 2).toUpperCase() || "?";
}
