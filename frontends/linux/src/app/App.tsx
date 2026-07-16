import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  ApiError,
  createDirectConversation,
  getCurrentAccount,
  listAccounts,
  listConversations,
  listMessages,
  loginAccount,
  logoutAccount,
  markConversationRead,
  registerAccount,
  sendMessage,
} from "../lib/api";
import type {
  Account,
  AuthSession,
  ChatMessage,
  Conversation,
  ServerEvent,
  SocketStatus,
} from "../lib/types";
import { connectChatSocket } from "../lib/ws";
import {
  applyDocumentPreferences,
  readStoredLocale,
  readStoredTheme,
  storeLocale,
  storeTheme,
  translations,
  type Locale,
  type ThemeMode,
  type Translation,
} from "../lib/preferences";
import { SettingsIcon } from "./PreferenceIcons";
import { SettingsPanel } from "./SettingsPanel";

const AUTH_SESSION_KEY = "chat.auth.session.v1";
const MAX_COMPOSER_HEIGHT = 132;

export function App() {
  const [backend, setBackend] = useState("checking");
  const [locale, setLocale] = useState<Locale>(readStoredLocale);
  const [theme, setTheme] = useState<ThemeMode>(readStoredTheme);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const t = translations[locale];
  const [session, setSession] = useState<AuthSession | null>(readStoredSession);
  const [authChecking, setAuthChecking] = useState(session !== null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedConversationId, setSelectedConversationId] = useState<
    string | null
  >(null);
  const selectedConversationRef = useRef<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const messageScrollRef = useRef<HTMLDivElement | null>(null);
  const messageEndRef = useRef<HTMLDivElement | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const [socketStatus, setSocketStatus] = useState<SocketStatus>("offline");
  const [directoryQuery, setDirectoryQuery] = useState("");
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const accessToken = session?.access_token ?? null;
  const activeAccount = session?.account ?? null;

  const accountById = useMemo(
    () => new Map(accounts.map((account) => [account.account_id, account])),
    [accounts],
  );

  const selectedConversation = useMemo(
    () =>
      conversations.find(
        (conversation) => conversation.conversation_id === selectedConversationId,
      ) ?? null,
    [conversations, selectedConversationId],
  );

  const peer = selectedConversation
    ? accountById.get(selectedConversation.peer_account_id)
    : undefined;

  useLayoutEffect(() => {
    applyDocumentPreferences(locale, theme);
    storeLocale(locale);
    storeTheme(theme);
  }, [locale, theme]);

  const saveSession = useCallback((next: AuthSession) => {
    localStorage.setItem(AUTH_SESSION_KEY, JSON.stringify(next));
    setSession(next);
  }, []);

  const clearSession = useCallback(() => {
    localStorage.removeItem(AUTH_SESSION_KEY);
    setSession(null);
    setAccounts([]);
    setConversations([]);
    setMessages([]);
    setSelectedConversationId(null);
    setSocketStatus("offline");
  }, []);

  const refreshAccounts = useCallback(async (token: string) => {
    const next = await listAccounts(token);
    setAccounts(next);
  }, []);

  const refreshConversations = useCallback(async (token: string) => {
    const next = await listConversations(token);
    setConversations(next);
  }, []);

  const appendMessage = useCallback((incoming: ChatMessage) => {
    setMessages((current) => {
      if (current.some((message) => message.message_id === incoming.message_id)) {
        return current;
      }
      return [...current, incoming].sort(
        (left, right) => left.message_seq - right.message_seq,
      );
    });
  }, []);

  const reportError = useCallback(
    (reason: unknown) => {
      if (reason instanceof ApiError && reason.status === 401) {
        clearSession();
      }
      setError(readableError(reason));
    },
    [clearSession],
  );

  useEffect(() => {
    void invoke<string>("backend_status")
      .then(setBackend)
      .catch(() => setBackend("web"));
  }, []);

  useEffect(() => {
    if (!accessToken || !session) {
      setAuthChecking(false);
      return;
    }

    let cancelled = false;
    setAuthChecking(true);
    void getCurrentAccount(accessToken)
      .then((account) => {
        if (!cancelled) {
          saveSession({ ...session, account });
        }
      })
      .catch((reason) => {
        if (!cancelled) {
          clearSession();
          setError(readableError(reason));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setAuthChecking(false);
        }
      });

    return () => {
      cancelled = true;
    };
    // The access token is the stable session identity. Updating account display
    // data must not trigger another verification request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken]);

  useEffect(() => {
    selectedConversationRef.current = selectedConversationId;
  }, [selectedConversationId]);

  useEffect(() => {
    if (!accessToken || !activeAccount) {
      return;
    }

    setSelectedConversationId(null);
    setMessages([]);
    setError(null);

    void Promise.all([
      refreshAccounts(accessToken),
      refreshConversations(accessToken),
    ]).catch(reportError);

    return connectChatSocket(accessToken, {
      onStatus: setSocketStatus,
      onEvent: (event) => {
        void handleServerEvent(
          event,
          accessToken,
          activeAccount.account_id,
          selectedConversationRef.current,
          appendMessage,
          setMessages,
          refreshConversations,
        ).catch(reportError);
      },
    });
  }, [
    accessToken,
    activeAccount,
    appendMessage,
    refreshAccounts,
    refreshConversations,
    reportError,
  ]);

  useEffect(() => {
    if (!accessToken || !directoryQuery.trim()) {
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(() => {
      void listAccounts(accessToken, directoryQuery)
        .then((results) => {
          if (cancelled) {
            return;
          }
          setAccounts((current) => {
            const merged = new Map(
              current.map((account) => [account.account_id, account]),
            );
            for (const account of results) {
              merged.set(account.account_id, account);
            }
            return [...merged.values()];
          });
        })
        .catch(reportError);
    }, 220);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [accessToken, directoryQuery, reportError]);

  useEffect(() => {
    if (!accessToken || !selectedConversationId) {
      setMessages([]);
      return;
    }

    let cancelled = false;
    void listMessages(accessToken, selectedConversationId)
      .then((next) => {
        if (!cancelled) {
          setMessages(next);
        }
      })
      .then(() => markConversationRead(accessToken, selectedConversationId))
      .then(() => refreshConversations(accessToken))
      .catch((reason) => {
        if (!cancelled) {
          reportError(reason);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    accessToken,
    refreshConversations,
    reportError,
    selectedConversationId,
  ]);

  useLayoutEffect(() => {
    const composer = composerRef.current;
    if (!composer) {
      return;
    }
    composer.style.height = "auto";
    composer.style.height = `${Math.min(composer.scrollHeight, MAX_COMPOSER_HEIGHT)}px`;
    composer.style.overflowY =
      composer.scrollHeight > MAX_COMPOSER_HEIGHT ? "auto" : "hidden";
  }, [draft]);

  useLayoutEffect(() => {
    const scroller = messageScrollRef.current;
    if (scroller) {
      scroller.scrollTop = scroller.scrollHeight;
    }
  }, [messages, selectedConversationId]);

  const directoryResults = useMemo(() => {
    const normalized = directoryQuery.trim().toLowerCase();
    return accounts
      .filter((account) => account.account_id !== activeAccount?.account_id)
      .filter((account) => {
        if (!normalized) {
          return true;
        }
        return (
          account.username.toLowerCase().includes(normalized) ||
          account.display_name.toLowerCase().includes(normalized)
        );
      })
      .slice(0, 12);
  }, [accounts, activeAccount?.account_id, directoryQuery]);

  async function openDirectConversation(peerAccountId: string) {
    if (!accessToken) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const conversation = await createDirectConversation(
        accessToken,
        peerAccountId,
      );
      await refreshConversations(accessToken);
      setSelectedConversationId(conversation.conversation_id);
      setDirectoryQuery("");
    } catch (reason) {
      reportError(reason);
    } finally {
      setBusy(false);
    }
  }

  async function submitMessage() {
    if (!accessToken || !selectedConversationId || !draft.trim() || busy) {
      return;
    }

    const body = draft.trim();
    const clientMessageId = crypto.randomUUID();
    setDraft("");
    setBusy(true);
    setError(null);
    try {
      const created = await sendMessage(
        accessToken,
        selectedConversationId,
        body,
        clientMessageId,
      );
      appendMessage(created);
      await refreshConversations(accessToken);
    } catch (reason) {
      setDraft(body);
      reportError(reason);
    } finally {
      setBusy(false);
    }
  }

  async function performLogout() {
    if (accessToken) {
      try {
        await logoutAccount(accessToken);
      } catch {
        // Local logout still clears the client session if the service is down.
      }
    }
    clearSession();
    setError(null);
  }

  if (authChecking && !activeAccount) {
    return (
      <>
        <LoadingScreen t={t} onOpenSettings={() => setSettingsOpen(true)} />
        <SettingsPanel
          open={settingsOpen}
          locale={locale}
          theme={theme}
          t={t}
          onLocaleChange={setLocale}
          onThemeChange={setTheme}
          onClose={() => setSettingsOpen(false)}
        />
      </>
    );
  }

  if (!session || !activeAccount) {
    return (
      <>
      <AuthScreen
        busy={busy}
        error={error}
        t={t}
        onOpenSettings={() => setSettingsOpen(true)}
        onLogin={async (username, password) => {
          setBusy(true);
          setError(null);
          try {
            saveSession(await loginAccount({ username, password }));
          } catch (reason) {
            setError(readableError(reason));
          } finally {
            setBusy(false);
          }
        }}
        onRegister={async (username, displayName, password) => {
          setBusy(true);
          setError(null);
          try {
            saveSession(
              await registerAccount({ username, displayName, password }),
            );
          } catch (reason) {
            setError(readableError(reason));
          } finally {
            setBusy(false);
          }
        }}
      />
      <SettingsPanel
        open={settingsOpen}
        locale={locale}
        theme={theme}
        t={t}
        onLocaleChange={setLocale}
        onThemeChange={setTheme}
        onClose={() => setSettingsOpen(false)}
      />
      </>
    );
  }

  return (
    <main className="chat-shell">
      <aside className="sidebar">
        <header className="account-header">
          <div className="avatar">{initials(activeAccount.display_name)}</div>
          <div className="account-copy">
            <strong>{activeAccount.display_name}</strong>
            <span>@{activeAccount.username}</span>
          </div>
          <div className="account-actions">
            <button
              className="icon-button"
              type="button"
              title={t.settings}
              aria-label={t.settings}
              onClick={() => setSettingsOpen(true)}
            >
              <SettingsIcon />
            </button>
            <button
              className="icon-button"
              type="button"
              title={t.logout}
              aria-label={t.logout}
              onClick={() => void performLogout()}
            >
              ⎋
            </button>
          </div>
        </header>

        <div className="connection-strip">
          <span className={`status-dot ${socketStatus}`} />
          <span>{socketStatusLabel(socketStatus, t)}</span>
          <span className="backend-state">{t.rustCore}: {backend}</span>
        </div>

        <section className="directory-panel">
          <label htmlFor="directory-search">{t.startConversation}</label>
          <input
            id="directory-search"
            value={directoryQuery}
            onChange={(event) => setDirectoryQuery(event.target.value)}
            placeholder={t.searchRegisteredUsers}
            autoComplete="off"
          />
          {directoryQuery && (
            <div className="directory-results">
              {directoryResults.length === 0 ? (
                <p className="empty-small">{t.noMatchingUsers}</p>
              ) : (
                directoryResults.map((account) => (
                  <button
                    key={account.account_id}
                    className="directory-person"
                    disabled={busy}
                    onClick={() => void openDirectConversation(account.account_id)}
                  >
                    <span className="mini-avatar">
                      {initials(account.display_name)}
                    </span>
                    <span>
                      <strong>{account.display_name}</strong>
                      <small>@{account.username}</small>
                    </span>
                  </button>
                ))
              )}
            </div>
          )}
        </section>

        <nav className="conversation-list" aria-label={t.conversations}>
          <div className="section-title">
            <span>{t.messages}</span>
            <span>{conversations.length}</span>
          </div>
          {conversations.length === 0 ? (
            <p className="empty-sidebar">
              {t.noConversations}
            </p>
          ) : (
            conversations.map((conversation) => {
              const conversationPeer = accountById.get(
                conversation.peer_account_id,
              );
              return (
                <button
                  key={conversation.conversation_id}
                  className={`conversation-row ${
                    conversation.conversation_id === selectedConversationId
                      ? "selected"
                      : ""
                  }`}
                  onClick={() =>
                    setSelectedConversationId(conversation.conversation_id)
                  }
                >
                  <span className="mini-avatar">
                    {initials(
                      conversationPeer?.display_name ??
                        conversation.peer_account_id.slice(0, 2),
                    )}
                  </span>
                  <span className="conversation-copy">
                    <span className="conversation-topline">
                      <strong>
                        {conversationPeer?.display_name ?? t.unknownUser}
                      </strong>
                      <time>{relativeTime(conversation.last_message_at, locale)}</time>
                    </span>
                    <span className="conversation-preview">
                      {conversation.last_message?.body ?? t.noMessagesYet}
                    </span>
                  </span>
                  {conversation.unread_count > 0 && (
                    <span className="unread-badge">
                      {conversation.unread_count > 99
                        ? "99+"
                        : conversation.unread_count}
                    </span>
                  )}
                </button>
              );
            })
          )}
        </nav>
      </aside>

      <section className="chat-panel">
        {selectedConversation ? (
          <>
            <header className="chat-header">
              <div>
                <h1>{peer?.display_name ?? t.conversation}</h1>
                <p>{peer ? `@${peer.username}` : selectedConversation.peer_account_id}</p>
              </div>
              <span className="dev-pill">{t.plaintextDev}</span>
            </header>

            <div className="message-scroll" ref={messageScrollRef}>
              <div className="message-stack">
                {messages.length === 0 ? (
                  <div className="empty-chat">
                    <div className="empty-icon">✦</div>
                    <h2>{t.emptyMessagesTitle}</h2>
                    <p>{t.emptyMessagesBody}</p>
                  </div>
                ) : (
                  messages.map((message) => (
                    <div
                      key={message.message_id}
                      className={`message-row ${
                        message.sender_account_id === activeAccount.account_id
                          ? "mine"
                          : ""
                      }`}
                    >
                      <div className="message-bubble">
                        <p>{message.body}</p>
                        <time>{formatClock(message.created_at)}</time>
                      </div>
                    </div>
                  ))
                )}
                <div ref={messageEndRef} />
              </div>
            </div>

            <form
              className="composer"
              onSubmit={(event) => {
                event.preventDefault();
                void submitMessage();
              }}
            >
              <textarea
                ref={composerRef}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (
                    event.key === "Enter" &&
                    !event.shiftKey &&
                    !event.nativeEvent.isComposing
                  ) {
                    event.preventDefault();
                    void submitMessage();
                  }
                }}
                placeholder={t.writeMessage}
                rows={1}
                maxLength={8_000}
              />
              <button
                className="send-button"
                type="submit"
                disabled={busy || !draft.trim()}
              >
                {t.send}
              </button>
            </form>
          </>
        ) : (
          <div className="empty-chat landing">
            <div className="empty-icon">⌁</div>
            <h1>{t.appName}</h1>
            <p>{t.landingBody}</p>
          </div>
        )}

        {error && (
          <button className="error-banner" onClick={() => setError(null)}>
            <span>!</span>
            <span>{error}</span>
            <span>×</span>
          </button>
        )}
      </section>
      <SettingsPanel
        open={settingsOpen}
        locale={locale}
        theme={theme}
        t={t}
        onLocaleChange={setLocale}
        onThemeChange={setTheme}
        onClose={() => setSettingsOpen(false)}
      />
    </main>
  );
}

interface AuthScreenProps {
  busy: boolean;
  error: string | null;
  t: Translation;
  onOpenSettings(): void;
  onLogin(username: string, password: string): Promise<void>;
  onRegister(
    username: string,
    displayName: string,
    password: string,
  ): Promise<void>;
}

function AuthScreen(props: AuthScreenProps) {
  const [mode, setMode] = useState<"login" | "register">("register");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  function switchMode(next: "login" | "register") {
    if (next === mode) {
      return;
    }
    setMode(next);
    setLocalError(null);
  }

  return (
    <main className="onboarding-shell">
      <button
        className="onboarding-settings-button"
        type="button"
        onClick={props.onOpenSettings}
      >
        <SettingsIcon />
        <span>{props.t.settings}</span>
      </button>
      <section
        className={`onboarding-card auth-card auth-card-${mode}`}
      >
        <div className={`auth-heading auth-heading-${mode}`}>
          <p className="eyebrow">
            {props.t.appName} · {props.t.localDevelopment}
          </p>
          <h1>
            {mode === "register"
              ? props.t.createAccountTitle
              : props.t.welcomeBack}
          </h1>
          <p className="onboarding-intro">{props.t.authIntro}</p>
        </div>

        <div
          className={`auth-tabs auth-tabs-${mode}`}
          role="tablist"
          aria-label={props.t.login}
        >
          <span className="auth-tab-indicator" aria-hidden="true" />
          <button
            className={mode === "register" ? "active" : ""}
            type="button"
            role="tab"
            aria-selected={mode === "register"}
            onClick={() => switchMode("register")}
          >
            {props.t.register}
          </button>
          <button
            className={mode === "login" ? "active" : ""}
            type="button"
            role="tab"
            aria-selected={mode === "login"}
            onClick={() => switchMode("login")}
          >
            {props.t.login}
          </button>
        </div>

        <div className={`auth-form-stage auth-form-stage-${mode}`}>
          <form
            className={`auth-form auth-form-${mode}`}
            autoComplete="off"
            onSubmit={(event) => {
              event.preventDefault();
              setLocalError(null);
              const normalizedName = name.trim();
              if (!normalizedName) {
                return;
              }
              if (mode === "register") {
                void props.onRegister(normalizedName, normalizedName, password);
              } else {
                void props.onLogin(normalizedName, password);
              }
            }}
          >
            <label>
              {props.t.username}
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder={props.t.username}
                minLength={3}
                maxLength={32}
                pattern="[A-Za-z0-9_]+"
                autoComplete="off"
                autoFocus
                required
              />
              {mode === "register" && <small>{props.t.usernameHint}</small>}
            </label>

            <label>
              {props.t.password}
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder={props.t.password}
                minLength={8}
                maxLength={128}
                autoComplete={
                  mode === "register" ? "new-password" : "current-password"
                }
                required
              />
              {mode === "register" && <small>{props.t.passwordHint}</small>}
            </label>

            <button
              className="primary-button auth-submit"
              type="submit"
              disabled={props.busy}
            >
              {props.busy
                ? props.t.pleaseWait
                : mode === "register"
                  ? props.t.createAccount
                  : props.t.login}
            </button>
          </form>
        </div>

        {(localError || props.error) && (
          <p className="form-error">{localError ?? props.error}</p>
        )}
      </section>
    </main>
  );
}

function LoadingScreen({ t, onOpenSettings }: { t: Translation; onOpenSettings(): void }) {
  return (
    <main className="onboarding-shell">
      <button
        className="onboarding-settings-button"
        type="button"
        onClick={onOpenSettings}
      >
        <SettingsIcon />
        <span>{t.settings}</span>
      </button>
      <section className="onboarding-card loading-card">
        <p className="eyebrow">{t.appName}</p>
        <h1>{t.restoringSession}</h1>
      </section>
    </main>
  );
}

async function handleServerEvent(
  event: ServerEvent,
  accessToken: string,
  activeAccountId: string,
  selectedConversationId: string | null,
  appendMessage: (message: ChatMessage) => void,
  replaceMessages: (messages: ChatMessage[]) => void,
  refreshConversations: (accessToken: string) => Promise<void>,
) {
  if (event.type === "connected") {
    await refreshConversations(accessToken);
    if (selectedConversationId) {
      const latest = await listMessages(accessToken, selectedConversationId);
      replaceMessages(latest);
      await markConversationRead(accessToken, selectedConversationId);
      await refreshConversations(accessToken);
    }
    return;
  }

  if (event.type === "message_created") {
    const message = event.payload.message;
    if (message.conversation_id === selectedConversationId) {
      appendMessage(message);
      if (message.sender_account_id !== activeAccountId) {
        await markConversationRead(accessToken, message.conversation_id);
      }
    }
    await refreshConversations(accessToken);
  }

  if (event.type === "conversation_read") {
    await refreshConversations(accessToken);
  }
}

function readStoredSession(): AuthSession | null {
  const raw = localStorage.getItem(AUTH_SESSION_KEY);
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<AuthSession>;
    if (
      typeof parsed.access_token !== "string" ||
      typeof parsed.expires_at !== "string" ||
      !parsed.account ||
      typeof parsed.account.account_id !== "string"
    ) {
      localStorage.removeItem(AUTH_SESSION_KEY);
      return null;
    }
    return parsed as AuthSession;
  } catch {
    localStorage.removeItem(AUTH_SESSION_KEY);
    return null;
  }
}

function readableError(reason: unknown): string {
  if (reason instanceof ApiError) {
    return `${reason.message} (${reason.code})`;
  }
  if (reason instanceof Error) {
    return reason.message;
  }
  return String(reason);
}

function initials(value: string): string {
  return (
    value
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? "")
      .join("") || "?"
  );
}

function socketStatusLabel(status: SocketStatus, t: Translation): string {
  if (status === "online") {
    return t.realtimeConnected;
  }
  if (status === "connecting") {
    return t.realtimeConnecting;
  }
  return t.realtimeOffline;
}

function relativeTime(value: string | null, locale: Locale): string {
  if (!value) {
    return "";
  }
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) {
    return "";
  }
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 60) return locale === "zh-CN" ? "刚刚" : "now";
  if (seconds < 3600) {
    const minutes = Math.floor(seconds / 60);
    return locale === "zh-CN" ? `${minutes}分钟` : `${minutes}m`;
  }
  if (seconds < 86_400) {
    const hours = Math.floor(seconds / 3600);
    return locale === "zh-CN" ? `${hours}小时` : `${hours}h`;
  }
  return new Date(value).toLocaleDateString(locale, {
    month: "short",
    day: "numeric",
  });
}

function formatClock(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return date.toLocaleTimeString(document.documentElement.lang || undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
}
