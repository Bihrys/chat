import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type CSSProperties,
  type ReactNode,
} from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import {
  ApiError,
  addGroupMember,
  createDirectConversation,
  createGroup,
  clearConversationHistory,
  deleteContact,
  dissolveGroup,
  getAccount,
  getContact,
  getCurrentAccount,
  getGroup,
  getUiPreferences,
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
  searchMessages,
  sendFriendRequest,
  sendMessage,
  uploadMedia,
  setGroupMemberRole,
  updateAvatar,
  updateContactBlocked,
  updateContactPermission,
  updateContactRemark,
  updateContactStarred,
  updateContactTags,
  updateConversationPreferences,
  updateUiPreferences,
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
  MediaKind,
  MediaMessagePayload,
  ServerEvent,
  SocketStatus,
} from "../lib/types";
import { connectChatSocket } from "../lib/ws";
import {
  applyDocumentPreferences,
  readStoredFontSize,
  readStoredLocale,
  readStoredTheme,
  storeFontSize,
  storeLocale,
  storeTheme,
  translations,
  type FontSizeLevel,
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
import { ContactProfile, ContactProfilePopover } from "./ContactProfile";
import { DirectChatDetails } from "./DirectChatDetails";
import { UserAvatar as Avatar } from "./UserAvatar";
import { CallOverlay } from "./CallOverlay";
import { MediaMessage, parseMediaMessage } from "./MediaMessage";
import { usePeerCall } from "../lib/usePeerCall";

const AUTH_SESSION_KEY = "chat.auth.session.v1";
const COMPOSER_MIN_HEIGHT = 120;
const COMPOSER_DEFAULT_HEIGHT = 168;
const LIST_PANE_WIDTH_KEY = "chat.ui.list-pane-width.v1";
const LIST_PANE_MIN_WIDTH = 210;
const LIST_PANE_MAX_WIDTH = 520;
const DEFAULT_LIST_PANE_WIDTH = 285;
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
const MAX_MEDIA_BYTES = 128 * 1024 * 1024;
const MAX_VOICE_SECONDS = 60;
const EMPTY_REQUESTS: FriendRequestMailbox = { incoming: [], outgoing: [] };
const EMOJI_FACES = [
  "😀", "😃", "😄", "😁", "😆", "😅", "😂", "🤣", "😊", "😇",
  "🙂", "🙃", "😉", "😌", "😍", "🥰", "😘", "😗", "😙", "😚",
  "😋", "😛", "😝", "😜", "🤪", "🤨", "🧐", "🤓", "😎", "🥸",
  "🤩", "🥳", "😏", "😒", "😞", "😔", "😟", "😕", "🙁", "☹️",
  "😣", "😖", "😫", "😩", "🥺", "😢", "😭", "😤", "😠", "😡",
  "🤬", "🤯", "😳", "🥵", "🥶", "😱", "😨", "😰", "😥", "😓",
  "🤗", "🤔", "🤭", "🤫", "🤥", "😶", "😐", "😑", "😬", "🙄",
  "😯", "😦", "😧", "😮", "😲", "🥱", "😴", "🤤", "😪", "😵",
  "🤐", "🥴", "🤢", "🤮", "🤧", "😷", "🤒", "🤕", "🤑", "🤠",
] as const;

const BUILTIN_STICKERS = ["😂", "😭", "😍", "😡", "🥺", "🤣", "😎", "🤔", "😴", "🤯", "🥳", "👍"] as const;

type PrimaryView = "chats" | "contacts";
type DiscoveryMode = "friend" | "group";
type WindowChromeMode = "checking" | "custom" | "native";
type ChatListEntry =
  | { kind: "conversation"; conversation: Conversation; peer?: Account }
  | { kind: "contact"; contact: Account };

export function App() {
  const [backend, setBackend] = useState("checking");
  const [locale, setLocale] = useState<Locale>(readStoredLocale);
  const [theme, setTheme] = useState<ThemeMode>(readStoredTheme);
  const [fontSizeLevel, setFontSizeLevel] = useState<FontSizeLevel>(readStoredFontSize);
  const [listPaneWidth, setListPaneWidth] = useState(readStoredListPaneWidth);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [railMenuOpen, setRailMenuOpen] = useState(false);
  const t = translations[locale];
  const tauriRuntime = isTauri();
  const [windowChromeMode, setWindowChromeMode] = useState<WindowChromeMode>(
    tauriRuntime ? "checking" : "native",
  );
  const customWindowChrome = tauriRuntime && windowChromeMode === "custom";

  const [session, setSession] = useState<AuthSession | null>(readStoredSession);
  const [authChecking, setAuthChecking] = useState(session !== null);
  const [serverPreferencesLoaded, setServerPreferencesLoaded] = useState(false);
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
  const conversationPaneRef = useRef<HTMLElement | null>(null);
  const composerResizeRef = useRef<{
    pointerId: number;
    startY: number;
    startHeight: number;
    maxHeight: number;
  } | null>(null);
  const [composerHeight, setComposerHeight] = useState(COMPOSER_DEFAULT_HEIGHT);
  const [socketStatus, setSocketStatus] = useState<SocketStatus>("offline");
  const [primaryView, setPrimaryView] = useState<PrimaryView>("chats");
  const [selectedContactId, setSelectedContactId] = useState<string | null>(null);
  const [selectedContact, setSelectedContact] = useState<Account | null>(null);
  const [commonGroups, setCommonGroups] = useState<CommonGroup[]>([]);
  const [profilePopoverAccount, setProfilePopoverAccount] = useState<Account | null>(null);
  const [profilePopoverGroups, setProfilePopoverGroups] = useState<CommonGroup[]>([]);
  const [directDetailsOpen, setDirectDetailsOpen] = useState(false);
  const [messageSearch, setMessageSearch] = useState("");
  const [messageSearchResults, setMessageSearchResults] = useState<ChatMessage[] | null>(null);
  const [chatSearch, setChatSearch] = useState("");
  const [groupsExpanded, setGroupsExpanded] = useState(false);
  const [draft, setDraft] = useState("");
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);
  const [emojiPickerTab, setEmojiPickerTab] = useState<"emoji" | "sticker">("emoji");
  const composerTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const emojiPickerRef = useRef<HTMLDivElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const videoInputRef = useRef<HTMLInputElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const stickerInputRef = useRef<HTMLInputElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordingStreamRef = useRef<MediaStream | null>(null);
  const recordingChunksRef = useRef<Blob[]>([]);
  const recordingStartedAtRef = useRef(0);
  const recordingTimeoutRef = useRef<number | null>(null);
  const recordingTickerRef = useRef<number | null>(null);
  const recordingConversationRef = useRef<string | null>(null);
  const discardRecordingRef = useRef(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [isRecording, setIsRecording] = useState(false);
  const [mediaUploading, setMediaUploading] = useState(false);
  const listPaneResizeRef = useRef<{ pointerId: number; startX: number; startWidth: number } | null>(null);
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

  useEffect(() => {
    if (!emojiPickerOpen) return;

    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (emojiPickerRef.current?.contains(target)) return;
      if (
        target instanceof Element &&
        target.closest("[data-emoji-trigger='true']")
      ) {
        return;
      }
      setEmojiPickerOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setEmojiPickerOpen(false);
    };

    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [emojiPickerOpen]);

  useEffect(() => {
    setEmojiPickerOpen(false);
  }, [selectedConversationId]);

  useEffect(() => {
    if (isRecording && recordingConversationRef.current !== selectedConversationId) {
      stopVoiceRecording(true);
    }
    // stopVoiceRecording intentionally reads the current recorder ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedConversationId]);

  useEffect(() => () => {
    if (mediaRecorderRef.current?.state !== "inactive") {
      discardRecordingRef.current = true;
      mediaRecorderRef.current?.stop();
    }
    recordingStreamRef.current?.getTracks().forEach((track) => track.stop());
    if (recordingTimeoutRef.current !== null) window.clearTimeout(recordingTimeoutRef.current);
    if (recordingTickerRef.current !== null) window.clearInterval(recordingTickerRef.current);
  }, []);

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

  const visibleMessages = messageSearch.trim()
    ? messageSearchResults ?? []
    : messages;

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
    applyDocumentPreferences(locale, theme, fontSizeLevel);
    storeLocale(locale);
    storeTheme(theme);
    storeFontSize(fontSizeLevel);
  }, [fontSizeLevel, locale, theme]);

  useEffect(() => {
    localStorage.setItem(LIST_PANE_WIDTH_KEY, String(Math.round(listPaneWidth)));
  }, [listPaneWidth]);

  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(null), 2_800);
    return () => window.clearTimeout(timeout);
  }, [notice]);

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
    setServerPreferencesLoaded(false);
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

  const peerCall = usePeerCall({
    accessToken,
    activeAccountId: activeAccount?.account_id ?? null,
    onError: reportError,
  });
  const handleCallSignalRef = useRef(peerCall.handleSignal);
  useEffect(() => {
    handleCallSignalRef.current = peerCall.handleSignal;
  }, [peerCall.handleSignal]);

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
    if (!tauriRuntime) return;

    void invoke<{ decorated: boolean }>("configure_main_window")
      .then(({ decorated }) => {
        setWindowChromeMode(decorated ? "native" : "custom");
      })
      .catch(() => {
        // Never render a second set of controls when decoration detection fails.
        setWindowChromeMode("native");
      });
  }, [tauriRuntime]);

  useEffect(() => {
    if (!accessToken || !session) {
      setAuthChecking(false);
      return;
    }
    let cancelled = false;
    setAuthChecking(true);
    void Promise.all([
      getCurrentAccount(accessToken),
      getUiPreferences(accessToken),
    ])
      .then(([account, preferences]) => {
        if (cancelled) return;
        saveSession({ ...session, account });
        setLocale(preferences.locale);
        setTheme(preferences.theme);
        setFontSizeLevel(preferences.font_size_level);
        setServerPreferencesLoaded(true);
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
    if (!accessToken || !serverPreferencesLoaded) return;
    const timeout = window.setTimeout(() => {
      void updateUiPreferences(accessToken, {
        locale,
        theme,
        font_size_level: fontSizeLevel,
      }).catch(() => undefined);
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [accessToken, fontSizeLevel, locale, serverPreferencesLoaded, theme]);

  useEffect(() => {
    selectedConversationRef.current = selectedConversationId;
  }, [selectedConversationId]);

  useEffect(() => {
    setDirectDetailsOpen(false);
    setProfilePopoverAccount(null);
    setProfilePopoverGroups([]);
    setMessageSearch("");
    setMessageSearchResults(null);
  }, [selectedConversationId, primaryView]);

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
        if (event.type === "call_signal") {
          void handleCallSignalRef.current(event.payload.signal).catch(reportError);
          return;
        }
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
    const query = messageSearch.trim();
    if (!accessToken || !selectedConversationId || !query) {
      setMessageSearchResults(null);
      return;
    }
    let cancelled = false;
    const timeout = window.setTimeout(() => {
      void searchMessages(accessToken, selectedConversationId, query)
        .then((results) => {
          if (!cancelled) setMessageSearchResults(results);
        })
        .catch((reason) => {
          if (!cancelled) reportError(reason);
        });
    }, 220);
    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [accessToken, messageSearch, reportError, selectedConversationId]);

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

  useEffect(() => {
    const pane = conversationPaneRef.current;
    if (!pane) return;

    const observer = new ResizeObserver(() => {
      setComposerHeight((current) =>
        clampComposerHeight(current, pane.clientHeight),
      );
    });
    observer.observe(pane);
    return () => observer.disconnect();
  }, [activeAccount?.account_id]);

  useLayoutEffect(() => {
    const scroller = messageScrollRef.current;
    if (scroller) scroller.scrollTop = scroller.scrollHeight;
  }, [composerHeight, messages, selectedConversationId]);

  function beginComposerResize(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    const paneHeight = conversationPaneRef.current?.clientHeight ?? window.innerHeight;
    composerResizeRef.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      startHeight: composerHeight,
      maxHeight: composerMaximumHeight(paneHeight),
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    document.body.classList.add("composer-resizing");
    event.preventDefault();
  }

  function moveComposerResize(event: ReactPointerEvent<HTMLDivElement>) {
    const resize = composerResizeRef.current;
    if (!resize || resize.pointerId !== event.pointerId) return;
    const next = resize.startHeight + resize.startY - event.clientY;
    setComposerHeight(
      Math.min(resize.maxHeight, Math.max(COMPOSER_MIN_HEIGHT, next)),
    );
  }

  function endComposerResize(event: ReactPointerEvent<HTMLDivElement>) {
    const resize = composerResizeRef.current;
    if (!resize || resize.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    composerResizeRef.current = null;
    document.body.classList.remove("composer-resizing");
  }

  function resizeComposerBy(delta: number) {
    const paneHeight = conversationPaneRef.current?.clientHeight ?? window.innerHeight;
    setComposerHeight((current) =>
      clampComposerHeight(current + delta, paneHeight),
    );
  }

  function beginListPaneResize(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    listPaneResizeRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth: listPaneWidth,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    document.body.classList.add("list-pane-resizing");
    event.preventDefault();
  }

  function moveListPaneResize(event: ReactPointerEvent<HTMLDivElement>) {
    const resize = listPaneResizeRef.current;
    if (!resize || resize.pointerId !== event.pointerId) return;
    setListPaneWidth(clampListPaneWidth(resize.startWidth + event.clientX - resize.startX));
  }

  function endListPaneResize(event: ReactPointerEvent<HTMLDivElement>) {
    const resize = listPaneResizeRef.current;
    if (!resize || resize.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    listPaneResizeRef.current = null;
    document.body.classList.remove("list-pane-resizing");
  }

  function resizeListPaneBy(delta: number) {
    setListPaneWidth((current) => clampListPaneWidth(current + delta));
  }

  async function uploadAndSendMedia(
    conversationId: string,
    blob: Blob,
    kind: MediaKind,
    fileName: string,
    metadata: Partial<Pick<MediaMessagePayload, "duration_ms" | "width" | "height">> = {},
  ) {
    if (!accessToken || mediaUploading) return;
    if (blob.size <= 0) throw new Error(t.uploadFailed);
    if ((kind === "image" || kind === "sticker") && blob.size > MAX_IMAGE_BYTES) {
      throw new Error(t.mediaTooLarge);
    }
    if (blob.size > MAX_MEDIA_BYTES) throw new Error(t.mediaTooLarge);

    setMediaUploading(true);
    setError(null);
    try {
      const object = await uploadMedia(accessToken, conversationId, blob, {
        kind,
        fileName: normalizedMediaFileName(fileName, kind),
      });
      const payload: MediaMessagePayload = {
        object_id: object.object_id,
        media_kind: object.media_kind,
        file_name: object.file_name,
        content_type: object.content_type,
        byte_len: object.byte_len,
        ...metadata,
      };
      const created = await sendMessage(
        accessToken,
        conversationId,
        JSON.stringify(payload),
        crypto.randomUUID(),
        kind === "sticker" ? "sticker_v0" : "media_v0",
      );
      if (conversationId === selectedConversationRef.current) appendMessage(created);
      await refreshConversations(accessToken);
    } catch (reason) {
      reportError(reason);
      throw reason;
    } finally {
      setMediaUploading(false);
    }
  }

  async function handleMediaFile(file: File | undefined, kind: MediaKind) {
    const conversationId = selectedConversationRef.current;
    if (!file || !conversationId) return;
    try {
      let metadata: Partial<Pick<MediaMessagePayload, "duration_ms" | "width" | "height">> = {};
      if (kind === "image" || kind === "sticker") {
        metadata = await readImageMetadata(file);
      } else if (kind === "video") {
        metadata = await readVideoMetadata(file);
      }
      await uploadAndSendMedia(conversationId, file, kind, file.name, metadata);
      setEmojiPickerOpen(false);
    } catch (reason) {
      reportError(reason);
    }
  }

  async function sendBuiltInSticker(emoji: string) {
    const conversationId = selectedConversationRef.current;
    if (!conversationId) return;
    try {
      const blob = await emojiStickerBlob(emoji);
      await uploadAndSendMedia(
        conversationId,
        blob,
        "sticker",
        `sticker-${Date.now()}.png`,
        { width: 256, height: 256 },
      );
      setEmojiPickerOpen(false);
    } catch (reason) {
      reportError(reason);
    }
  }

  function clearRecordingResources() {
    if (recordingTimeoutRef.current !== null) {
      window.clearTimeout(recordingTimeoutRef.current);
      recordingTimeoutRef.current = null;
    }
    if (recordingTickerRef.current !== null) {
      window.clearInterval(recordingTickerRef.current);
      recordingTickerRef.current = null;
    }
    recordingStreamRef.current?.getTracks().forEach((track) => track.stop());
    recordingStreamRef.current = null;
    mediaRecorderRef.current = null;
    setIsRecording(false);
    setRecordingSeconds(0);
  }

  async function startVoiceRecording() {
    const conversationId = selectedConversationRef.current;
    if (!conversationId || isRecording || mediaUploading) return;
    if (typeof MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setError(t.unsupportedMediaRecorder);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = preferredRecordingMimeType();
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);
      recordingStreamRef.current = stream;
      mediaRecorderRef.current = recorder;
      recordingChunksRef.current = [];
      recordingConversationRef.current = conversationId;
      discardRecordingRef.current = false;
      recordingStartedAtRef.current = Date.now();
      setRecordingSeconds(0);
      setIsRecording(true);
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) recordingChunksRef.current.push(event.data);
      };
      recorder.onerror = () => {
        clearRecordingResources();
        setError(t.uploadFailed);
      };
      recorder.onstop = () => {
        const targetConversation = recordingConversationRef.current;
        const discard = discardRecordingRef.current;
        const durationMs = Math.max(1, Date.now() - recordingStartedAtRef.current);
        const chunks = recordingChunksRef.current.splice(0);
        const contentType = recorder.mimeType || mimeType || "audio/webm";
        clearRecordingResources();
        recordingConversationRef.current = null;
        discardRecordingRef.current = false;
        if (discard || !targetConversation || chunks.length === 0) return;
        const blob = new Blob(chunks, { type: contentType });
        void uploadAndSendMedia(
          targetConversation,
          blob,
          "voice",
          `voice-${Date.now()}.${recordingFileExtension(contentType)}`,
          { duration_ms: durationMs },
        ).catch(() => undefined);
      };
      recorder.start(250);
      recordingTickerRef.current = window.setInterval(() => {
        setRecordingSeconds(Math.min(MAX_VOICE_SECONDS, Math.floor((Date.now() - recordingStartedAtRef.current) / 1000)));
      }, 250);
      recordingTimeoutRef.current = window.setTimeout(() => stopVoiceRecording(), MAX_VOICE_SECONDS * 1000);
    } catch (reason) {
      clearRecordingResources();
      setError(mediaAccessError(reason, t));
    }
  }

  function stopVoiceRecording(discard = false) {
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state === "inactive") {
      clearRecordingResources();
      return;
    }
    discardRecordingRef.current = discard;
    recorder.stop();
  }

  async function openDirectConversation(peerAccountId: string): Promise<Conversation | null> {
    if (!accessToken) return null;
    const existing = directConversationByPeer.get(peerAccountId);
    if (existing) {
      setSelectedConversationId(existing.conversation_id);
      setSelectedContactId(null);
      setPrimaryView("chats");
      return existing;
    }
    setBusy(true);
    setError(null);
    try {
      const conversation = await createDirectConversation(accessToken, peerAccountId);
      await refreshConversations(accessToken);
      setSelectedConversationId(conversation.conversation_id);
      setSelectedContactId(null);
      setPrimaryView("chats");
      return conversation;
    } catch (reason) {
      reportError(reason);
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function startContactCall(peerAccountId: string, media: "audio" | "video") {
    if (peerCall.call) return;
    const conversation = await openDirectConversation(peerAccountId);
    if (!conversation) return;
    setProfilePopoverAccount(null);
    await peerCall.startCall(conversation.conversation_id, peerAccountId, media);
  }

  function insertEmoji(emoji: string) {
    const textarea = composerTextareaRef.current;
    const selectionStart = textarea?.selectionStart ?? draft.length;
    const selectionEnd = textarea?.selectionEnd ?? selectionStart;
    const nextDraft = `${draft.slice(0, selectionStart)}${emoji}${draft.slice(selectionEnd)}`;
    if (nextDraft.length > 8_000) return;

    setDraft(nextDraft);
    window.requestAnimationFrame(() => {
      const nextTextarea = composerTextareaRef.current;
      if (!nextTextarea) return;
      const caret = selectionStart + emoji.length;
      nextTextarea.focus();
      nextTextarea.setSelectionRange(caret, caret);
    });
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
    const request = friendRequests.incoming.find((item) => item.request_id === requestId);
    setBusy(true);
    try {
      await respondFriendRequest(accessToken, requestId, response);
      if (response === "accept" && request) {
        try {
          const conversation = await createDirectConversation(
            accessToken,
            request.peer.account_id,
          );
          await sendMessage(
            accessToken,
            conversation.conversation_id,
            t.friendAcceptedWelcome,
            crypto.randomUUID(),
          );
        } catch (reason) {
          reportError(reason);
        }
      }
      await refreshSocial(accessToken);
      await refreshConversations(accessToken);
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

  function applyContactUpdate(updated: Account) {
    setContacts((current) =>
      current
        .map((account) =>
          account.account_id === updated.account_id ? updated : account,
        )
        .sort((left, right) =>
          Number(Boolean(right.is_starred)) - Number(Boolean(left.is_starred))
          || contactDisplayName(left).localeCompare(contactDisplayName(right)),
        ),
    );
    setSelectedContact((current) =>
      current?.account_id === updated.account_id ? updated : current,
    );
    setProfilePopoverAccount((current) =>
      current?.account_id === updated.account_id ? updated : current,
    );
    mergeKnownAccounts([updated]);
  }

  async function runContactUpdate(
    accountId: string,
    operation: () => Promise<Account>,
  ) {
    setBusy(true);
    setError(null);
    try {
      const updated = await operation();
      applyContactUpdate(updated);
    } catch (reason) {
      reportError(reason);
      throw reason;
    } finally {
      setBusy(false);
    }
  }

  async function performContactRemark(accountId: string, value: string) {
    if (!accessToken) return;
    await runContactUpdate(accountId, () =>
      updateContactRemark(accessToken, accountId, value),
    );
  }

  async function performContactTags(accountId: string, value: string) {
    if (!accessToken) return;
    await runContactUpdate(accountId, () =>
      updateContactTags(accessToken, accountId, value),
    );
  }

  async function performContactPermission(
    accountId: string,
    permission: "all" | "chat_only",
  ) {
    if (!accessToken) return;
    await runContactUpdate(accountId, () =>
      updateContactPermission(accessToken, accountId, permission),
    );
  }

  async function performContactStar(accountId: string) {
    if (!accessToken) return;
    const account = contacts.find((item) => item.account_id === accountId)
      ?? profilePopoverAccount
      ?? selectedContact;
    await runContactUpdate(accountId, () =>
      updateContactStarred(accessToken, accountId, !account?.is_starred),
    );
  }

  async function performContactBlock(accountId: string) {
    if (!accessToken) return;
    const account = contacts.find((item) => item.account_id === accountId)
      ?? profilePopoverAccount
      ?? selectedContact;
    await runContactUpdate(accountId, () =>
      updateContactBlocked(accessToken, accountId, !account?.is_blocked),
    );
    await refreshConversations(accessToken);
  }

  async function performDeleteContact(accountId: string) {
    if (!accessToken) return;
    setBusy(true);
    try {
      await deleteContact(accessToken, accountId);
      setContacts((current) => current.filter((item) => item.account_id !== accountId));
      setKnownAccounts((current) => current.filter((item) => item.account_id !== accountId));
      if (selectedContactId === accountId) {
        setSelectedContactId(null);
        setSelectedContact(null);
      }
      if (profilePopoverAccount?.account_id === accountId) {
        setProfilePopoverAccount(null);
      }
      const directConversation = conversations.find(
        (conversation) =>
          conversation.kind === "direct" && conversation.peer_account_id === accountId,
      );
      if (directConversation?.conversation_id === selectedConversationId) {
        setSelectedConversationId(null);
        setMessages([]);
      }
      await refreshSocial(accessToken);
      await refreshConversations(accessToken);
      setNotice(t.contactDeleted);
    } catch (reason) {
      reportError(reason);
      throw reason;
    } finally {
      setBusy(false);
    }
  }

  async function performRecommendContact(
    contact: Account,
    recipientAccountId: string,
  ) {
    if (!accessToken) return;
    setBusy(true);
    try {
      const conversation = await createDirectConversation(accessToken, recipientAccountId);
      const body = encodeContactCard(contact);
      await sendMessage(
        accessToken,
        conversation.conversation_id,
        body,
        crypto.randomUUID(),
      );
      await refreshConversations(accessToken);
      setNotice(t.contactCardSent);
    } catch (reason) {
      reportError(reason);
      throw reason;
    } finally {
      setBusy(false);
    }
  }

  async function openRecommendedContact(card: ContactCardPayload) {
    if (!accessToken) return;
    const existing = contacts.find((item) => item.account_id === card.account_id);
    if (existing) {
      await openContactPopover(existing);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const account = await getAccount(accessToken, card.account_id);
      mergeKnownAccounts([account]);
      setDiscoveryMode("friend");
      setLookupQuery(account.chat_id);
      setLookupResult(account);
      setRequestMessage(
        formatTemplate(t.defaultRequest, activeAccount?.display_name ?? ""),
      );
      setDiscoveryOpen(true);
    } catch (reason) {
      reportError(reason);
    } finally {
      setBusy(false);
    }
  }

  async function openContactPopover(account: Account) {
    if (!accessToken) return;
    setProfilePopoverAccount(account);
    try {
      const [fresh, groups] = await Promise.all([
        getContact(accessToken, account.account_id),
        listCommonGroups(accessToken, account.account_id),
      ]);
      setProfilePopoverAccount(fresh);
      setProfilePopoverGroups(groups);
      applyContactUpdate(fresh);
    } catch (reason) {
      reportError(reason);
    }
  }

  async function performConversationPreference(
    conversation: Conversation,
    patch: Partial<{ is_pinned: boolean; is_muted: boolean }>,
  ) {
    if (!accessToken) return;
    setBusy(true);
    try {
      const next = {
        is_pinned: patch.is_pinned ?? conversation.is_pinned,
        is_muted: patch.is_muted ?? conversation.is_muted,
      };
      await updateConversationPreferences(accessToken, conversation.conversation_id, {
        isPinned: next.is_pinned,
        isMuted: next.is_muted,
      });
      setConversations((current) =>
        current.map((item) =>
          item.conversation_id === conversation.conversation_id
            ? { ...item, ...next }
            : item,
        ),
      );
      await refreshConversations(accessToken);
    } catch (reason) {
      reportError(reason);
    } finally {
      setBusy(false);
    }
  }

  async function performClearHistory(conversation: Conversation) {
    if (!accessToken || !window.confirm(t.clearChatHistoryConfirm)) return;
    setBusy(true);
    try {
      await clearConversationHistory(accessToken, conversation.conversation_id);
      if (selectedConversationId === conversation.conversation_id) {
        setMessages([]);
        setMessageSearch("");
        setMessageSearchResults(null);
      }
      await refreshConversations(accessToken);
      setNotice(t.chatHistoryCleared);
    } catch (reason) {
      reportError(reason);
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
    if (isRecording) stopVoiceRecording(true);
    if (peerCall.call) await peerCall.hangUp();
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
          fontSizeLevel={fontSizeLevel}
          t={t}
          onLocaleChange={setLocale}
          onThemeChange={setTheme}
          onFontSizeChange={setFontSizeLevel}
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
          fontSizeLevel={fontSizeLevel}
          t={t}
          onLocaleChange={setLocale}
          onThemeChange={setTheme}
          onFontSizeChange={setFontSizeLevel}
          onClose={() => setSettingsOpen(false)}
        />
      </>
    );
  }

  const pendingIncoming = friendRequests.incoming.filter(
    (request) => request.status === "pending",
  ).length;

  return (
    <main
      className={`wechat-shell ${customWindowChrome ? "tauri-frameless" : ""}`}
      style={{ "--list-pane-width": `${listPaneWidth}px` } as CSSProperties}
    >
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
      <div
        className="list-pane-resizer"
        role="separator"
        aria-orientation="vertical"
        aria-label={t.dragSidebar}
        tabIndex={0}
        onPointerDown={beginListPaneResize}
        onPointerMove={moveListPaneResize}
        onPointerUp={endListPaneResize}
        onPointerCancel={endListPaneResize}
        onDoubleClick={() => setListPaneWidth(DEFAULT_LIST_PANE_WIDTH)}
        onKeyDown={(event) => {
          if (event.key === "ArrowLeft") {
            event.preventDefault();
            resizeListPaneBy(-16);
          } else if (event.key === "ArrowRight") {
            event.preventDefault();
            resizeListPaneBy(16);
          }
        }}
      />

      <section className="conversation-pane" ref={conversationPaneRef}>
        {customWindowChrome && (
          <>
            {!selectedConversation && (
              <div className="frameless-drag-strip" data-tauri-drag-region />
            )}
            <DesktopWindowControls locale={locale} />
          </>
        )}
        {primaryView === "contacts" && selectedContact ? (
          <ContactProfile
            account={selectedContact}
            commonGroups={commonGroups}
            contacts={contacts}
            busy={busy}
            callBusy={Boolean(peerCall.call)}
            t={t}
            onSaveRemark={(value) => performContactRemark(selectedContact.account_id, value)}
            onSaveTags={(value) => performContactTags(selectedContact.account_id, value)}
            onSetPermission={(value) => performContactPermission(selectedContact.account_id, value)}
            onToggleStarred={() => performContactStar(selectedContact.account_id)}
            onToggleBlocked={() => performContactBlock(selectedContact.account_id)}
            onDelete={() => performDeleteContact(selectedContact.account_id)}
            onRecommend={(recipientId) => performRecommendContact(selectedContact, recipientId)}
            onStartChat={() => void openDirectConversation(selectedContact.account_id)}
            onStartAudioCall={() => void startContactCall(selectedContact.account_id, "audio")}
            onStartVideoCall={() => void startContactCall(selectedContact.account_id, "video")}
            onOpenGroup={(conversationId) => {
              setSelectedContactId(null);
              setSelectedConversationId(conversationId);
              setPrimaryView("chats");
            }}
          />
        ) : selectedConversation ? (
          <>
            <header className="conversation-header" data-tauri-drag-region>
              <div className="conversation-title-block">
                <h1>
                  {selectedConversation.kind === "group"
                    ? selectedConversation.group_name
                    : contactDisplayName(selectedPeer) ?? t.conversation}
                </h1>
              </div>
              <div className="conversation-header-actions">
                {selectedConversation.kind === "direct" && selectedConversation.peer_account_id && (
                  <>
                    <button
                      className="header-icon-button"
                      type="button"
                      title={t.audioCall}
                      aria-label={t.audioCall}
                      disabled={Boolean(peerCall.call)}
                      onClick={() => void peerCall.startCall(
                        selectedConversation.conversation_id,
                        selectedConversation.peer_account_id!,
                        "audio",
                      )}
                    >
                      <PhoneIcon />
                    </button>
                    <button
                      className="header-icon-button"
                      type="button"
                      title={t.videoCall}
                      aria-label={t.videoCall}
                      disabled={Boolean(peerCall.call)}
                      onClick={() => void peerCall.startCall(
                        selectedConversation.conversation_id,
                        selectedConversation.peer_account_id!,
                        "video",
                      )}
                    >
                      <CameraIcon />
                    </button>
                  </>
                )}
                <button
                  className="header-text-button"
                  type="button"
                  aria-label={t.more}
                  onClick={() => {
                    if (selectedConversation.kind === "group") {
                      void openGroupManagement();
                    } else {
                      setDirectDetailsOpen((open) => !open);
                    }
                  }}
                >
                  ···
                </button>
              </div>
            </header>

            <div className="message-scroll" ref={messageScrollRef}>
              <div className="message-stack">
                {visibleMessages.length === 0 ? (
                  <div className="conversation-empty">
                    <ChatIcon />
                    <h2>{t.emptyMessagesTitle}</h2>
                    <p>{t.emptyMessagesBody}</p>
                  </div>
                ) : (
                  visibleMessages.map((message) => {
                    const sender = accountById.get(message.sender_account_id);
                    const mine = message.sender_account_id === activeAccount.account_id;
                    return (
                      <div
                        key={message.message_id}
                        className={`message-row ${mine ? "mine" : ""}`}
                      >
                        {!mine && (
                          <button
                            className="message-avatar-button"
                            type="button"
                            disabled={!sender || !contacts.some((item) => item.account_id === sender.account_id)}
                            onClick={() => {
                              if (sender) void openContactPopover(sender);
                            }}
                          >
                            <Avatar
                              label={contactDisplayName(sender) ?? message.sender_account_id}
                              avatarUrl={sender?.avatar_data_url}
                              small
                            />
                          </button>
                        )}
                        <div className="message-body-column">
                          {selectedConversation.kind === "group" && !mine && (
                            <strong className="message-sender">
                              {contactDisplayName(sender) ?? shortUuid(message.sender_account_id)}
                            </strong>
                          )}
                          <div
                            className={`message-bubble ${
                              message.payload_format === "media_v0" || message.payload_format === "sticker_v0"
                                ? "media-bubble"
                                : ""
                            }`}
                          >
                            <MessageContent
                              body={message.body}
                              payloadFormat={message.payload_format}
                              accessToken={session.access_token}
                              t={t}
                              onOpenContactCard={(card) => void openRecommendedContact(card)}
                            />
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
              style={{ height: `${composerHeight}px` }}
              onSubmit={(event) => {
                event.preventDefault();
                void submitMessage();
              }}
            >
              <div
                className="composer-resize-handle"
                role="separator"
                aria-orientation="horizontal"
                aria-label={
                  locale === "zh-CN" ? "调整消息输入区高度" : "Resize message input"
                }
                tabIndex={0}
                onPointerDown={beginComposerResize}
                onPointerMove={moveComposerResize}
                onPointerUp={endComposerResize}
                onPointerCancel={endComposerResize}
                onKeyDown={(event) => {
                  if (event.key === "ArrowUp") {
                    event.preventDefault();
                    resizeComposerBy(16);
                  } else if (event.key === "ArrowDown") {
                    event.preventDefault();
                    resizeComposerBy(-16);
                  }
                }}
              />
              <textarea
                ref={composerTextareaRef}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onPaste={(event) => {
                  const image = clipboardImageFile(event.clipboardData);
                  if (image) {
                    event.preventDefault();
                    void handleMediaFile(image, "image");
                  }
                }}
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
              <div className="composer-toolbar">
                <button
                  className={`composer-tool-button ${emojiPickerOpen ? "active" : ""}`}
                  type="button"
                  data-emoji-trigger="true"
                  aria-haspopup="dialog"
                  aria-expanded={emojiPickerOpen}
                  aria-label={locale === "zh-CN" ? "表情" : "Emoji"}
                  title={locale === "zh-CN" ? "表情" : "Emoji"}
                  onClick={() => setEmojiPickerOpen((open) => !open)}
                >
                  <SmileIcon />
                </button>
                <button className="composer-tool-button" type="button" title={t.image} aria-label={t.image} disabled={mediaUploading} onClick={() => imageInputRef.current?.click()}>
                  <ImageIcon />
                </button>
                <button className="composer-tool-button" type="button" title={t.video} aria-label={t.video} disabled={mediaUploading} onClick={() => videoInputRef.current?.click()}>
                  <VideoFileIcon />
                </button>
                <button className="composer-tool-button" type="button" title={t.file} aria-label={t.file} disabled={mediaUploading} onClick={() => fileInputRef.current?.click()}>
                  <FileIcon />
                </button>
                <button
                  className={`composer-tool-button ${isRecording ? "recording" : ""}`}
                  type="button"
                  title={isRecording ? t.stopRecording : t.recordVoice}
                  aria-label={isRecording ? t.stopRecording : t.recordVoice}
                  disabled={mediaUploading}
                  onClick={() => isRecording ? stopVoiceRecording() : void startVoiceRecording()}
                >
                  <MicrophoneIcon />
                </button>
                {isRecording && (
                  <span className="voice-recording-indicator">
                    <i /> {t.recording} {formatRecordingTime(recordingSeconds)}
                    <button type="button" onClick={() => stopVoiceRecording(true)}>×</button>
                  </span>
                )}
                {mediaUploading && <span className="media-uploading">{t.pleaseWait}</span>}
                {emojiPickerOpen && (
                  <div
                    ref={emojiPickerRef}
                    className="emoji-picker"
                    role="dialog"
                    aria-label={emojiPickerTab === "emoji" ? (locale === "zh-CN" ? "所有表情" : "All emoji") : t.sticker}
                  >
                    <div className="emoji-picker-tabs">
                      <button className={emojiPickerTab === "emoji" ? "active" : ""} type="button" onClick={() => setEmojiPickerTab("emoji")}>
                        <SmileIcon /> <span>{locale === "zh-CN" ? "表情" : "Emoji"}</span>
                      </button>
                      <button className={emojiPickerTab === "sticker" ? "active" : ""} type="button" onClick={() => setEmojiPickerTab("sticker")}>
                        <StickerIcon /> <span>{t.sticker}</span>
                      </button>
                    </div>
                    {emojiPickerTab === "emoji" ? (
                      <div className="emoji-grid">
                        {EMOJI_FACES.map((emoji, index) => (
                          <button key={`${emoji}-${index}`} type="button" className="emoji-item" aria-label={emoji} title={emoji} onClick={() => insertEmoji(emoji)}>
                            {emoji}
                          </button>
                        ))}
                      </div>
                    ) : (
                      <div className="sticker-grid">
                        {BUILTIN_STICKERS.map((emoji) => (
                          <button key={emoji} type="button" className="sticker-item" aria-label={emoji} disabled={mediaUploading} onClick={() => void sendBuiltInSticker(emoji)}>
                            {emoji}
                          </button>
                        ))}
                        <button className="sticker-upload-item" type="button" disabled={mediaUploading} onClick={() => stickerInputRef.current?.click()}>
                          <PlusIcon /> <span>{t.add}</span>
                        </button>
                      </div>
                    )}
                  </div>
                )}
                <input ref={imageInputRef} hidden type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={(event) => { void handleMediaFile(event.currentTarget.files?.[0], "image"); event.currentTarget.value = ""; }} />
                <input ref={videoInputRef} hidden type="file" accept="video/*" onChange={(event) => { void handleMediaFile(event.currentTarget.files?.[0], "video"); event.currentTarget.value = ""; }} />
                <input ref={fileInputRef} hidden type="file" onChange={(event) => { void handleMediaFile(event.currentTarget.files?.[0], "file"); event.currentTarget.value = ""; }} />
                <input ref={stickerInputRef} hidden type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={(event) => { void handleMediaFile(event.currentTarget.files?.[0], "sticker"); event.currentTarget.value = ""; }} />
              </div>
              <button
                className="send-button"
                type="submit"
                disabled={busy || mediaUploading || !draft.trim()}
              >
                {t.send}
              </button>
            </form>
            {selectedConversation.kind === "direct" && (
              <DirectChatDetails
                open={directDetailsOpen}
                peer={selectedPeer ?? null}
                conversation={selectedConversation}
                searchQuery={messageSearch}
                t={t}
                busy={busy}
                onSearchQueryChange={setMessageSearch}
                onOpenPeer={() => {
                  if (selectedPeer) void openContactPopover(selectedPeer);
                }}
                onStartGroup={() => {
                  if (selectedConversation.peer_account_id) {
                    setGroupContactIds([selectedConversation.peer_account_id]);
                    setGroupName(
                      locale === "zh-CN"
                        ? `${contactDisplayName(selectedPeer) ?? t.group}群聊`
                        : `${contactDisplayName(selectedPeer) ?? t.group} group`,
                    );
                    setGroupCreateOpen(true);
                  }
                }}
                onToggleMuted={() =>
                  void performConversationPreference(selectedConversation, {
                    is_muted: !selectedConversation.is_muted,
                  })
                }
                onTogglePinned={() =>
                  void performConversationPreference(selectedConversation, {
                    is_pinned: !selectedConversation.is_pinned,
                  })
                }
                onClearHistory={() => void performClearHistory(selectedConversation)}
                onClose={() => {
                  setDirectDetailsOpen(false);
                  setMessageSearch("");
                  setMessageSearchResults(null);
                }}
              />
            )}
          </>
        ) : (
          <div className="conversation-empty landing" aria-label={socketStatusLabel(socketStatus, t)}>
            <ChatIcon />
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
        fontSizeLevel={fontSizeLevel}
        t={t}
        onLocaleChange={setLocale}
        onThemeChange={setTheme}
        onFontSizeChange={setFontSizeLevel}
        onAvatarChange={performAvatarChange}
        onLogout={() => void performLogout()}
        onClose={() => setSettingsOpen(false)}
      />

      {peerCall.call && (
        <CallOverlay
          call={peerCall.call}
          peer={accountById.get(peerCall.call.peerAccountId) ?? null}
          localStream={peerCall.localStream}
          remoteStream={peerCall.remoteStream}
          microphoneMuted={peerCall.microphoneMuted}
          cameraEnabled={peerCall.cameraEnabled}
          t={t}
          onAccept={() => void peerCall.acceptCall()}
          onReject={() => void peerCall.rejectCall()}
          onHangUp={() => void peerCall.hangUp()}
          onToggleMicrophone={peerCall.toggleMicrophone}
          onToggleCamera={peerCall.toggleCamera}
        />
      )}

      {profilePopoverAccount && (
        <ContactProfilePopover
          account={profilePopoverAccount}
          commonGroups={profilePopoverGroups}
          contacts={contacts}
          busy={busy}
          callBusy={Boolean(peerCall.call)}
          t={t}
          onSaveRemark={(value) => performContactRemark(profilePopoverAccount.account_id, value)}
          onSaveTags={(value) => performContactTags(profilePopoverAccount.account_id, value)}
          onSetPermission={(value) => performContactPermission(profilePopoverAccount.account_id, value)}
          onToggleStarred={() => performContactStar(profilePopoverAccount.account_id)}
          onToggleBlocked={() => performContactBlock(profilePopoverAccount.account_id)}
          onDelete={() => performDeleteContact(profilePopoverAccount.account_id)}
          onRecommend={(recipientId) => performRecommendContact(profilePopoverAccount, recipientId)}
          onStartChat={() => {
            setProfilePopoverAccount(null);
            void openDirectConversation(profilePopoverAccount.account_id);
          }}
          onStartAudioCall={() => void startContactCall(profilePopoverAccount.account_id, "audio")}
          onStartVideoCall={() => void startContactCall(profilePopoverAccount.account_id, "video")}
          onOpenGroup={(conversationId) => {
            setProfilePopoverAccount(null);
            setSelectedConversationId(conversationId);
            setPrimaryView("chats");
          }}
          onClose={() => setProfilePopoverAccount(null)}
        />
      )}

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

function DesktopWindowControls({ locale }: { locale: Locale }) {
  const labels =
    locale === "zh-CN"
      ? { minimize: "最小化", maximize: "最大化或还原", close: "关闭" }
      : { minimize: "Minimize", maximize: "Maximize or restore", close: "Close" };

  const runWindowAction = (action: "minimize" | "toggle_maximize" | "close") => {
    void invoke("window_action", { action }).catch((reason) => {
      console.error(`window action ${action} failed`, reason);
    });
  };

  return (
    <div className="desktop-window-controls" aria-label="window controls">
      <button
        type="button"
        title={labels.minimize}
        aria-label={labels.minimize}
        onClick={() => runWindowAction("minimize")}
      >
        <span aria-hidden="true">−</span>
      </button>
      <button
        type="button"
        title={labels.maximize}
        aria-label={labels.maximize}
        onClick={() => runWindowAction("toggle_maximize")}
      >
        <span className="maximize-glyph" aria-hidden="true" />
      </button>
      <button
        className="close"
        type="button"
        title={labels.close}
        aria-label={labels.close}
        onClick={() => runWindowAction("close")}
      >
        <span aria-hidden="true">×</span>
      </button>
    </div>
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
                  <small>{messagePreview(conversation.last_message, props.t)}</small>
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

function PhoneIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.6 3.8 9 3.2l1.6 4.1-1.7 1.5c1.2 2.5 3 4.3 5.5 5.5l1.5-1.7 4.1 1.6-.6 2.4c-.4 1.7-2 2.8-3.8 2.5C9.8 18.1 5.1 13.4 4.1 7.6c-.3-1.8.8-3.4 2.5-3.8Z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>;
}

function CameraIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="6" width="13" height="12" rx="2" fill="none" stroke="currentColor" strokeWidth="1.6"/><path d="m16 10 5-3v10l-5-3Z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"/></svg>;
}

function ImageIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2" fill="none" stroke="currentColor" strokeWidth="1.6"/><circle cx="8.5" cy="9" r="1.5" fill="currentColor"/><path d="m5 18 5-5 3 3 2-2 4 4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"/></svg>;
}

function VideoFileIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="13" height="14" rx="2" fill="none" stroke="currentColor" strokeWidth="1.6"/><path d="m16 10 5-3v10l-5-3Z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"/></svg>;
}

function FileIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h8l4 4v14H6Z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"/><path d="M14 3v5h5M9 12h6M9 16h6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg>;
}

function MicrophoneIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3" fill="none" stroke="currentColor" strokeWidth="1.7"/><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3M9 21h6" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/></svg>;
}

function StickerIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 3h14a2 2 0 0 1 2 2v9l-7 7H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" fill="none" stroke="currentColor" strokeWidth="1.6"/><path d="M14 21v-5a2 2 0 0 1 2-2h5M8 9h.01M16 9h.01M8 13c1.1 1.2 2.4 1.8 4 1.8s2.9-.6 4-1.8" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg>;
}

function SmileIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="1.7" />
      <circle cx="9" cy="10" r="1" fill="currentColor" />
      <circle cx="15" cy="10" r="1" fill="currentColor" />
      <path
        d="M8.2 14.1c1 1.3 2.2 1.9 3.8 1.9s2.8-.6 3.8-1.9"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
  );
}

function composerMaximumHeight(paneHeight: number) {
  const proportionalLimit = Math.floor(paneHeight * 0.62);
  const messageSpaceLimit = paneHeight - 150;
  return Math.max(
    COMPOSER_MIN_HEIGHT,
    Math.min(proportionalLimit, messageSpaceLimit),
  );
}

function clampComposerHeight(height: number, paneHeight: number) {
  return Math.min(
    composerMaximumHeight(paneHeight),
    Math.max(COMPOSER_MIN_HEIGHT, height),
  );
}

function clampListPaneWidth(width: number) {
  const viewportLimit = typeof window === "undefined"
    ? LIST_PANE_MAX_WIDTH
    : Math.max(LIST_PANE_MIN_WIDTH, window.innerWidth - 58 - 320);
  return Math.round(Math.min(LIST_PANE_MAX_WIDTH, viewportLimit, Math.max(LIST_PANE_MIN_WIDTH, width)));
}

function readStoredListPaneWidth() {
  const raw = localStorage.getItem(LIST_PANE_WIDTH_KEY);
  const value = raw ? Number(raw) : DEFAULT_LIST_PANE_WIDTH;
  return Number.isFinite(value) ? clampListPaneWidth(value) : DEFAULT_LIST_PANE_WIDTH;
}

function normalizedMediaFileName(name: string, kind: MediaKind) {
  const trimmed = name.trim();
  if (trimmed) return trimmed.slice(0, 180);
  const extension = kind === "image" || kind === "sticker" ? "png" : kind === "video" ? "webm" : kind === "voice" ? "webm" : "bin";
  return `${kind}-${Date.now()}.${extension}`;
}

async function readImageMetadata(blob: Blob): Promise<{ width: number; height: number }> {
  if (typeof createImageBitmap === "function") {
    const bitmap = await createImageBitmap(blob);
    const metadata = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return metadata;
  }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => {
      const metadata = { width: image.naturalWidth, height: image.naturalHeight };
      URL.revokeObjectURL(url);
      resolve(metadata);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Unable to read image metadata"));
    };
    image.src = url;
  });
}

async function readVideoMetadata(blob: Blob): Promise<{ width?: number; height?: number; duration_ms?: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const video = document.createElement("video");
    video.preload = "metadata";
    video.onloadedmetadata = () => {
      const result = {
        width: video.videoWidth || undefined,
        height: video.videoHeight || undefined,
        duration_ms: Number.isFinite(video.duration) ? Math.round(video.duration * 1000) : undefined,
      };
      URL.revokeObjectURL(url);
      resolve(result);
    };
    video.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Unable to read video metadata"));
    };
    video.src = url;
  });
}

function clipboardImageFile(data: DataTransfer): File | null {
  for (const item of Array.from(data.items)) {
    if (item.kind !== "file" || !item.type.startsWith("image/")) continue;
    const file = item.getAsFile();
    if (file) return namedClipboardImage(file);
  }

  const file = Array.from(data.files).find((candidate) =>
    candidate.type.startsWith("image/"),
  );
  return file ? namedClipboardImage(file) : null;
}

function namedClipboardImage(file: File): File {
  if (file.name.trim()) return file;
  const extension = file.type.includes("jpeg")
    ? "jpg"
    : file.type.includes("webp")
      ? "webp"
      : file.type.includes("gif")
        ? "gif"
        : "png";
  return new File([file], `clipboard-${Date.now()}.${extension}`, {
    type: file.type || "image/png",
    lastModified: Date.now(),
  });
}

function emojiStickerBlob(emoji: string): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 256;
    const context = canvas.getContext("2d");
    if (!context) {
      reject(new Error("Canvas is unavailable"));
      return;
    }
    context.clearRect(0, 0, 256, 256);
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.font = '176px "Noto Color Emoji", "Segoe UI Emoji", sans-serif';
    context.fillText(emoji, 128, 132);
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Sticker rendering failed")), "image/png");
  });
}

function preferredRecordingMimeType() {
  const candidates = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/webm", "audio/ogg"];
  return candidates.find((value) => MediaRecorder.isTypeSupported(value)) ?? "";
}

function recordingFileExtension(contentType: string) {
  return contentType.includes("ogg") ? "ogg" : contentType.includes("mp4") ? "m4a" : "webm";
}

function formatRecordingTime(seconds: number) {
  return `0:${String(Math.max(0, seconds)).padStart(2, "0")}`;
}

function mediaAccessError(reason: unknown, t: Translation) {
  if (reason instanceof DOMException) {
    if (["NotAllowedError", "SecurityError"].includes(reason.name)) {
      return t.mediaPermissionDenied;
    }
    if (reason.name === "NotFoundError") return t.mediaDeviceNotFound;
    if (["NotReadableError", "AbortError"].includes(reason.name)) {
      return t.mediaDeviceUnavailable;
    }
  }
  return readableError(reason);
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

const CONTACT_CARD_PREFIX = "[[contact-card:v1]]";

type ContactCardPayload = {
  account_id: string;
  display_name: string;
  chat_id: string;
  avatar_data_url?: string | null;
};

function encodeContactCard(account: Account): string {
  const payload: ContactCardPayload = {
    account_id: account.account_id,
    display_name: account.display_name,
    chat_id: account.chat_id,
    avatar_data_url: account.avatar_data_url,
  };
  return `${CONTACT_CARD_PREFIX}${JSON.stringify(payload)}`;
}

function decodeContactCard(body: string): ContactCardPayload | null {
  if (!body.startsWith(CONTACT_CARD_PREFIX)) return null;
  try {
    const parsed = JSON.parse(body.slice(CONTACT_CARD_PREFIX.length)) as Partial<ContactCardPayload>;
    if (
      typeof parsed.account_id !== "string" ||
      typeof parsed.display_name !== "string" ||
      typeof parsed.chat_id !== "string"
    ) {
      return null;
    }
    return parsed as ContactCardPayload;
  } catch {
    return null;
  }
}

function MessageContent({
  body,
  payloadFormat,
  accessToken,
  t,
  onOpenContactCard,
}: {
  body: string;
  payloadFormat: ChatMessage["payload_format"];
  accessToken: string;
  t: Translation;
  onOpenContactCard(card: ContactCardPayload): void;
}) {
  if (payloadFormat === "media_v0" || payloadFormat === "sticker_v0") {
    const payload = parseMediaMessage(body);
    return payload ? (
      <MediaMessage
        accessToken={accessToken}
        payload={payload}
        t={t}
        sticker={payloadFormat === "sticker_v0"}
      />
    ) : <p>{t.uploadFailed}</p>;
  }
  const card = decodeContactCard(body);
  if (!card) return <p>{body}</p>;
  return (
    <button
      className="contact-message-card"
      type="button"
      onClick={() => onOpenContactCard(card)}
    >
      <span className="contact-message-card-main">
        <Avatar
          label={card.display_name}
          avatarUrl={card.avatar_data_url}
        />
        <span>
          <strong>{card.display_name}</strong>
          <small>{card.chat_id}</small>
        </span>
      </span>
      <span className="contact-message-card-footer">{t.contactCard}</span>
    </button>
  );
}

function readableError(reason: unknown): string {
  if (reason instanceof ApiError) return `${reason.message} (${reason.code})`;
  if (reason instanceof Error) return reason.message;
  return String(reason);
}

function messagePreview(message: ChatMessage | null, t: Translation) {
  if (!message) return t.noMessagesYet;
  if (message.payload_format === "media_v0" || message.payload_format === "sticker_v0") {
    const media = parseMediaMessage(message.body);
    if (!media) return t.file;
    return media.media_kind === "image" ? `[${t.image}]`
      : media.media_kind === "video" ? `[${t.video}]`
      : media.media_kind === "voice" ? `[${t.voiceMessage}]`
      : media.media_kind === "sticker" ? `[${t.sticker}]`
      : `[${t.file}]`;
  }
  return message.body;
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
