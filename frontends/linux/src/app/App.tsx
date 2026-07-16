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

const AUTH_SESSION_KEY = "chat.auth.session.v1";
const MAX_COMPOSER_HEIGHT = 132;

export function App() {
  const [backend, setBackend] = useState("checking");
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
    return <LoadingScreen />;
  }

  if (!session || !activeAccount) {
    return (
      <AuthScreen
        busy={busy}
        error={error}
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
          <button
            className="icon-button"
            title="Log out"
            onClick={() => void performLogout()}
          >
            ⎋
          </button>
        </header>

        <div className="connection-strip">
          <span className={`status-dot ${socketStatus}`} />
          <span>{socketStatusLabel(socketStatus)}</span>
          <span className="backend-state">Rust core: {backend}</span>
        </div>

        <section className="directory-panel">
          <label htmlFor="directory-search">Start a conversation</label>
          <input
            id="directory-search"
            value={directoryQuery}
            onChange={(event) => setDirectoryQuery(event.target.value)}
            placeholder="Search registered users"
            autoComplete="off"
          />
          {directoryQuery && (
            <div className="directory-results">
              {directoryResults.length === 0 ? (
                <p className="empty-small">No matching registered users.</p>
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

        <nav className="conversation-list" aria-label="Conversations">
          <div className="section-title">
            <span>Messages</span>
            <span>{conversations.length}</span>
          </div>
          {conversations.length === 0 ? (
            <p className="empty-sidebar">
              Search for another registered user above to start the first chat.
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
                        {conversationPeer?.display_name ?? "Unknown user"}
                      </strong>
                      <time>{relativeTime(conversation.last_message_at)}</time>
                    </span>
                    <span className="conversation-preview">
                      {conversation.last_message?.body ?? "No messages yet"}
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
                <h1>{peer?.display_name ?? "Conversation"}</h1>
                <p>{peer ? `@${peer.username}` : selectedConversation.peer_account_id}</p>
              </div>
              <span className="dev-pill">PLAINTEXT DEV V0</span>
            </header>

            <div className="message-scroll" ref={messageScrollRef}>
              <div className="message-stack">
                {messages.length === 0 ? (
                  <div className="empty-chat">
                    <div className="empty-icon">✦</div>
                    <h2>No messages yet</h2>
                    <p>Send the first message in this local development chat.</p>
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
                placeholder="Write a message"
                rows={1}
                maxLength={8_000}
              />
              <button
                className="send-button"
                type="submit"
                disabled={busy || !draft.trim()}
              >
                Send
              </button>
            </form>
          </>
        ) : (
          <div className="empty-chat landing">
            <div className="empty-icon">⌁</div>
            <h1>Secure Chat</h1>
            <p>
              Choose a conversation or search for another registered user. The
              current message payload remains plaintext only for this local
              development stage.
            </p>
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
    </main>
  );
}

interface AuthScreenProps {
  busy: boolean;
  error: string | null;
  onLogin(username: string, password: string): Promise<void>;
  onRegister(
    username: string,
    displayName: string,
    password: string,
  ): Promise<void>;
}

function AuthScreen(props: AuthScreenProps) {
  const [mode, setMode] = useState<"login" | "register">("register");
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  function switchMode(next: "login" | "register") {
    setMode(next);
    setLocalError(null);
  }

  return (
    <main className="onboarding-shell">
      <section className="onboarding-card auth-card">
        <p className="eyebrow">Secure Chat · Local Development</p>
        <h1>{mode === "register" ? "Create your account" : "Welcome back"}</h1>
        <p className="onboarding-intro">
          Register a username and password, then sign in as that account. This
          replaces the old local-profile picker. Passwords are stored as
          Argon2id hashes; messages are not yet end-to-end encrypted.
        </p>

        <div className="auth-tabs" role="tablist" aria-label="Authentication mode">
          <button
            className={mode === "register" ? "active" : ""}
            type="button"
            onClick={() => switchMode("register")}
          >
            Register
          </button>
          <button
            className={mode === "login" ? "active" : ""}
            type="button"
            onClick={() => switchMode("login")}
          >
            Log in
          </button>
        </div>

        <form
          className="auth-form"
          onSubmit={(event) => {
            event.preventDefault();
            setLocalError(null);
            if (mode === "register" && password !== confirmPassword) {
              setLocalError("Passwords do not match.");
              return;
            }
            if (mode === "register") {
              void props.onRegister(username, displayName, password);
            } else {
              void props.onLogin(username, password);
            }
          }}
        >
          <label>
            Username
            <input
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              placeholder="bihrys1"
              minLength={3}
              maxLength={32}
              pattern="[A-Za-z0-9_]+"
              autoComplete="username"
              autoFocus
              required
            />
            <small>3–32 letters, numbers, or underscore.</small>
          </label>

          {mode === "register" && (
            <label>
              Display name
              <input
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                placeholder="Bihrys"
                maxLength={64}
                autoComplete="name"
                required
              />
            </label>
          )}

          <label>
            Password
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              minLength={8}
              maxLength={128}
              autoComplete={
                mode === "register" ? "new-password" : "current-password"
              }
              required
            />
            {mode === "register" && <small>At least 8 characters.</small>}
          </label>

          {mode === "register" && (
            <label>
              Confirm password
              <input
                type="password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                minLength={8}
                maxLength={128}
                autoComplete="new-password"
                required
              />
            </label>
          )}

          <button className="primary-button auth-submit" type="submit" disabled={props.busy}>
            {props.busy
              ? "Please wait…"
              : mode === "register"
                ? "Create account"
                : "Log in"}
          </button>
        </form>

        {(localError || props.error) && (
          <p className="form-error">{localError ?? props.error}</p>
        )}
      </section>
    </main>
  );
}

function LoadingScreen() {
  return (
    <main className="onboarding-shell">
      <section className="onboarding-card loading-card">
        <p className="eyebrow">Secure Chat</p>
        <h1>Restoring your session…</h1>
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

function socketStatusLabel(status: SocketStatus): string {
  if (status === "online") {
    return "Realtime connected";
  }
  if (status === "connecting") {
    return "Realtime connecting";
  }
  return "Realtime offline";
}

function relativeTime(value: string | null): string {
  if (!value) {
    return "";
  }
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) {
    return "";
  }
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 60) return "now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h`;
  return new Date(value).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function formatClock(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return date.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
}
