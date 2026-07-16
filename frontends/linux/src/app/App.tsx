import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  ApiError,
  addGroupMember,
  createDirectConversation,
  createGroup,
  dissolveGroup,
  getAccount,
  getCurrentAccount,
  getGroup,
  listContacts,
  listConversations,
  listFriendRequests,
  listMessages,
  loginAccount,
  logoutAccount,
  lookupAccount,
  markConversationRead,
  registerAccount,
  removeGroupMember,
  respondFriendRequest,
  sendFriendRequest,
  sendMessage,
  setGroupMemberRole,
} from "../lib/api";
import type {
  Account,
  AuthSession,
  ChatMessage,
  Conversation,
  FriendRequestMailbox,
  GroupDetails,
  GroupRole,
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
const EMPTY_REQUESTS: FriendRequestMailbox = { incoming: [], outgoing: [] };

type SidebarView = "chats" | "contacts" | "requests";

export function App() {
  const [backend, setBackend] = useState("checking");
  const [locale, setLocale] = useState<Locale>(readStoredLocale);
  const [theme, setTheme] = useState<ThemeMode>(readStoredTheme);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const t = translations[locale];

  const [session, setSession] = useState<AuthSession | null>(readStoredSession);
  const [authChecking, setAuthChecking] = useState(session !== null);
  const [contacts, setContacts] = useState<Account[]>([]);
  const [knownAccounts, setKnownAccounts] = useState<Account[]>([]);
  const [friendRequests, setFriendRequests] =
    useState<FriendRequestMailbox>(EMPTY_REQUESTS);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(
    null,
  );
  const selectedConversationRef = useRef<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const messageScrollRef = useRef<HTMLDivElement | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const [socketStatus, setSocketStatus] = useState<SocketStatus>("offline");
  const [sidebarView, setSidebarView] = useState<SidebarView>("chats");
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [lookupQuery, setLookupQuery] = useState("");
  const [lookupResult, setLookupResult] = useState<Account | null>(null);
  const [requestMessage, setRequestMessage] = useState("");
  const [groupCreateOpen, setGroupCreateOpen] = useState(false);
  const [groupName, setGroupName] = useState("");
  const [groupContactIds, setGroupContactIds] = useState<string[]>([]);
  const [groupManageOpen, setGroupManageOpen] = useState(false);
  const [groupDetails, setGroupDetails] = useState<GroupDetails | null>(null);
  const groupDetailsRef = useRef<GroupDetails | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const accessToken = session?.access_token ?? null;
  const activeAccount = session?.account ?? null;

  const accountById = useMemo(() => {
    const map = new Map<string, Account>();
    for (const account of knownAccounts) map.set(account.account_id, account);
    for (const account of contacts) map.set(account.account_id, account);
    for (const request of friendRequests.incoming) {
      map.set(request.peer.account_id, request.peer);
    }
    for (const request of friendRequests.outgoing) {
      map.set(request.peer.account_id, request.peer);
    }
    if (lookupResult) map.set(lookupResult.account_id, lookupResult);
    if (activeAccount) map.set(activeAccount.account_id, activeAccount);
    return map;
  }, [activeAccount, contacts, friendRequests, knownAccounts, lookupResult]);

  const selectedConversation = useMemo(
    () =>
      conversations.find(
        (conversation) => conversation.conversation_id === selectedConversationId,
      ) ?? null,
    [conversations, selectedConversationId],
  );

  const selectedPeer =
    selectedConversation?.kind === "direct" && selectedConversation.peer_account_id
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
    setContacts([]);
    setKnownAccounts([]);
    setFriendRequests(EMPTY_REQUESTS);
    setConversations([]);
    setMessages([]);
    setSelectedConversationId(null);
    setSocketStatus("offline");
  }, []);

  const mergeKnownAccounts = useCallback((accounts: Account[]) => {
    setKnownAccounts((current) => {
      const merged = new Map(current.map((account) => [account.account_id, account]));
      for (const account of accounts) merged.set(account.account_id, account);
      return [...merged.values()];
    });
  }, []);

  const refreshSocial = useCallback(
    async (token: string) => {
      const [nextContacts, nextRequests] = await Promise.all([
        listContacts(token),
        listFriendRequests(token),
      ]);
      setContacts(nextContacts);
      setFriendRequests(nextRequests);
      mergeKnownAccounts([
        ...nextContacts,
        ...nextRequests.incoming.map((request) => request.peer),
        ...nextRequests.outgoing.map((request) => request.peer),
      ]);
    },
    [mergeKnownAccounts],
  );

  const refreshConversations = useCallback(async (token: string) => {
    setConversations(await listConversations(token));
  }, []);

  const reportError = useCallback(
    (reason: unknown) => {
      if (reason instanceof ApiError && reason.status === 401) clearSession();
      setError(readableError(reason));
    },
    [clearSession],
  );

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
        if (!cancelled) saveSession({ ...session, account });
      })
      .catch((reason) => {
        if (!cancelled) {
          clearSession();
          setError(readableError(reason));
        }
      })
      .finally(() => {
        if (!cancelled) setAuthChecking(false);
      });
    return () => {
      cancelled = true;
    };
    // accessToken is the stable identity of the session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken]);

  useEffect(() => {
    selectedConversationRef.current = selectedConversationId;
  }, [selectedConversationId]);

  useEffect(() => {
    groupDetailsRef.current = groupDetails;
  }, [groupDetails]);

  useEffect(() => {
    if (!accessToken || !activeAccount) return;
    setError(null);
    void Promise.all([
      refreshSocial(accessToken),
      refreshConversations(accessToken),
    ]).catch(reportError);

    const stopSocket = connectChatSocket(accessToken, {
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
          async () => {
            await refreshSocial(accessToken);
            const openGroup = groupDetailsRef.current;
            if (openGroup && event.type === "group_updated") {
              try {
                setGroupDetails(await getGroup(accessToken, openGroup.group_id));
              } catch {
                setGroupDetails(null);
                setGroupManageOpen(false);
              }
            }
          },
        ).catch(reportError);
      },
    });

    const poll = window.setInterval(() => {
      void Promise.all([
        refreshSocial(accessToken),
        refreshConversations(accessToken),
      ]).catch(() => undefined);
    }, 5_000);

    return () => {
      stopSocket();
      window.clearInterval(poll);
    };
  }, [
    accessToken,
    activeAccount,
    appendMessage,
    refreshConversations,
    refreshSocial,
    reportError,
  ]);

  useEffect(() => {
    if (!accessToken || !selectedConversationId) {
      setMessages([]);
      return;
    }
    let cancelled = false;
    void listMessages(accessToken, selectedConversationId)
      .then((next) => {
        if (!cancelled) setMessages(next);
      })
      .then(() => markConversationRead(accessToken, selectedConversationId))
      .then(() => refreshConversations(accessToken))
      .catch((reason) => {
        if (!cancelled) reportError(reason);
      });
    return () => {
      cancelled = true;
    };
  }, [accessToken, refreshConversations, reportError, selectedConversationId]);

  useEffect(() => {
    if (
      !accessToken ||
      selectedConversation?.kind !== "group" ||
      !selectedConversation.group_id
    ) {
      return;
    }
    let cancelled = false;
    void loadGroupWithAccounts(accessToken, selectedConversation.group_id)
      .then((details) => {
        if (!cancelled) setGroupDetails(details);
      })
      .catch(reportError);
    return () => {
      cancelled = true;
    };
  }, [accessToken, reportError, selectedConversation]);

  useLayoutEffect(() => {
    const composer = composerRef.current;
    if (!composer) return;
    composer.style.height = "auto";
    composer.style.height = `${Math.min(composer.scrollHeight, MAX_COMPOSER_HEIGHT)}px`;
    composer.style.overflowY =
      composer.scrollHeight > MAX_COMPOSER_HEIGHT ? "auto" : "hidden";
  }, [draft]);

  useLayoutEffect(() => {
    const scroller = messageScrollRef.current;
    if (scroller) scroller.scrollTop = scroller.scrollHeight;
  }, [messages, selectedConversationId]);

  async function loadGroupWithAccounts(token: string, groupId: string) {
    const details = await getGroup(token, groupId);
    const missing = details.members
      .map((member) => member.account_id)
      .filter((accountId) => !accountById.has(accountId));
    if (missing.length > 0) {
      const loaded = await Promise.all(
        missing.map((accountId) => getAccount(token, accountId)),
      );
      mergeKnownAccounts(loaded);
    }
    return details;
  }

  async function openDirectConversation(peerAccountId: string) {
    if (!accessToken) return;
    setBusy(true);
    setError(null);
    try {
      const conversation = await createDirectConversation(accessToken, peerAccountId);
      await refreshConversations(accessToken);
      setSelectedConversationId(conversation.conversation_id);
      setSidebarView("chats");
    } catch (reason) {
      reportError(reason);
    } finally {
      setBusy(false);
    }
  }

  async function submitMessage() {
    if (!accessToken || !selectedConversationId || !draft.trim() || busy) return;
    const body = draft.trim();
    setDraft("");
    setBusy(true);
    try {
      const created = await sendMessage(
        accessToken,
        selectedConversationId,
        body,
        crypto.randomUUID(),
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

  async function performLookup() {
    if (!accessToken || !lookupQuery.trim()) return;
    setBusy(true);
    setLookupResult(null);
    setError(null);
    try {
      const account = await lookupAccount(accessToken, lookupQuery);
      setLookupResult(account);
      setRequestMessage(formatTemplate(t.defaultRequest, activeAccount?.display_name ?? ""));
      mergeKnownAccounts([account]);
    } catch (reason) {
      reportError(reason);
    } finally {
      setBusy(false);
    }
  }

  async function performFriendRequest() {
    if (!accessToken || !lookupResult || !requestMessage.trim()) return;
    setBusy(true);
    try {
      await sendFriendRequest(
        accessToken,
        lookupResult.account_id,
        requestMessage.trim(),
      );
      setNotice(t.requestSent);
      setLookupResult(null);
      setLookupQuery("");
      await refreshSocial(accessToken);
    } catch (reason) {
      reportError(reason);
    } finally {
      setBusy(false);
    }
  }

  async function performRequestResponse(
    requestId: string,
    response: "accept" | "reject",
  ) {
    if (!accessToken) return;
    setBusy(true);
    try {
      await respondFriendRequest(accessToken, requestId, response);
      await refreshSocial(accessToken);
    } catch (reason) {
      reportError(reason);
    } finally {
      setBusy(false);
    }
  }

  async function performCreateGroup() {
    if (!accessToken || !groupName.trim()) return;
    setBusy(true);
    try {
      const group = await createGroup(accessToken, groupName.trim(), groupContactIds);
      await refreshConversations(accessToken);
      setSelectedConversationId(group.conversation_id);
      setGroupDetails(group);
      setGroupCreateOpen(false);
      setGroupName("");
      setGroupContactIds([]);
      setSidebarView("chats");
    } catch (reason) {
      reportError(reason);
    } finally {
      setBusy(false);
    }
  }

  async function refreshOpenGroup() {
    if (!accessToken || !groupDetails) return;
    setGroupDetails(await loadGroupWithAccounts(accessToken, groupDetails.group_id));
    await refreshConversations(accessToken);
  }

  async function performAddGroupMember(accountId: string) {
    if (!accessToken || !groupDetails) return;
    setBusy(true);
    try {
      await addGroupMember(accessToken, groupDetails.group_id, accountId);
      await refreshOpenGroup();
    } catch (reason) {
      reportError(reason);
    } finally {
      setBusy(false);
    }
  }

  async function performRemoveGroupMember(accountId: string) {
    if (!accessToken || !groupDetails) return;
    setBusy(true);
    try {
      await removeGroupMember(accessToken, groupDetails.group_id, accountId);
      await refreshOpenGroup();
    } catch (reason) {
      reportError(reason);
    } finally {
      setBusy(false);
    }
  }

  async function performRoleChange(
    accountId: string,
    role: Exclude<GroupRole, "owner">,
  ) {
    if (!accessToken || !groupDetails) return;
    setBusy(true);
    try {
      await setGroupMemberRole(accessToken, groupDetails.group_id, accountId, role);
      await refreshOpenGroup();
    } catch (reason) {
      reportError(reason);
    } finally {
      setBusy(false);
    }
  }

  async function performDissolveGroup() {
    if (!accessToken || !groupDetails || !window.confirm(t.dissolveConfirm)) return;
    setBusy(true);
    try {
      await dissolveGroup(accessToken, groupDetails.group_id);
      setGroupManageOpen(false);
      setGroupDetails(null);
      setSelectedConversationId(null);
      await refreshConversations(accessToken);
    } catch (reason) {
      reportError(reason);
    } finally {
      setBusy(false);
    }
  }

  async function copyValue(label: string, value: string) {
    await navigator.clipboard.writeText(value);
    setCopied(label);
    window.setTimeout(() => setCopied(null), 1_200);
  }

  async function performLogout() {
    if (accessToken) {
      try {
        await logoutAccount(accessToken);
      } catch {
        // Clear the local session even when the local service is unavailable.
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
          onLogin={async (name, password) => {
            setBusy(true);
            setError(null);
            try {
              saveSession(await loginAccount({ username: name, password }));
            } catch (reason) {
              setError(readableError(reason));
            } finally {
              setBusy(false);
            }
          }}
          onRegister={async (name, password) => {
            setBusy(true);
            setError(null);
            try {
              saveSession(
                await registerAccount({
                  username: name,
                  displayName: name,
                  password,
                }),
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

  const pendingIncoming = friendRequests.incoming.filter(
    (request) => request.status === "pending",
  ).length;

  return (
    <main className="chat-shell">
      <aside className="sidebar">
        <header className="account-header">
          <div className="avatar">{initials(activeAccount.display_name)}</div>
          <div className="account-copy">
            <strong>{activeAccount.display_name}</strong>
            <span>{activeAccount.chat_id}</span>
          </div>
          <div className="account-actions">
            <button
              className="icon-button"
              type="button"
              title={t.settings}
              onClick={() => setSettingsOpen(true)}
            >
              <SettingsIcon />
            </button>
            <button
              className="icon-button"
              type="button"
              title={t.logout}
              onClick={() => void performLogout()}
            >
              ⎋
            </button>
          </div>
        </header>

        <div className="identity-strip">
          <button onClick={() => void copyValue("chat", activeAccount.chat_id)}>
            <span>{t.chatId}</span>
            <strong>{activeAccount.chat_id}</strong>
            <small>{copied === "chat" ? t.copied : t.copy}</small>
          </button>
          <button onClick={() => void copyValue("uuid", activeAccount.account_id)}>
            <span>{t.accountUuid}</span>
            <strong>{shortUuid(activeAccount.account_id)}</strong>
            <small>{copied === "uuid" ? t.copied : t.copy}</small>
          </button>
        </div>

        <div className="connection-strip">
          <span className={`status-dot ${socketStatus}`} />
          <span>{socketStatusLabel(socketStatus, t)}</span>
          <span className="backend-state">
            {t.rustCore}: {backend}
          </span>
        </div>

        <nav className="sidebar-tabs">
          <button
            className={sidebarView === "chats" ? "active" : ""}
            onClick={() => setSidebarView("chats")}
          >
            {t.chats}
          </button>
          <button
            className={sidebarView === "contacts" ? "active" : ""}
            onClick={() => setSidebarView("contacts")}
          >
            {t.contacts}
          </button>
          <button
            className={sidebarView === "requests" ? "active" : ""}
            onClick={() => setSidebarView("requests")}
          >
            {t.requests}
            {pendingIncoming > 0 && <span className="tab-badge">{pendingIncoming}</span>}
          </button>
        </nav>

        <div className="sidebar-content">
          {sidebarView === "chats" && (
            <ChatsView
              conversations={conversations}
              selectedConversationId={selectedConversationId}
              accountById={accountById}
              locale={locale}
              t={t}
              onSelect={setSelectedConversationId}
              onCreateGroup={() => setGroupCreateOpen(true)}
            />
          )}

          {sidebarView === "contacts" && (
            <ContactsView
              contacts={contacts}
              lookupQuery={lookupQuery}
              lookupResult={lookupResult}
              requestMessage={requestMessage}
              busy={busy}
              t={t}
              onLookupQuery={setLookupQuery}
              onLookup={() => void performLookup()}
              onRequestMessage={setRequestMessage}
              onSendRequest={() => void performFriendRequest()}
              onChat={(accountId) => void openDirectConversation(accountId)}
            />
          )}

          {sidebarView === "requests" && (
            <RequestsView
              mailbox={friendRequests}
              busy={busy}
              t={t}
              onRespond={(requestId, response) =>
                void performRequestResponse(requestId, response)
              }
            />
          )}
        </div>
      </aside>

      <section className="chat-panel">
        {selectedConversation ? (
          <>
            <header className="chat-header">
              <div>
                <h1>
                  {selectedConversation.kind === "group"
                    ? selectedConversation.group_name
                    : selectedPeer?.display_name ?? t.conversation}
                </h1>
                <p>
                  {selectedConversation.kind === "group"
                    ? `${t.groupCode}: ${selectedConversation.group_code} · ${selectedConversation.member_count ?? 0} ${t.members}`
                    : selectedPeer?.chat_id ?? selectedConversation.peer_account_id}
                </p>
              </div>
              <div className="chat-header-actions">
                {selectedConversation.kind === "group" && (
                  <button
                    className="secondary-button"
                    onClick={() => setGroupManageOpen(true)}
                  >
                    {t.groupSettings}
                  </button>
                )}
                <span className="dev-pill">{t.plaintextDev}</span>
              </div>
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
                  messages.map((message) => {
                    const sender = accountById.get(message.sender_account_id);
                    const mine = message.sender_account_id === activeAccount.account_id;
                    return (
                      <div
                        key={message.message_id}
                        className={`message-row ${mine ? "mine" : ""}`}
                      >
                        <div className="message-bubble">
                          {selectedConversation.kind === "group" && !mine && (
                            <strong className="message-sender">
                              {sender?.display_name ?? shortUuid(message.sender_account_id)}
                            </strong>
                          )}
                          <p>{message.body}</p>
                          <time>{formatClock(message.created_at)}</time>
                        </div>
                      </div>
                    );
                  })
                )}
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
        {notice && (
          <button className="notice-banner" onClick={() => setNotice(null)}>
            <span>✓</span>
            <span>{notice}</span>
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

      {groupCreateOpen && (
        <Modal title={t.createGroup} onClose={() => setGroupCreateOpen(false)} t={t}>
          <label className="modal-field">
            {t.groupName}
            <input
              value={groupName}
              onChange={(event) => setGroupName(event.target.value)}
              maxLength={64}
              autoFocus
            />
          </label>
          <div className="modal-section-title">{t.chooseContacts}</div>
          <div className="contact-picker">
            {contacts.length === 0 ? (
              <p className="empty-small">{t.noContacts}</p>
            ) : (
              contacts.map((account) => (
                <label key={account.account_id} className="contact-check">
                  <input
                    type="checkbox"
                    checked={groupContactIds.includes(account.account_id)}
                    onChange={(event) => {
                      setGroupContactIds((current) =>
                        event.target.checked
                          ? [...current, account.account_id]
                          : current.filter((id) => id !== account.account_id),
                      );
                    }}
                  />
                  <span className="mini-avatar">{initials(account.display_name)}</span>
                  <span>
                    <strong>{account.display_name}</strong>
                    <small>{account.chat_id}</small>
                  </span>
                </label>
              ))
            )}
          </div>
          <div className="modal-actions">
            <button className="secondary-button" onClick={() => setGroupCreateOpen(false)}>
              {t.cancel}
            </button>
            <button
              className="primary-button"
              disabled={busy || !groupName.trim()}
              onClick={() => void performCreateGroup()}
            >
              {t.create}
            </button>
          </div>
        </Modal>
      )}

      {groupManageOpen && groupDetails && (
        <GroupManagement
          details={groupDetails}
          contacts={contacts}
          accountById={accountById}
          activeAccountId={activeAccount.account_id}
          busy={busy}
          t={t}
          onClose={() => setGroupManageOpen(false)}
          onAdd={(accountId) => void performAddGroupMember(accountId)}
          onRemove={(accountId) => void performRemoveGroupMember(accountId)}
          onRole={(accountId, role) => void performRoleChange(accountId, role)}
          onDissolve={() => void performDissolveGroup()}
        />
      )}
    </main>
  );
}

function AuthScreen(props: {
  busy: boolean;
  error: string | null;
  t: Translation;
  onOpenSettings(): void;
  onLogin(name: string, password: string): Promise<void>;
  onRegister(name: string, password: string): Promise<void>;
}) {
  const [screen, setScreen] = useState<"login" | "register">("login");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  function changeScreen(next: "login" | "register") {
    setScreen(next);
    setPassword("");
    setConfirmPassword("");
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
      <section className="onboarding-card simple-auth-card">
        <p className="eyebrow">
          {props.t.appName} · {props.t.localDevelopment}
        </p>
        <h1>{screen === "login" ? props.t.welcomeBack : props.t.createAccount}</h1>
        <p className="onboarding-intro">
          {screen === "login" ? props.t.loginIntro : props.t.registerIntro}
        </p>

        <form
          className="simple-auth-form"
          onSubmit={(event) => {
            event.preventDefault();
            setLocalError(null);
            const normalizedName = name.trim();
            if (!normalizedName) return;
            if (screen === "register") {
              if (password !== confirmPassword) {
                setLocalError(props.t.passwordsMismatch);
                return;
              }
              void props.onRegister(normalizedName, password);
            } else {
              void props.onLogin(normalizedName, password);
            }
          }}
        >
          <label>
            {props.t.name}
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={props.t.name}
              minLength={3}
              maxLength={32}
              pattern="[A-Za-z0-9_]+"
              autoComplete="username"
              autoFocus
              required
            />
            {screen === "register" && <small>{props.t.nameHint}</small>}
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
              autoComplete={screen === "login" ? "current-password" : "new-password"}
              required
            />
            {screen === "register" && <small>{props.t.passwordHint}</small>}
          </label>
          {screen === "register" && (
            <label>
              {props.t.confirmPassword}
              <input
                type="password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                placeholder={props.t.confirmPassword}
                minLength={8}
                maxLength={128}
                autoComplete="new-password"
                required
              />
            </label>
          )}
          <button className="primary-button auth-submit" disabled={props.busy}>
            {props.busy
              ? props.t.pleaseWait
              : screen === "login"
                ? props.t.login
                : props.t.createAccount}
          </button>
        </form>

        <button
          className="auth-link"
          type="button"
          onClick={() => changeScreen(screen === "login" ? "register" : "login")}
        >
          {screen === "login" ? props.t.noAccount : props.t.haveAccount}{" "}
          <strong>
            {screen === "login" ? props.t.clickRegister : props.t.backToLogin}
          </strong>
        </button>

        {(localError || props.error) && (
          <p className="form-error">{localError ?? props.error}</p>
        )}
      </section>
    </main>
  );
}

function ChatsView(props: {
  conversations: Conversation[];
  selectedConversationId: string | null;
  accountById: Map<string, Account>;
  locale: Locale;
  t: Translation;
  onSelect(id: string): void;
  onCreateGroup(): void;
}) {
  return (
    <div className="view-stack">
      <div className="view-toolbar">
        <strong>{props.t.conversations}</strong>
        <button className="small-primary" onClick={props.onCreateGroup}>
          + {props.t.createGroup}
        </button>
      </div>
      <div className="conversation-list">
        {props.conversations.length === 0 ? (
          <p className="empty-sidebar">{props.t.noConversations}</p>
        ) : (
          props.conversations.map((conversation) => {
            const peer = conversation.peer_account_id
              ? props.accountById.get(conversation.peer_account_id)
              : undefined;
            const title =
              conversation.kind === "group"
                ? conversation.group_name ?? props.t.group
                : peer?.display_name ?? props.t.unknownUser;
            const subtitle =
              conversation.kind === "group"
                ? conversation.group_code
                : peer?.chat_id;
            return (
              <button
                key={conversation.conversation_id}
                className={`conversation-row ${
                  conversation.conversation_id === props.selectedConversationId
                    ? "selected"
                    : ""
                }`}
                onClick={() => props.onSelect(conversation.conversation_id)}
              >
                <span className={`mini-avatar ${conversation.kind === "group" ? "group" : ""}`}>
                  {conversation.kind === "group" ? "群" : initials(title)}
                </span>
                <span className="conversation-copy">
                  <span className="conversation-topline">
                    <strong>{title}</strong>
                    <time>{relativeTime(conversation.last_message_at, props.locale)}</time>
                  </span>
                  <span className="conversation-preview">
                    {conversation.last_message?.body ?? subtitle ?? props.t.noMessagesYet}
                  </span>
                </span>
                {conversation.unread_count > 0 && (
                  <span className="unread-badge">
                    {conversation.unread_count > 99 ? "99+" : conversation.unread_count}
                  </span>
                )}
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

function ContactsView(props: {
  contacts: Account[];
  lookupQuery: string;
  lookupResult: Account | null;
  requestMessage: string;
  busy: boolean;
  t: Translation;
  onLookupQuery(value: string): void;
  onLookup(): void;
  onRequestMessage(value: string): void;
  onSendRequest(): void;
  onChat(accountId: string): void;
}) {
  return (
    <div className="view-stack">
      <section className="add-friend-card">
        <div className="view-toolbar"><strong>{props.t.addFriend}</strong></div>
        <form
          className="exact-search"
          onSubmit={(event) => {
            event.preventDefault();
            props.onLookup();
          }}
        >
          <input
            value={props.lookupQuery}
            onChange={(event) => props.onLookupQuery(event.target.value)}
            placeholder={props.t.searchById}
          />
          <button className="small-primary" disabled={props.busy || !props.lookupQuery.trim()}>
            {props.t.search}
          </button>
        </form>
        <small className="hint-text">{props.t.exactSearchOnly}</small>
        {props.lookupResult && (
          <div className="lookup-card">
            <div className="person-line">
              <span className="mini-avatar">{initials(props.lookupResult.display_name)}</span>
              <span>
                <strong>{props.lookupResult.display_name}</strong>
                <small>{props.lookupResult.chat_id}</small>
              </span>
            </div>
            <label>
              {props.t.requestMessage}
              <textarea
                value={props.requestMessage}
                onChange={(event) => props.onRequestMessage(event.target.value)}
                maxLength={240}
                rows={3}
              />
            </label>
            <button
              className="primary-button"
              disabled={props.busy || !props.requestMessage.trim()}
              onClick={props.onSendRequest}
            >
              {props.t.sendRequest}
            </button>
          </div>
        )}
      </section>

      <div className="view-toolbar"><strong>{props.t.contacts}</strong><span>{props.contacts.length}</span></div>
      <div className="contact-list">
        {props.contacts.length === 0 ? (
          <p className="empty-sidebar">{props.t.noContacts}</p>
        ) : (
          props.contacts.map((account) => (
            <div className="contact-row" key={account.account_id}>
              <span className="mini-avatar">{initials(account.display_name)}</span>
              <span className="contact-copy">
                <strong>{account.display_name}</strong>
                <small>{account.chat_id}</small>
              </span>
              <button className="small-primary" onClick={() => props.onChat(account.account_id)}>
                {props.t.startChat}
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function RequestsView(props: {
  mailbox: FriendRequestMailbox;
  busy: boolean;
  t: Translation;
  onRespond(requestId: string, response: "accept" | "reject"): void;
}) {
  const incoming = props.mailbox.incoming.filter((request) => request.status === "pending");
  return (
    <div className="view-stack requests-view">
      <div className="view-toolbar"><strong>{props.t.incomingRequests}</strong><span>{incoming.length}</span></div>
      {incoming.length === 0 ? (
        <p className="empty-sidebar">{props.t.noRequests}</p>
      ) : (
        incoming.map((request) => (
          <div className="request-card" key={request.request_id}>
            <div className="person-line">
              <span className="mini-avatar">{initials(request.peer.display_name)}</span>
              <span><strong>{request.peer.display_name}</strong><small>{request.peer.chat_id}</small></span>
            </div>
            <p>{request.message}</p>
            <div className="request-actions">
              <button className="secondary-button" disabled={props.busy} onClick={() => props.onRespond(request.request_id, "reject")}>{props.t.reject}</button>
              <button className="primary-button" disabled={props.busy} onClick={() => props.onRespond(request.request_id, "accept")}>{props.t.accept}</button>
            </div>
          </div>
        ))
      )}
      <div className="view-toolbar"><strong>{props.t.outgoingRequests}</strong><span>{props.mailbox.outgoing.length}</span></div>
      {props.mailbox.outgoing.map((request) => (
        <div className="request-card compact" key={request.request_id}>
          <div className="person-line">
            <span className="mini-avatar">{initials(request.peer.display_name)}</span>
            <span><strong>{request.peer.display_name}</strong><small>{request.peer.chat_id}</small></span>
          </div>
          <p>{request.message}</p>
          <small className={`request-status ${request.status}`}>{statusLabel(request.status, props.t)}</small>
        </div>
      ))}
    </div>
  );
}

function GroupManagement(props: {
  details: GroupDetails;
  contacts: Account[];
  accountById: Map<string, Account>;
  activeAccountId: string;
  busy: boolean;
  t: Translation;
  onClose(): void;
  onAdd(accountId: string): void;
  onRemove(accountId: string): void;
  onRole(accountId: string, role: Exclude<GroupRole, "owner">): void;
  onDissolve(): void;
}) {
  const memberIds = new Set(props.details.members.map((member) => member.account_id));
  const availableContacts = props.contacts.filter((contact) => !memberIds.has(contact.account_id));
  const canRemove = props.details.actor_role === "owner" || props.details.actor_role === "admin";
  return (
    <Modal title={props.t.groupSettings} onClose={props.onClose} t={props.t} wide>
      <div className="group-summary">
        <div className="avatar large group">群</div>
        <div><h3>{props.details.name}</h3><p>{props.t.groupCode}: {props.details.group_code}</p></div>
      </div>
      <p className="permission-note">
        {props.details.actor_role === "owner"
          ? props.t.ownerPermissions
          : props.details.actor_role === "admin"
            ? props.t.adminPermissions
            : props.t.memberPermissions}
      </p>
      <div className="modal-section-title">{props.t.addMember}</div>
      {availableContacts.length === 0 ? (
        <p className="empty-small">{props.t.noContacts}</p>
      ) : (
        <div className="add-member-grid">
          {availableContacts.map((contact) => (
            <button key={contact.account_id} disabled={props.busy} onClick={() => props.onAdd(contact.account_id)}>
              <span className="mini-avatar">{initials(contact.display_name)}</span>
              <span><strong>{contact.display_name}</strong><small>{contact.chat_id}</small></span>
              <b>＋</b>
            </button>
          ))}
        </div>
      )}
      <div className="modal-section-title">{props.t.members} · {props.details.members.length}</div>
      <div className="member-list">
        {props.details.members.map((member) => {
          const account = props.accountById.get(member.account_id);
          const isSelf = member.account_id === props.activeAccountId;
          const canRemoveTarget =
            canRemove &&
            member.role !== "owner" &&
            !isSelf &&
            !(props.details.actor_role === "admin" && member.role === "admin");
          return (
            <div className="member-row" key={member.account_id}>
              <span className="mini-avatar">{initials(account?.display_name ?? member.account_id)}</span>
              <span className="contact-copy"><strong>{account?.display_name ?? shortUuid(member.account_id)}</strong><small>{account?.chat_id ?? shortUuid(member.account_id)}</small></span>
              <span className={`role-chip ${member.role}`}>{roleLabel(member.role, props.t)}</span>
              {props.details.actor_role === "owner" && member.role !== "owner" && (
                <button className="text-button" disabled={props.busy} onClick={() => props.onRole(member.account_id, member.role === "admin" ? "member" : "admin")}>
                  {member.role === "admin" ? props.t.removeAdmin : props.t.setAdmin}
                </button>
              )}
              {canRemoveTarget && (
                <button className="danger-text-button" disabled={props.busy} onClick={() => props.onRemove(member.account_id)}>{props.t.remove}</button>
              )}
            </div>
          );
        })}
      </div>
      {props.details.actor_role === "owner" && (
        <button className="danger-button" disabled={props.busy} onClick={props.onDissolve}>{props.t.dissolveGroup}</button>
      )}
    </Modal>
  );
}

function Modal(props: {
  title: string;
  children: ReactNode;
  onClose(): void;
  t: Translation;
  wide?: boolean;
}) {
  return (
    <div className="modal-overlay" role="presentation" onMouseDown={props.onClose}>
      <section className={`modal-card ${props.wide ? "wide" : ""}`} role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
        <header className="modal-header"><h2>{props.title}</h2><button className="icon-button" onClick={props.onClose} title={props.t.close}>×</button></header>
        <div className="modal-body">{props.children}</div>
      </section>
    </div>
  );
}

function LoadingScreen({ t, onOpenSettings }: { t: Translation; onOpenSettings(): void }) {
  return (
    <main className="onboarding-shell">
      <button className="onboarding-settings-button" type="button" onClick={onOpenSettings}><SettingsIcon /><span>{t.settings}</span></button>
      <section className="onboarding-card loading-card"><p className="eyebrow">{t.appName}</p><h1>{t.restoringSession}</h1></section>
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
  refreshExtended: () => Promise<void>,
) {
  if (event.type === "connected") {
    await refreshConversations(accessToken);
    if (selectedConversationId) {
      replaceMessages(await listMessages(accessToken, selectedConversationId));
      await markConversationRead(accessToken, selectedConversationId);
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
    return;
  }
  if (event.type === "group_updated") {
    await refreshExtended();
    return;
  }
  await refreshConversations(accessToken);
}

function readStoredSession(): AuthSession | null {
  const raw = localStorage.getItem(AUTH_SESSION_KEY);
  if (!raw) return null;
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
  if (reason instanceof ApiError) return `${reason.message} (${reason.code})`;
  if (reason instanceof Error) return reason.message;
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

function shortUuid(value: string): string {
  return value.length > 12 ? `${value.slice(0, 8)}…${value.slice(-4)}` : value;
}

function socketStatusLabel(status: SocketStatus, t: Translation): string {
  if (status === "online") return t.realtimeConnected;
  if (status === "connecting") return t.realtimeConnecting;
  return t.realtimeOffline;
}

function relativeTime(value: string | null, locale: Locale): string {
  if (!value) return "";
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return "";
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
  return new Date(value).toLocaleDateString(locale, { month: "short", day: "numeric" });
}

function formatClock(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString(document.documentElement.lang || undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatTemplate(template: string, value: string): string {
  return template.replace("{0}", value);
}

function statusLabel(status: string, t: Translation): string {
  if (status === "accepted") return t.accepted;
  if (status === "rejected") return t.rejected;
  return t.pending;
}

function roleLabel(role: GroupRole, t: Translation): string {
  if (role === "owner") return t.roleOwner;
  if (role === "admin") return t.roleAdmin;
  return t.roleMember;
}
