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
  getContact,
  getCurrentAccount,
  getGroup,
  listCommonGroups,
  listContacts,
  listConversations,
  listFriendRequests,
  listGroupJoinRequests,
  listMessages,
  loginAccount,
  logoutAccount,
  lookupAccount,
  lookupGroup,
  markConversationRead,
  registerAccount,
  removeGroupMember,
  requestToJoinGroup,
  respondFriendRequest,
  respondGroupJoinRequest,
  sendFriendRequest,
  sendMessage,
  setGroupMemberRole,
  updateAvatar,
  updateContactRemark,
} from "../lib/api";
import type {
  Account,
  AuthSession,
  ChatMessage,
  CommonGroup,
  Conversation,
  FriendRequestMailbox,
  GroupDetails,
  GroupDiscovery,
  GroupJoinRequest,
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
import {
  ChatIcon,
  ChevronIcon,
  ContactsIcon,
  FriendRequestIcon,
  GroupIcon,
  MenuIcon,
  PlusIcon,
  SearchIcon,
  SettingsIcon,
} from "./PreferenceIcons";
import { SettingsPanel } from "./SettingsPanel";
import { ContactProfile } from "./ContactProfile";
import { UserAvatar as Avatar } from "./UserAvatar";

const AUTH_SESSION_KEY = "chat.auth.session.v1";
const MAX_COMPOSER_HEIGHT = 132;
const EMPTY_REQUESTS: FriendRequestMailbox = { incoming: [], outgoing: [] };

type PrimaryView = "chats" | "contacts";
type DiscoveryMode = "friend" | "group";
type ChatListEntry =
  | { kind: "conversation"; conversation: Conversation; peer?: Account }
  | { kind: "contact"; contact: Account };

export function App() {
  const [backend, setBackend] = useState("checking");
  const [locale, setLocale] = useState<Locale>(readStoredLocale);
  const [theme, setTheme] = useState<ThemeMode>(readStoredTheme);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [railMenuOpen, setRailMenuOpen] = useState(false);
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
  const [primaryView, setPrimaryView] = useState<PrimaryView>("chats");
  const [selectedContactId, setSelectedContactId] = useState<string | null>(null);
  const [selectedContact, setSelectedContact] = useState<Account | null>(null);
  const [commonGroups, setCommonGroups] = useState<CommonGroup[]>([]);
  const [chatSearch, setChatSearch] = useState("");
  const [groupsExpanded, setGroupsExpanded] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [discoveryOpen, setDiscoveryOpen] = useState(false);
  const [discoveryMode, setDiscoveryMode] = useState<DiscoveryMode>("friend");
  const [lookupQuery, setLookupQuery] = useState("");
  const [lookupResult, setLookupResult] = useState<Account | null>(null);
  const [requestMessage, setRequestMessage] = useState("");
  const [groupLookupResult, setGroupLookupResult] = useState<GroupDiscovery | null>(
    null,
  );
  const [groupJoinMessage, setGroupJoinMessage] = useState("");

  const [requestsOpen, setRequestsOpen] = useState(false);
  const [groupCreateOpen, setGroupCreateOpen] = useState(false);
  const [groupName, setGroupName] = useState("");
  const [groupContactIds, setGroupContactIds] = useState<string[]>([]);
  const [groupManageOpen, setGroupManageOpen] = useState(false);
  const [groupDetails, setGroupDetails] = useState<GroupDetails | null>(null);
  const groupDetailsRef = useRef<GroupDetails | null>(null);
  const [groupJoinRequests, setGroupJoinRequests] = useState<GroupJoinRequest[]>([]);
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

  const accountByIdRef = useRef(accountById);
  const groupManageOpenRef = useRef(groupManageOpen);

  useEffect(() => {
    accountByIdRef.current = accountById;
  }, [accountById]);

  useEffect(() => {
    groupManageOpenRef.current = groupManageOpen;
  }, [groupManageOpen]);

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

  const directConversationByPeer = useMemo(() => {
    const map = new Map<string, Conversation>();
    for (const conversation of conversations) {
      if (conversation.kind === "direct" && conversation.peer_account_id) {
        map.set(conversation.peer_account_id, conversation);
      }
    }
    return map;
  }, [conversations]);

  const groupConversations = useMemo(
    () => conversations.filter((conversation) => conversation.kind === "group"),
    [conversations],
  );

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
    setSelectedContactId(null);
    setSelectedContact(null);
    setCommonGroups([]);
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
    // accessToken is the stable session identity.
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
                const details = await loadGroupWithAccounts(
                  accessToken,
                  openGroup.group_id,
                  accountByIdRef.current,
                  mergeKnownAccounts,
                );
                setGroupDetails(details);
                if (groupManageOpenRef.current && details.actor_role !== "member") {
                  setGroupJoinRequests(
                    await listGroupJoinRequests(accessToken, details.group_id),
                  );
                }
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
    mergeKnownAccounts,
    refreshConversations,
    refreshSocial,
    reportError,
  ]);

  useEffect(() => {
    if (!accessToken || !selectedContactId) {
      setSelectedContact(null);
      setCommonGroups([]);
      return;
    }
    let cancelled = false;
    void Promise.all([
      getContact(accessToken, selectedContactId),
      listCommonGroups(accessToken, selectedContactId),
    ])
      .then(([contact, groups]) => {
        if (cancelled) return;
        setSelectedContact(contact);
        setCommonGroups(groups);
        mergeKnownAccounts([contact]);
      })
      .catch((reason) => {
        if (!cancelled) reportError(reason);
      });
    return () => {
      cancelled = true;
    };
  }, [accessToken, mergeKnownAccounts, reportError, selectedContactId]);

  useEffect(() => {
    if (!selectedContactId) return;
    const refreshed = contacts.find((account) => account.account_id === selectedContactId);
    if (refreshed) setSelectedContact(refreshed);
  }, [contacts, selectedContactId]);

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
    void loadGroupWithAccounts(
      accessToken,
      selectedConversation.group_id,
      accountById,
      mergeKnownAccounts,
    )
      .then((details) => {
        if (!cancelled) setGroupDetails(details);
      })
      .catch(reportError);
    return () => {
      cancelled = true;
    };
  }, [accessToken, accountById, mergeKnownAccounts, reportError, selectedConversation]);

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

  async function openDirectConversation(peerAccountId: string) {
    if (!accessToken) return;
    const existing = directConversationByPeer.get(peerAccountId);
    if (existing) {
      setSelectedConversationId(existing.conversation_id);
      setSelectedContactId(null);
      setPrimaryView("chats");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const conversation = await createDirectConversation(accessToken, peerAccountId);
      await refreshConversations(accessToken);
      setSelectedConversationId(conversation.conversation_id);
      setSelectedContactId(null);
      setPrimaryView("chats");
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

  function openDiscovery(mode: DiscoveryMode) {
    setDiscoveryMode(mode);
    setDiscoveryOpen(true);
    setLookupQuery("");
    setLookupResult(null);
    setGroupLookupResult(null);
    setRequestMessage("");
    setGroupJoinMessage("");
    setError(null);
  }

  async function performLookup() {
    if (!accessToken || !lookupQuery.trim()) return;
    setBusy(true);
    setLookupResult(null);
    setGroupLookupResult(null);
    setError(null);
    try {
      if (discoveryMode === "friend") {
        const account = await lookupAccount(accessToken, lookupQuery);
        setLookupResult(account);
        setRequestMessage(
          formatTemplate(t.defaultRequest, activeAccount?.display_name ?? ""),
        );
        mergeKnownAccounts([account]);
      } else {
        const group = await lookupGroup(accessToken, lookupQuery);
        setGroupLookupResult(group);
        setGroupJoinMessage(
          formatTemplate(t.defaultGroupRequest, activeAccount?.display_name ?? ""),
        );
      }
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

  async function performGroupJoinRequest() {
    if (!accessToken || !groupLookupResult || !groupJoinMessage.trim()) return;
    setBusy(true);
    try {
      await requestToJoinGroup(
        accessToken,
        groupLookupResult.group_id,
        groupJoinMessage.trim(),
      );
      setGroupLookupResult({
        ...groupLookupResult,
        join_request_status: "pending",
      });
      setNotice(t.joinRequestSent);
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
      if (response === "accept") {
        await refreshConversations(accessToken);
      }
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
      setPrimaryView("chats");
    } catch (reason) {
      reportError(reason);
    } finally {
      setBusy(false);
    }
  }

  async function openGroupManagement() {
    if (!accessToken || !groupDetails) return;
    setBusy(true);
    try {
      const details = await loadGroupWithAccounts(
        accessToken,
        groupDetails.group_id,
        accountById,
        mergeKnownAccounts,
      );
      setGroupDetails(details);
      if (details.actor_role === "owner" || details.actor_role === "admin") {
        const requests = await listGroupJoinRequests(accessToken, details.group_id);
        setGroupJoinRequests(requests);
        const applicants = await Promise.all(
          requests
            .filter((request) => !accountById.has(request.applicant_account_id))
            .map((request) => getAccount(accessToken, request.applicant_account_id)),
        );
        mergeKnownAccounts(applicants);
      } else {
        setGroupJoinRequests([]);
      }
      setGroupManageOpen(true);
    } catch (reason) {
      reportError(reason);
    } finally {
      setBusy(false);
    }
  }

  async function refreshOpenGroup() {
    if (!accessToken || !groupDetails) return;
    const details = await loadGroupWithAccounts(
      accessToken,
      groupDetails.group_id,
      accountById,
      mergeKnownAccounts,
    );
    setGroupDetails(details);
    if (details.actor_role === "owner" || details.actor_role === "admin") {
      setGroupJoinRequests(await listGroupJoinRequests(accessToken, details.group_id));
    }
    await refreshConversations(accessToken);
  }

  async function performGroupJoinResponse(
    requestId: string,
    response: "accept" | "reject",
  ) {
    if (!accessToken || !groupDetails) return;
    setBusy(true);
    try {
      await respondGroupJoinRequest(
        accessToken,
        groupDetails.group_id,
        requestId,
        response,
      );
      await refreshOpenGroup();
    } catch (reason) {
      reportError(reason);
    } finally {
      setBusy(false);
    }
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

  async function performContactRemark(value: string) {
    if (!accessToken || !selectedContactId) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await updateContactRemark(accessToken, selectedContactId, value);
      setSelectedContact(updated);
      setContacts((current) =>
        current.map((account) =>
          account.account_id === updated.account_id ? updated : account,
        ),
      );
      mergeKnownAccounts([updated]);
    } catch (reason) {
      reportError(reason);
      throw reason;
    } finally {
      setBusy(false);
    }
  }

  async function performAvatarChange(avatarDataUrl: string | null) {
    if (!accessToken || !session) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await updateAvatar(accessToken, avatarDataUrl);
      saveSession({ ...session, account: updated });
      mergeKnownAccounts([updated]);
      setNotice(t.avatarUpdated);
    } catch (reason) {
      reportError(reason);
      throw reason;
    } finally {
      setBusy(false);
    }
  }

  async function performLogout() {
    if (accessToken) {
      try {
        await logoutAccount(accessToken);
      } catch {
        // Always clear the local session.
      }
    }
    clearSession();
    setSettingsOpen(false);
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
    <main className="wechat-shell">
      <aside className="app-rail">
        <button
          className="rail-avatar"
          type="button"
          title={activeAccount.display_name}
          onClick={() => setSettingsOpen(true)}
        >
          <Avatar
            label={activeAccount.display_name}
            avatarUrl={activeAccount.avatar_data_url}
          />
        </button>

        <nav className="rail-nav" aria-label="primary">
          <button
            className={primaryView === "chats" ? "active" : ""}
            type="button"
            title={t.chats}
            onClick={() => {
              setPrimaryView("chats");
              setSelectedContactId(null);
            }}
          >
            <ChatIcon />
            {totalUnread(conversations) > 0 && (
              <span className="rail-badge">{boundedCount(totalUnread(conversations))}</span>
            )}
          </button>
          <button
            className={primaryView === "contacts" ? "active" : ""}
            type="button"
            title={t.addressBook}
            onClick={() => {
              setPrimaryView("contacts");
              setSelectedConversationId(null);
            }}
          >
            <ContactsIcon />
            {pendingIncoming > 0 && (
              <span className="rail-badge">{boundedCount(pendingIncoming)}</span>
            )}
          </button>
        </nav>

        <div className="rail-bottom">
          {railMenuOpen && (
            <div className="rail-menu">
              <button
                type="button"
                onClick={() => {
                  setRailMenuOpen(false);
                  setSettingsOpen(true);
                }}
              >
                <SettingsIcon />
                <span>{t.settings}</span>
              </button>
            </div>
          )}
          <button
            className={railMenuOpen ? "active" : ""}
            type="button"
            title={t.menu}
            onClick={() => setRailMenuOpen((open) => !open)}
          >
            <MenuIcon />
          </button>
        </div>
      </aside>

      <aside className="list-pane">
        <header className="list-pane-header">
          <label className="global-search">
            <SearchIcon />
            <input
              value={chatSearch}
              onChange={(event) => setChatSearch(event.target.value)}
              placeholder={t.searchChats}
            />
          </label>
          <button
            className="square-action"
            type="button"
            title={t.discover}
            onClick={() => openDiscovery("friend")}
          >
            <PlusIcon />
          </button>
        </header>

        {primaryView === "chats" ? (
          <ChatList
            conversations={conversations}
            contacts={contacts}
            accountById={accountById}
            selectedConversationId={selectedConversationId}
            search={chatSearch}
            locale={locale}
            t={t}
            onSelectConversation={setSelectedConversationId}
            onSelectContact={(accountId) => void openDirectConversation(accountId)}
          />
        ) : (
          <AddressBook
            contacts={contacts}
            groups={groupConversations}
            pendingIncoming={pendingIncoming}
            groupsExpanded={groupsExpanded}
            search={chatSearch}
            t={t}
            onToggleGroups={() => setGroupsExpanded((expanded) => !expanded)}
            onOpenRequests={() => setRequestsOpen(true)}
            onOpenDiscovery={() => openDiscovery("friend")}
            onOpenContact={(accountId) => {
              setSelectedContactId(accountId);
              setSelectedConversationId(null);
              setPrimaryView("contacts");
            }}
            onOpenGroup={(conversationId) => {
              setSelectedConversationId(conversationId);
              setSelectedContactId(null);
              setPrimaryView("chats");
            }}
          />
        )}
      </aside>

      <section className="conversation-pane">
        {primaryView === "contacts" && selectedContact ? (
          <ContactProfile
            account={selectedContact}
            commonGroups={commonGroups}
            busy={busy}
            t={t}
            onSaveRemark={performContactRemark}
            onStartChat={() => void openDirectConversation(selectedContact.account_id)}
            onOpenGroup={(conversationId) => {
              setSelectedContactId(null);
              setSelectedConversationId(conversationId);
              setPrimaryView("chats");
            }}
          />
        ) : selectedConversation ? (
          <>
            <header className="conversation-header">
              <div className="conversation-title-block">
                <Avatar
                  label={
                    selectedConversation.kind === "group"
                      ? selectedConversation.group_name ?? t.group
                      : contactDisplayName(selectedPeer) ?? t.unknownUser
                  }
                  avatarUrl={selectedConversation.kind === "direct" ? selectedPeer?.avatar_data_url : null}
                  group={selectedConversation.kind === "group"}
                />
                <span>
                  <h1>
                    {selectedConversation.kind === "group"
                      ? selectedConversation.group_name
                      : contactDisplayName(selectedPeer) ?? t.conversation}
                  </h1>
                  <small>
                    {selectedConversation.kind === "group"
                      ? `${t.groupCode}: ${selectedConversation.group_code} · ${selectedConversation.member_count ?? 0} ${t.members}`
                      : selectedPeer?.chat_id ?? selectedConversation.peer_account_id}
                  </small>
                </span>
              </div>
              <div className="conversation-header-actions">
                {selectedConversation.kind === "group" && (
                  <button
                    className="header-text-button"
                    type="button"
                    onClick={() => void openGroupManagement()}
                  >
                    ···
                  </button>
                )}
              </div>
            </header>

            <div className="message-scroll" ref={messageScrollRef}>
              <div className="message-stack">
                {messages.length === 0 ? (
                  <div className="conversation-empty">
                    <ChatIcon />
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
                        {!mine && (
                          <Avatar
                            label={contactDisplayName(sender) ?? message.sender_account_id}
                            avatarUrl={sender?.avatar_data_url}
                            small
                          />
                        )}
                        <div className="message-body-column">
                          {selectedConversation.kind === "group" && !mine && (
                            <strong className="message-sender">
                              {contactDisplayName(sender) ?? shortUuid(message.sender_account_id)}
                            </strong>
                          )}
                          <div className="message-bubble">
                            <p>{message.body}</p>
                          </div>
                          <time>{formatClock(message.created_at)}</time>
                        </div>
                        {mine && (
                          <Avatar
                            label={activeAccount.display_name}
                            avatarUrl={activeAccount.avatar_data_url}
                            small
                          />
                        )}
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
          <div className="conversation-empty landing">
            <ChatIcon />
            <h1>{t.appName}</h1>
            <p>{t.startConversationHint}</p>
            <small>{socketStatusLabel(socketStatus, t)} · {backend}</small>
          </div>
        )}

        {error && (
          <button className="error-banner" type="button" onClick={() => setError(null)}>
            <span>!</span>
            <span>{error}</span>
            <span>×</span>
          </button>
        )}
        {notice && (
          <button className="notice-banner" type="button" onClick={() => setNotice(null)}>
            <span>✓</span>
            <span>{notice}</span>
            <span>×</span>
          </button>
        )}
      </section>

      <SettingsPanel
        open={settingsOpen}
        account={activeAccount}
        locale={locale}
        theme={theme}
        t={t}
        onLocaleChange={setLocale}
        onThemeChange={setTheme}
        onAvatarChange={performAvatarChange}
        onLogout={() => void performLogout()}
        onClose={() => setSettingsOpen(false)}
      />

      {discoveryOpen && (
        <DiscoveryModal
          mode={discoveryMode}
          query={lookupQuery}
          friendResult={lookupResult}
          groupResult={groupLookupResult}
          friendMessage={requestMessage}
          groupMessage={groupJoinMessage}
          busy={busy}
          t={t}
          onModeChange={(mode) => {
            setDiscoveryMode(mode);
            setLookupResult(null);
            setGroupLookupResult(null);
            setLookupQuery("");
          }}
          onQueryChange={setLookupQuery}
          onSearch={() => void performLookup()}
          onFriendMessageChange={setRequestMessage}
          onGroupMessageChange={setGroupJoinMessage}
          onSendFriendRequest={() => void performFriendRequest()}
          onSendGroupRequest={() => void performGroupJoinRequest()}
          onOpenGroup={(conversationId) => {
            setDiscoveryOpen(false);
            setSelectedConversationId(conversationId);
            setPrimaryView("chats");
          }}
          onCreateGroup={() => {
            setDiscoveryOpen(false);
            setGroupCreateOpen(true);
          }}
          onClose={() => setDiscoveryOpen(false)}
        />
      )}

      {requestsOpen && (
        <Modal title={t.newFriends} onClose={() => setRequestsOpen(false)} t={t} wide>
          <RequestsView
            mailbox={friendRequests}
            busy={busy}
            t={t}
            onRespond={(requestId, response) =>
              void performRequestResponse(requestId, response)
            }
          />
        </Modal>
      )}

      {groupCreateOpen && (
        <CreateGroupModal
          groupName={groupName}
          selectedIds={groupContactIds}
          contacts={contacts}
          busy={busy}
          t={t}
          onNameChange={setGroupName}
          onToggleContact={(accountId, checked) => {
            setGroupContactIds((current) =>
              checked
                ? [...current, accountId]
                : current.filter((id) => id !== accountId),
            );
          }}
          onCreate={() => void performCreateGroup()}
          onClose={() => setGroupCreateOpen(false)}
        />
      )}

      {groupManageOpen && groupDetails && (
        <GroupManagement
          details={groupDetails}
          joinRequests={groupJoinRequests}
          contacts={contacts}
          accountById={accountById}
          activeAccountId={activeAccount.account_id}
          busy={busy}
          t={t}
          onCopy={(value) => void copyValue("group", value)}
          copied={copied === "group"}
          onClose={() => setGroupManageOpen(false)}
          onJoinResponse={(requestId, response) =>
            void performGroupJoinResponse(requestId, response)
          }
          onAdd={(accountId) => void performAddGroupMember(accountId)}
          onRemove={(accountId) => void performRemoveGroupMember(accountId)}
          onRole={(accountId, role) => void performRoleChange(accountId, role)}
          onDissolve={() => void performDissolveGroup()}
        />
      )}
    </main>
  );
}

function ChatList(props: {
  conversations: Conversation[];
  contacts: Account[];
  accountById: Map<string, Account>;
  selectedConversationId: string | null;
  search: string;
  locale: Locale;
  t: Translation;
  onSelectConversation(conversationId: string): void;
  onSelectContact(accountId: string): void;
}) {
  const entries = useMemo<ChatListEntry[]>(() => {
    const directPeers = new Set<string>();
    const existing: ChatListEntry[] = props.conversations.map((conversation) => {
      const peer = conversation.peer_account_id
        ? props.accountById.get(conversation.peer_account_id)
        : undefined;
      if (conversation.kind === "direct" && conversation.peer_account_id) {
        directPeers.add(conversation.peer_account_id);
      }
      return { kind: "conversation", conversation, peer };
    });
    const contactEntries: ChatListEntry[] = props.contacts
      .filter((contact) => !directPeers.has(contact.account_id))
      .map((contact) => ({ kind: "contact", contact }));
    return [...existing, ...contactEntries];
  }, [props.accountById, props.contacts, props.conversations]);

  const query = props.search.trim().toLocaleLowerCase();
  const filtered = entries.filter((entry) => {
    if (!query) return true;
    if (entry.kind === "contact") {
      return `${entry.contact.display_name} ${entry.contact.chat_id}`
        .toLocaleLowerCase()
        .includes(query);
    }
    const title = conversationTitle(entry.conversation, entry.peer, props.t);
    const code =
      entry.conversation.kind === "group"
        ? entry.conversation.group_code ?? ""
        : entry.peer?.chat_id ?? "";
    return `${title} ${code}`.toLocaleLowerCase().includes(query);
  });

  return (
    <div className="chat-list">
      {filtered.length === 0 ? (
        <p className="list-empty">{props.t.noChatMatches}</p>
      ) : (
        filtered.map((entry) => {
          if (entry.kind === "contact") {
            return (
              <button
                className="chat-list-row"
                key={`contact-${entry.contact.account_id}`}
                type="button"
                onClick={() => props.onSelectContact(entry.contact.account_id)}
              >
                <Avatar
                  label={contactDisplayName(entry.contact)}
                  avatarUrl={entry.contact.avatar_data_url}
                />
                <span className="chat-list-copy">
                  <strong>{contactDisplayName(entry.contact)}</strong>
                  <small>{props.t.startConversationHint}</small>
                </span>
              </button>
            );
          }
          const { conversation, peer } = entry;
          const title = conversationTitle(conversation, peer, props.t);
          return (
            <button
              className={`chat-list-row ${
                props.selectedConversationId === conversation.conversation_id
                  ? "selected"
                  : ""
              }`}
              key={conversation.conversation_id}
              type="button"
              onClick={() => props.onSelectConversation(conversation.conversation_id)}
            >
              <Avatar
                label={title}
                avatarUrl={conversation.kind === "direct" ? peer?.avatar_data_url : null}
                group={conversation.kind === "group"}
              />
              <span className="chat-list-copy">
                <span className="chat-list-line">
                  <strong>{title}</strong>
                  <time>{formatListTime(conversation.last_message_at, props.locale)}</time>
                </span>
                <span className="chat-list-line preview">
                  <small>{conversation.last_message?.body ?? props.t.noMessagesYet}</small>
                  {conversation.unread_count > 0 && (
                    <b>{boundedCount(conversation.unread_count)}</b>
                  )}
                </span>
              </span>
            </button>
          );
        })
      )}
    </div>
  );
}

function AddressBook(props: {
  contacts: Account[];
  groups: Conversation[];
  pendingIncoming: number;
  groupsExpanded: boolean;
  search: string;
  t: Translation;
  onToggleGroups(): void;
  onOpenRequests(): void;
  onOpenDiscovery(): void;
  onOpenContact(accountId: string): void;
  onOpenGroup(conversationId: string): void;
}) {
  const query = props.search.trim().toLocaleLowerCase();
  const contacts = props.contacts.filter((contact) =>
    `${contactDisplayName(contact)} ${contactDisplayName(contact)} ${contact.chat_id}`.toLocaleLowerCase().includes(query),
  );
  const groups = props.groups.filter((group) =>
    `${group.group_name ?? ""} ${group.group_code ?? ""}`
      .toLocaleLowerCase()
      .includes(query),
  );

  return (
    <div className="address-book">
      <button className="address-management" type="button" onClick={props.onOpenDiscovery}>
        <ContactsIcon />
        <span>{props.t.discover}</span>
      </button>

      <button className="address-special-row" type="button" onClick={props.onOpenRequests}>
        <span className="address-special-icon friend"><FriendRequestIcon /></span>
        <strong>{props.t.newFriends}</strong>
        {props.pendingIncoming > 0 && <b>{boundedCount(props.pendingIncoming)}</b>}
      </button>

      <section className="address-section">
        <button className="address-section-header" type="button" onClick={props.onToggleGroups}>
          <ChevronIcon className={props.groupsExpanded ? "expanded" : ""} />
          <strong>{props.t.groups}</strong>
          <span>{props.groups.length}</span>
        </button>
        {props.groupsExpanded && (
          <div className="address-rows">
            {groups.map((group) => (
              <button
                className="address-row"
                type="button"
                key={group.conversation_id}
                onClick={() => props.onOpenGroup(group.conversation_id)}
              >
                <Avatar label={group.group_name ?? props.t.group} group />
                <span>
                  <strong>{group.group_name ?? props.t.group}</strong>
                  <small>{group.group_code}</small>
                </span>
              </button>
            ))}
          </div>
        )}
      </section>

      <section className="address-section">
        <div className="address-section-header static">
          <ChevronIcon className="expanded" />
          <strong>{props.t.contacts}</strong>
          <span>{props.contacts.length}</span>
        </div>
        <div className="address-rows">
          {contacts.length === 0 ? (
            <p className="list-empty">{props.t.noContacts}</p>
          ) : (
            contacts.map((contact) => (
              <button
                className="address-row"
                type="button"
                key={contact.account_id}
                onClick={() => props.onOpenContact(contact.account_id)}
              >
                <Avatar
                  label={contactDisplayName(contact)}
                  avatarUrl={contact.avatar_data_url}
                />
                <span>
                  <strong>{contactDisplayName(contact)}</strong>
                  <small>{contact.chat_id}</small>
                </span>
              </button>
            ))
          )}
        </div>
      </section>
    </div>
  );
}

function DiscoveryModal(props: {
  mode: DiscoveryMode;
  query: string;
  friendResult: Account | null;
  groupResult: GroupDiscovery | null;
  friendMessage: string;
  groupMessage: string;
  busy: boolean;
  t: Translation;
  onModeChange(mode: DiscoveryMode): void;
  onQueryChange(value: string): void;
  onSearch(): void;
  onFriendMessageChange(value: string): void;
  onGroupMessageChange(value: string): void;
  onSendFriendRequest(): void;
  onSendGroupRequest(): void;
  onOpenGroup(conversationId: string): void;
  onCreateGroup(): void;
  onClose(): void;
}) {
  return (
    <Modal title={props.t.discover} onClose={props.onClose} t={props.t} wide>
      <div className="discovery-tabs">
        <button
          className={props.mode === "friend" ? "active" : ""}
          type="button"
          onClick={() => props.onModeChange("friend")}
        >
          <FriendRequestIcon />
          {props.t.friendDiscovery}
        </button>
        <button
          className={props.mode === "group" ? "active" : ""}
          type="button"
          onClick={() => props.onModeChange("group")}
        >
          <GroupIcon />
          {props.t.groupDiscovery}
        </button>
      </div>

      <form
        className="discovery-search"
        onSubmit={(event) => {
          event.preventDefault();
          props.onSearch();
        }}
      >
        <SearchIcon />
        <input
          value={props.query}
          onChange={(event) => props.onQueryChange(event.target.value)}
          placeholder={
            props.mode === "friend" ? props.t.searchById : props.t.groupSearchById
          }
          autoFocus
        />
        <button className="primary-button" disabled={props.busy || !props.query.trim()}>
          {props.t.search}
        </button>
      </form>
      <p className="discovery-hint">
        {props.mode === "friend"
          ? props.t.exactSearchOnly
          : props.t.exactGroupSearchOnly}
      </p>

      {props.mode === "friend" && props.friendResult && (
        <section className="discovery-result">
          <div className="discovery-result-title">
            <Avatar
              label={props.friendResult.display_name}
              avatarUrl={props.friendResult.avatar_data_url}
            />
            <span>
              <strong>{props.friendResult.display_name}</strong>
              <small>{props.friendResult.chat_id}</small>
            </span>
          </div>
          <label>
            {props.t.requestMessage}
            <textarea
              value={props.friendMessage}
              maxLength={256}
              onChange={(event) => props.onFriendMessageChange(event.target.value)}
            />
          </label>
          <button
            className="primary-button full"
            type="button"
            disabled={props.busy || !props.friendMessage.trim()}
            onClick={props.onSendFriendRequest}
          >
            {props.t.sendRequest}
          </button>
        </section>
      )}

      {props.mode === "group" && props.groupResult && (
        <section className="discovery-result">
          <div className="discovery-result-title">
            <Avatar label={props.groupResult.name} group />
            <span>
              <strong>{props.groupResult.name}</strong>
              <small>
                {props.t.groupCode}: {props.groupResult.group_code} · {props.groupResult.member_count} {props.t.members}
              </small>
            </span>
          </div>
          {props.groupResult.actor_role ? (
            <button
              className="primary-button full"
              type="button"
              onClick={() => props.onOpenGroup(props.groupResult!.conversation_id)}
            >
              {props.t.openGroup}
            </button>
          ) : props.groupResult.join_request_status === "pending" ? (
            <button className="primary-button full" type="button" disabled>
              {props.t.awaitingReview}
            </button>
          ) : (
            <>
              <label>
                {props.t.joinRequestMessage}
                <textarea
                  value={props.groupMessage}
                  maxLength={256}
                  onChange={(event) => props.onGroupMessageChange(event.target.value)}
                />
              </label>
              <button
                className="primary-button full"
                type="button"
                disabled={props.busy || !props.groupMessage.trim()}
                onClick={props.onSendGroupRequest}
              >
                {props.t.joinGroup}
              </button>
            </>
          )}
        </section>
      )}

      {props.mode === "group" && (
        <button className="text-link-button" type="button" onClick={props.onCreateGroup}>
          <PlusIcon /> {props.t.createGroup}
        </button>
      )}
    </Modal>
  );
}

function RequestsView(props: {
  mailbox: FriendRequestMailbox;
  busy: boolean;
  t: Translation;
  onRespond(requestId: string, response: "accept" | "reject"): void;
}) {
  const incoming = props.mailbox.incoming.filter(
    (request) => request.status === "pending",
  );
  return (
    <div className="requests-view">
      <div className="section-heading">
        <strong>{props.t.incomingRequests}</strong>
        <span>{incoming.length}</span>
      </div>
      {incoming.length === 0 ? (
        <p className="list-empty">{props.t.noRequests}</p>
      ) : (
        incoming.map((request) => (
          <div className="request-row" key={request.request_id}>
            <Avatar
              label={contactDisplayName(request.peer)}
              avatarUrl={request.peer.avatar_data_url}
            />
            <span className="request-copy">
              <strong>{contactDisplayName(request.peer)}</strong>
              <small>{request.message}</small>
            </span>
            <button
              className="secondary-button"
              disabled={props.busy}
              onClick={() => props.onRespond(request.request_id, "reject")}
            >
              {props.t.reject}
            </button>
            <button
              className="primary-button"
              disabled={props.busy}
              onClick={() => props.onRespond(request.request_id, "accept")}
            >
              {props.t.accept}
            </button>
          </div>
        ))
      )}

      <div className="section-heading spaced">
        <strong>{props.t.outgoingRequests}</strong>
        <span>{props.mailbox.outgoing.length}</span>
      </div>
      {props.mailbox.outgoing.map((request) => (
        <div className="request-row compact" key={request.request_id}>
          <Avatar
            label={contactDisplayName(request.peer)}
            avatarUrl={request.peer.avatar_data_url}
          />
          <span className="request-copy">
            <strong>{contactDisplayName(request.peer)}</strong>
            <small>{request.message}</small>
          </span>
          <span className={`status-chip ${request.status}`}>
            {statusLabel(request.status, props.t)}
          </span>
        </div>
      ))}
    </div>
  );
}

function CreateGroupModal(props: {
  groupName: string;
  selectedIds: string[];
  contacts: Account[];
  busy: boolean;
  t: Translation;
  onNameChange(value: string): void;
  onToggleContact(accountId: string, checked: boolean): void;
  onCreate(): void;
  onClose(): void;
}) {
  return (
    <Modal title={props.t.createGroup} onClose={props.onClose} t={props.t} wide>
      <label className="modal-field">
        {props.t.groupName}
        <input
          value={props.groupName}
          onChange={(event) => props.onNameChange(event.target.value)}
          maxLength={64}
          autoFocus
        />
      </label>
      <div className="section-heading">
        <strong>{props.t.chooseContacts}</strong>
        <span>{props.selectedIds.length}</span>
      </div>
      <div className="contact-picker">
        {props.contacts.length === 0 ? (
          <p className="list-empty">{props.t.noContacts}</p>
        ) : (
          props.contacts.map((account) => (
            <label key={account.account_id} className="contact-check">
              <input
                type="checkbox"
                checked={props.selectedIds.includes(account.account_id)}
                onChange={(event) =>
                  props.onToggleContact(account.account_id, event.target.checked)
                }
              />
              <Avatar
                label={contactDisplayName(account)}
                avatarUrl={account.avatar_data_url}
                small
              />
              <span>
                <strong>{contactDisplayName(account)}</strong>
                <small>{account.chat_id}</small>
              </span>
            </label>
          ))
        )}
      </div>
      <div className="modal-actions">
        <button className="secondary-button" type="button" onClick={props.onClose}>
          {props.t.cancel}
        </button>
        <button
          className="primary-button"
          type="button"
          disabled={props.busy || !props.groupName.trim()}
          onClick={props.onCreate}
        >
          {props.t.create}
        </button>
      </div>
    </Modal>
  );
}

function GroupManagement(props: {
  details: GroupDetails;
  joinRequests: GroupJoinRequest[];
  contacts: Account[];
  accountById: Map<string, Account>;
  activeAccountId: string;
  busy: boolean;
  t: Translation;
  copied: boolean;
  onCopy(value: string): void;
  onClose(): void;
  onJoinResponse(requestId: string, response: "accept" | "reject"): void;
  onAdd(accountId: string): void;
  onRemove(accountId: string): void;
  onRole(accountId: string, role: Exclude<GroupRole, "owner">): void;
  onDissolve(): void;
}) {
  const memberIds = new Set(props.details.members.map((member) => member.account_id));
  const availableContacts = props.contacts.filter(
    (contact) => !memberIds.has(contact.account_id),
  );
  const canRemove =
    props.details.actor_role === "owner" || props.details.actor_role === "admin";
  const canReview = canRemove;

  return (
    <Modal title={props.t.groupSettings} onClose={props.onClose} t={props.t} wide>
      <div className="group-summary">
        <Avatar label={props.details.name} group large />
        <span>
          <h3>{props.details.name}</h3>
          <button
            className="copy-line"
            type="button"
            onClick={() => props.onCopy(props.details.group_code)}
          >
            {props.t.groupCode}: {props.details.group_code} · {props.copied ? props.t.copied : props.t.copy}
          </button>
        </span>
      </div>

      <p className="permission-note">
        {props.details.actor_role === "owner"
          ? props.t.ownerPermissions
          : props.details.actor_role === "admin"
            ? props.t.adminPermissions
            : props.t.memberPermissions}
      </p>

      {canReview && (
        <>
          <div className="section-heading">
            <strong>{props.t.groupJoinRequests}</strong>
            <span>{props.joinRequests.length}</span>
          </div>
          {props.joinRequests.length === 0 ? (
            <p className="list-empty inline">{props.t.noGroupJoinRequests}</p>
          ) : (
            <div className="group-request-list">
              {props.joinRequests.map((request) => {
                const account = props.accountById.get(request.applicant_account_id);
                return (
                  <div className="request-row" key={request.request_id}>
                    <Avatar
                      label={contactDisplayName(account) ?? request.applicant_account_id}
                      avatarUrl={account?.avatar_data_url}
                    />
                    <span className="request-copy">
                      <strong>{account?.display_name ?? shortUuid(request.applicant_account_id)}</strong>
                      <small>{request.message}</small>
                    </span>
                    <button
                      className="secondary-button"
                      disabled={props.busy}
                      onClick={() => props.onJoinResponse(request.request_id, "reject")}
                    >
                      {props.t.reject}
                    </button>
                    <button
                      className="primary-button"
                      disabled={props.busy}
                      onClick={() => props.onJoinResponse(request.request_id, "accept")}
                    >
                      {props.t.approve}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      <div className="section-heading spaced">
        <strong>{props.t.addMember}</strong>
        <span>{availableContacts.length}</span>
      </div>
      {availableContacts.length === 0 ? (
        <p className="list-empty inline">{props.t.noContacts}</p>
      ) : (
        <div className="add-member-grid">
          {availableContacts.map((contact) => (
            <button
              key={contact.account_id}
              disabled={props.busy}
              onClick={() => props.onAdd(contact.account_id)}
            >
              <Avatar
                label={contactDisplayName(contact)}
                avatarUrl={contact.avatar_data_url}
                small
              />
              <span>
                <strong>{contactDisplayName(contact)}</strong>
                <small>{contact.chat_id}</small>
              </span>
              <b>＋</b>
            </button>
          ))}
        </div>
      )}

      <div className="section-heading spaced">
        <strong>{props.t.members}</strong>
        <span>{props.details.members.length}</span>
      </div>
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
              <Avatar
                label={contactDisplayName(account) ?? member.account_id}
                avatarUrl={account?.avatar_data_url}
                small
              />
              <span className="member-copy">
                <strong>{account?.display_name ?? shortUuid(member.account_id)}</strong>
                <small>{account?.chat_id ?? shortUuid(member.account_id)}</small>
              </span>
              <span className={`role-chip ${member.role}`}>
                {roleLabel(member.role, props.t)}
              </span>
              {props.details.actor_role === "owner" && member.role !== "owner" && (
                <button
                  className="text-button"
                  disabled={props.busy}
                  onClick={() =>
                    props.onRole(
                      member.account_id,
                      member.role === "admin" ? "member" : "admin",
                    )
                  }
                >
                  {member.role === "admin" ? props.t.removeAdmin : props.t.setAdmin}
                </button>
              )}
              {canRemoveTarget && (
                <button
                  className="danger-text-button"
                  disabled={props.busy}
                  onClick={() => props.onRemove(member.account_id)}
                >
                  {props.t.remove}
                </button>
              )}
            </div>
          );
        })}
      </div>

      {props.details.actor_role === "owner" && (
        <button
          className="danger-button"
          disabled={props.busy}
          onClick={props.onDissolve}
        >
          {props.t.dissolveGroup}
        </button>
      )}
    </Modal>
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
    <main className="auth-shell">
      <button className="auth-settings" type="button" onClick={props.onOpenSettings}>
        <SettingsIcon />
        <span>{props.t.settings}</span>
      </button>
      <section className="auth-card">
        <div className="auth-logo"><ChatIcon /></div>
        <h1>{screen === "login" ? props.t.welcomeBack : props.t.createAccount}</h1>
        <p>{screen === "login" ? props.t.loginIntro : props.t.registerIntro}</p>
        <form
          className="auth-form"
          onSubmit={(event) => {
            event.preventDefault();
            setLocalError(null);
            if (screen === "register" && password !== confirmPassword) {
              setLocalError(props.t.passwordsMismatch);
              return;
            }
            void (screen === "login"
              ? props.onLogin(name.trim(), password)
              : props.onRegister(name.trim(), password));
          }}
        >
          <label>
            {props.t.name}
            <input
              value={name}
              autoComplete="username"
              onChange={(event) => setName(event.target.value)}
              minLength={3}
              maxLength={32}
              required
              autoFocus
            />
            <small>{props.t.nameHint}</small>
          </label>
          <label>
            {props.t.password}
            <input
              type="password"
              value={password}
              autoComplete={screen === "login" ? "current-password" : "new-password"}
              onChange={(event) => setPassword(event.target.value)}
              minLength={8}
              maxLength={128}
              required
            />
          </label>
          {screen === "register" && (
            <label>
              {props.t.confirmPassword}
              <input
                type="password"
                value={confirmPassword}
                autoComplete="new-password"
                onChange={(event) => setConfirmPassword(event.target.value)}
                minLength={8}
                maxLength={128}
                required
              />
            </label>
          )}
          {(localError || props.error) && (
            <p className="auth-error">{localError ?? props.error}</p>
          )}
          <button
            className="primary-button auth-submit"
            disabled={props.busy || !name.trim() || !password}
          >
            {props.busy
              ? props.t.pleaseWait
              : screen === "login"
                ? props.t.login
                : props.t.register}
          </button>
        </form>
        <button
          className="auth-link"
          type="button"
          onClick={() => changeScreen(screen === "login" ? "register" : "login")}
        >
          {screen === "login"
            ? `${props.t.noAccount} ${props.t.clickRegister}`
            : `${props.t.haveAccount} ${props.t.backToLogin}`}
        </button>
      </section>
    </main>
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
      <section
        className={`modal-card ${props.wide ? "wide" : ""}`}
        role="dialog"
        aria-modal="true"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="modal-header">
          <h2>{props.title}</h2>
          <button type="button" onClick={props.onClose} title={props.t.close}>×</button>
        </header>
        <div className="modal-body">{props.children}</div>
      </section>
    </div>
  );
}

function LoadingScreen({ t, onOpenSettings }: { t: Translation; onOpenSettings(): void }) {
  return (
    <main className="auth-shell">
      <button className="auth-settings" type="button" onClick={onOpenSettings}>
        <SettingsIcon />
        <span>{t.settings}</span>
      </button>
      <section className="auth-card loading-card">
        <div className="auth-logo"><ChatIcon /></div>
        <h1>{t.restoringSession}</h1>
      </section>
    </main>
  );
}

async function loadGroupWithAccounts(
  token: string,
  groupId: string,
  accountById: Map<string, Account>,
  mergeKnownAccounts: (accounts: Account[]) => void,
) {
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

function conversationTitle(
  conversation: Conversation,
  peer: Account | undefined,
  t: Translation,
) {
  return conversation.kind === "group"
    ? conversation.group_name ?? t.group
    : contactDisplayName(peer) ?? t.unknownUser;
}

function contactDisplayName(account: Account): string;
function contactDisplayName(account: undefined): undefined;
function contactDisplayName(account: Account | undefined): string | undefined;
function contactDisplayName(account: Account | undefined): string | undefined {
  if (!account) return undefined;
  return account.remark_name?.trim() || account.display_name;
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

function formatClock(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatListTime(value: string | null, locale: Locale): string {
  if (!value) return "";
  return new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatTemplate(template: string, value: string): string {
  return template.replace("{0}", value);
}

function totalUnread(conversations: Conversation[]) {
  return conversations.reduce((sum, conversation) => sum + conversation.unread_count, 0);
}

function boundedCount(value: number) {
  return value > 99 ? "99+" : String(value);
}

function socketStatusLabel(status: SocketStatus, t: Translation): string {
  if (status === "online") return t.realtimeConnected;
  if (status === "connecting") return t.realtimeConnecting;
  return t.realtimeOffline;
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
