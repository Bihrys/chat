import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  ApiError,
  createAccount,
  createDirectConversation,
  listAccounts,
  listConversations,
  listMessages,
  markConversationRead,
  sendMessage,
} from "../lib/api";
import type {
  Account,
  ChatMessage,
  Conversation,
  ServerEvent,
  SocketStatus,
} from "../lib/types";
import { connectChatSocket } from "../lib/ws";

const SESSION_ACCOUNT_KEY = "chat.dev.active-account";

export function App() {
  const [backend, setBackend] = useState("checking");
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [activeAccountId, setActiveAccountId] = useState<string | null>(
    () => sessionStorage.getItem(SESSION_ACCOUNT_KEY),
  );
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedConversationId, setSelectedConversationId] = useState<
    string | null
  >(null);
  const selectedConversationRef = useRef<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const messageEndRef = useRef<HTMLDivElement | null>(null);
  const [socketStatus, setSocketStatus] = useState<SocketStatus>("offline");
  const [directoryQuery, setDirectoryQuery] = useState("");
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCreateAccount, setShowCreateAccount] = useState(false);

  const activeAccount = useMemo(
    () => accounts.find((account) => account.account_id === activeAccountId),
    [accounts, activeAccountId],
  );

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

  const refreshAccounts = useCallback(async () => {
    const next = await listAccounts();
    setAccounts(next);
    if (
      activeAccountId !== null &&
      !next.some((account) => account.account_id === activeAccountId)
    ) {
      setActiveAccountId(null);
      sessionStorage.removeItem(SESSION_ACCOUNT_KEY);
    }
  }, [activeAccountId]);

  const refreshConversations = useCallback(async (accountId: string) => {
    const next = await listConversations(accountId);
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

  useEffect(() => {
    void invoke<string>("backend_status")
      .then(setBackend)
      .catch(() => setBackend("unavailable"));

    void refreshAccounts().catch((reason) => {
      setError(readableError(reason));
    });
  }, [refreshAccounts]);

  useEffect(() => {
    selectedConversationRef.current = selectedConversationId;
  }, [selectedConversationId]);

  useEffect(() => {
    if (!activeAccountId) {
      setConversations([]);
      setMessages([]);
      setSelectedConversationId(null);
      setSocketStatus("offline");
      return;
    }

    sessionStorage.setItem(SESSION_ACCOUNT_KEY, activeAccountId);
    setSelectedConversationId(null);
    setMessages([]);
    setError(null);

    void refreshConversations(activeAccountId).catch((reason) => {
      setError(readableError(reason));
    });

    return connectChatSocket(activeAccountId, {
      onStatus: setSocketStatus,
      onEvent: (event) => {
        void handleServerEvent(
          event,
          activeAccountId,
          selectedConversationRef.current,
          appendMessage,
          setMessages,
          refreshConversations,
        ).catch((reason) => {
          setError(readableError(reason));
        });
      },
    });
  }, [activeAccountId, appendMessage, refreshConversations]);


  useEffect(() => {
    messageEndRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (!activeAccountId || !selectedConversationId) {
      setMessages([]);
      return;
    }

    let cancelled = false;
    void listMessages(activeAccountId, selectedConversationId)
      .then((next) => {
        if (!cancelled) {
          setMessages(next);
        }
      })
      .then(() => markConversationRead(activeAccountId, selectedConversationId))
      .then(() => refreshConversations(activeAccountId))
      .catch((reason) => {
        if (!cancelled) {
          setError(readableError(reason));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [activeAccountId, refreshConversations, selectedConversationId]);

  const directoryResults = useMemo(() => {
    const normalized = directoryQuery.trim().toLowerCase();
    return accounts
      .filter((account) => account.account_id !== activeAccountId)
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
  }, [accounts, activeAccountId, directoryQuery]);

  async function openDirectConversation(peerAccountId: string) {
    if (!activeAccountId) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const conversation = await createDirectConversation(
        activeAccountId,
        peerAccountId,
      );
      await refreshConversations(activeAccountId);
      setSelectedConversationId(conversation.conversation_id);
      setDirectoryQuery("");
    } catch (reason) {
      setError(readableError(reason));
    } finally {
      setBusy(false);
    }
  }

  async function submitMessage() {
    if (!activeAccountId || !selectedConversationId || !draft.trim() || busy) {
      return;
    }

    const body = draft.trim();
    const clientMessageId = crypto.randomUUID();
    setDraft("");
    setBusy(true);
    setError(null);
    try {
      const created = await sendMessage(
        activeAccountId,
        selectedConversationId,
        body,
        clientMessageId,
      );
      appendMessage(created);
      await refreshConversations(activeAccountId);
    } catch (reason) {
      setDraft(body);
      setError(readableError(reason));
    } finally {
      setBusy(false);
    }
  }

  if (!activeAccount) {
    return (
      <Onboarding
        accounts={accounts}
        error={error}
        showCreate={showCreateAccount}
        onShowCreate={() => setShowCreateAccount(true)}
        onSelect={(accountId) => {
          setActiveAccountId(accountId);
          setError(null);
        }}
        onCreate={async (username, displayName) => {
          setBusy(true);
          setError(null);
          try {
            const account = await createAccount({ username, displayName });
            await refreshAccounts();
            setActiveAccountId(account.account_id);
          } catch (reason) {
            setError(readableError(reason));
          } finally {
            setBusy(false);
          }
        }}
        busy={busy}
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
            title="Switch local development profile"
            onClick={() => {
              setActiveAccountId(null);
              sessionStorage.removeItem(SESSION_ACCOUNT_KEY);
            }}
          >
            ⇄
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
            placeholder="Search local users"
          />
          {directoryQuery && (
            <div className="directory-results">
              {directoryResults.length === 0 ? (
                <p className="empty-small">No matching local users.</p>
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
              Search for another local profile above to start the first chat.
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
                        {conversationPeer?.display_name ?? "Unknown local user"}
                      </strong>
                      <time>{relativeTime(conversation.last_message_at)}</time>
                    </span>
                    <span className="conversation-preview">
                      {conversation.last_message?.body ?? "No messages yet"}
                    </span>
                  </span>
                  {conversation.unread_count > 0 && (
                    <span className="unread-badge">
                      {Math.min(conversation.unread_count, 99)}
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
                <h1>{peer?.display_name ?? "Direct conversation"}</h1>
                <p>
                  {peer ? `@${peer.username}` : selectedConversation.peer_account_id}
                </p>
              </div>
              <span className="dev-pill">PLAINTEXT DEV V0</span>
            </header>

            <div className="message-scroll">
              {messages.length === 0 ? (
                <div className="empty-chat">
                  <div className="empty-icon">✦</div>
                  <h2>Conversation created</h2>
                  <p>Send the first local development message.</p>
                </div>
              ) : (
                <div className="message-stack">
                  {messages.map((message) => {
                    const mine = message.sender_account_id === activeAccountId;
                    return (
                      <article
                        key={message.message_id}
                        className={`message-row ${mine ? "mine" : "theirs"}`}
                      >
                        <div className="message-bubble">
                          <p>{message.body}</p>
                          <time>{formatClock(message.created_at)}</time>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
              <div ref={messageEndRef} />
            </div>

            <footer className="composer">
              <textarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void submitMessage();
                  }
                }}
                placeholder="Write a message…"
                rows={1}
              />
              <button
                className="send-button"
                disabled={busy || !draft.trim()}
                onClick={() => void submitMessage()}
              >
                Send
              </button>
            </footer>
          </>
        ) : (
          <div className="empty-chat landing">
            <div className="empty-icon">◎</div>
            <h1>Basic chat vertical slice</h1>
            <p>
              Select a conversation, or search for another local development
              profile to begin.
            </p>
          </div>
        )}

        {error && (
          <button className="error-banner" onClick={() => setError(null)}>
            <strong>Something went wrong</strong>
            <span>{error}</span>
            <span aria-hidden>×</span>
          </button>
        )}
      </section>
    </main>
  );
}

function Onboarding(props: {
  accounts: Account[];
  error: string | null;
  showCreate: boolean;
  busy: boolean;
  onShowCreate(): void;
  onSelect(accountId: string): void;
  onCreate(username: string, displayName: string): Promise<void>;
}) {
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");

  return (
    <main className="onboarding-shell">
      <section className="onboarding-card">
        <p className="eyebrow">Secure Chat · Local development</p>
        <h1>Choose a local profile</h1>
        <p className="onboarding-intro">
          This stage deliberately validates the chat product loop before the
          E2EE payload is inserted. Profiles here are local development actors,
          not the final authentication system.
        </p>

        {props.accounts.length > 0 && (
          <div className="profile-grid">
            {props.accounts.map((account) => (
              <button
                key={account.account_id}
                className="profile-card"
                onClick={() => props.onSelect(account.account_id)}
              >
                <span className="avatar large">{initials(account.display_name)}</span>
                <strong>{account.display_name}</strong>
                <span>@{account.username}</span>
              </button>
            ))}
          </div>
        )}

        {!props.showCreate ? (
          <button className="primary-button" onClick={props.onShowCreate}>
            Create another local profile
          </button>
        ) : (
          <form
            className="create-profile-form"
            onSubmit={(event) => {
              event.preventDefault();
              void props.onCreate(username, displayName);
            }}
          >
            <label>
              Username
              <input
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                placeholder="alice"
                minLength={3}
                maxLength={32}
                required
              />
            </label>
            <label>
              Display name
              <input
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                placeholder="Alice"
                maxLength={64}
                required
              />
            </label>
            <button
              className="primary-button"
              type="submit"
              disabled={props.busy}
            >
              {props.busy ? "Creating…" : "Create profile"}
            </button>
          </form>
        )}

        {props.error && <p className="form-error">{props.error}</p>}
      </section>
    </main>
  );
}

async function handleServerEvent(
  event: ServerEvent,
  activeAccountId: string,
  selectedConversationId: string | null,
  appendMessage: (message: ChatMessage) => void,
  replaceMessages: (messages: ChatMessage[]) => void,
  refreshConversations: (accountId: string) => Promise<void>,
) {
  if (event.type === "connected") {
    await refreshConversations(activeAccountId);
    if (selectedConversationId) {
      const latest = await listMessages(activeAccountId, selectedConversationId);
      replaceMessages(latest);
      await markConversationRead(activeAccountId, selectedConversationId);
      await refreshConversations(activeAccountId);
    }
    return;
  }

  if (event.type === "message_created") {
    const message = event.payload.message;
    if (message.conversation_id === selectedConversationId) {
      appendMessage(message);
      if (message.sender_account_id !== activeAccountId) {
        await markConversationRead(activeAccountId, message.conversation_id);
      }
    }
    await refreshConversations(activeAccountId);
  }

  if (event.type === "conversation_read") {
    await refreshConversations(activeAccountId);
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
  return value
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("") || "?";
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
