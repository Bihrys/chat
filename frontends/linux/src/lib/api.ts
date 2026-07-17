import {
  ACCOUNT_SERVICE_URL,
  AUTH_SERVICE_URL,
  MAILBOX_SERVICE_URL,
} from "./config";
import type {
  Account,
  AuthSession,
  ChatMessage,
  CommonGroup,
  Conversation,
  FriendRequestMailbox,
  GroupDetails,
  GroupDiscovery,
  CallMedia,
  CallSignalType,
  GroupJoinRequest,
  GroupRole,
  MediaKind,
  MediaObject,
  UiPreferences,
} from "./types";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function requestJson<T>(url: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch {
    throw new ApiError(
      0,
      "service_unreachable",
      `Unable to reach local service at ${new URL(url).origin}. Start it with cargo xtask chat up.`,
    );
  }
  const text = await response.text();
  if (!response.ok) {
    let code = "request_failed";
    let message = text || `HTTP ${response.status}`;
    try {
      const payload = JSON.parse(text) as { code?: string; message?: string };
      code = payload.code ?? code;
      message = payload.message ?? message;
    } catch {
      // Preserve the raw response when it is not JSON.
    }
    throw new ApiError(response.status, code, message);
  }
  return (text ? JSON.parse(text) : undefined) as T;
}

async function requestBlob(url: string, init: RequestInit = {}): Promise<Blob> {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch {
    throw new ApiError(
      0,
      "service_unreachable",
      `Unable to reach local service at ${new URL(url).origin}. Start it with cargo xtask chat up.`,
    );
  }
  if (!response.ok) {
    const text = await response.text();
    let code = "request_failed";
    let message = text || `HTTP ${response.status}`;
    try {
      const payload = JSON.parse(text) as { code?: string; message?: string };
      code = payload.code ?? code;
      message = payload.message ?? message;
    } catch {
      // Preserve the raw response when it is not JSON.
    }
    throw new ApiError(response.status, code, message);
  }
  return response.blob();
}

function bearerHeaders(accessToken: string, json = false): HeadersInit {
  return {
    authorization: `Bearer ${accessToken}`,
    ...(json ? { "content-type": "application/json" } : {}),
  };
}

export async function registerAccount(input: {
  username: string;
  displayName: string;
  password: string;
}): Promise<AuthSession> {
  return requestJson<AuthSession>(`${AUTH_SERVICE_URL}/v1/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: input.username,
      display_name: input.displayName,
      password: input.password,
    }),
  });
}

export async function loginAccount(input: {
  username: string;
  password: string;
}): Promise<AuthSession> {
  return requestJson<AuthSession>(`${AUTH_SERVICE_URL}/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function getCurrentAccount(accessToken: string): Promise<Account> {
  return requestJson<Account>(`${AUTH_SERVICE_URL}/v1/auth/me`, {
    headers: bearerHeaders(accessToken),
  });
}

export async function logoutAccount(accessToken: string): Promise<void> {
  await requestJson<void>(`${AUTH_SERVICE_URL}/v1/auth/logout`, {
    method: "POST",
    headers: bearerHeaders(accessToken),
  });
}

export async function listContacts(accessToken: string): Promise<Account[]> {
  return requestJson<Account[]>(`${ACCOUNT_SERVICE_URL}/v1/contacts`, {
    headers: bearerHeaders(accessToken),
  });
}

export async function lookupAccount(
  accessToken: string,
  identifier: string,
): Promise<Account> {
  const params = new URLSearchParams({ identifier: identifier.trim() });
  return requestJson<Account>(
    `${ACCOUNT_SERVICE_URL}/v1/accounts/lookup?${params.toString()}`,
    { headers: bearerHeaders(accessToken) },
  );
}

export async function getAccount(
  accessToken: string,
  accountId: string,
): Promise<Account> {
  return requestJson<Account>(`${ACCOUNT_SERVICE_URL}/v1/accounts/${accountId}`, {
    headers: bearerHeaders(accessToken),
  });
}

export async function getContact(
  accessToken: string,
  accountId: string,
): Promise<Account> {
  return requestJson<Account>(`${ACCOUNT_SERVICE_URL}/v1/contacts/${accountId}`, {
    headers: bearerHeaders(accessToken),
  });
}

export async function updateContactRemark(
  accessToken: string,
  accountId: string,
  remarkName: string,
): Promise<Account> {
  return requestJson<Account>(`${ACCOUNT_SERVICE_URL}/v1/contacts/${accountId}`, {
    method: "PATCH",
    headers: bearerHeaders(accessToken, true),
    body: JSON.stringify({ remark_name: remarkName.trim() || null }),
  });
}


export async function updateContactTags(
  accessToken: string,
  accountId: string,
  tags: string,
): Promise<Account> {
  return requestJson<Account>(`${ACCOUNT_SERVICE_URL}/v1/contacts/${accountId}/tags`, {
    method: "PATCH",
    headers: bearerHeaders(accessToken, true),
    body: JSON.stringify({ tags: tags.trim() || null }),
  });
}

export async function updateContactPermission(
  accessToken: string,
  accountId: string,
  permission: "all" | "chat_only",
): Promise<Account> {
  return requestJson<Account>(`${ACCOUNT_SERVICE_URL}/v1/contacts/${accountId}/permission`, {
    method: "PATCH",
    headers: bearerHeaders(accessToken, true),
    body: JSON.stringify({ permission }),
  });
}

export async function updateContactStarred(
  accessToken: string,
  accountId: string,
  enabled: boolean,
): Promise<Account> {
  return requestJson<Account>(`${ACCOUNT_SERVICE_URL}/v1/contacts/${accountId}/star`, {
    method: "PATCH",
    headers: bearerHeaders(accessToken, true),
    body: JSON.stringify({ enabled }),
  });
}

export async function updateContactBlocked(
  accessToken: string,
  accountId: string,
  enabled: boolean,
): Promise<Account> {
  return requestJson<Account>(`${ACCOUNT_SERVICE_URL}/v1/contacts/${accountId}/block`, {
    method: "PATCH",
    headers: bearerHeaders(accessToken, true),
    body: JSON.stringify({ enabled }),
  });
}

export async function deleteContact(
  accessToken: string,
  accountId: string,
): Promise<void> {
  await requestJson<void>(`${ACCOUNT_SERVICE_URL}/v1/contacts/${accountId}`, {
    method: "DELETE",
    headers: bearerHeaders(accessToken),
  });
}

export async function updateAvatar(
  accessToken: string,
  avatarDataUrl: string | null,
): Promise<Account> {
  return requestJson<Account>(`${ACCOUNT_SERVICE_URL}/v1/profile/avatar`, {
    method: "PATCH",
    headers: bearerHeaders(accessToken, true),
    body: JSON.stringify({ avatar_data_url: avatarDataUrl }),
  });
}

export async function getUiPreferences(
  accessToken: string,
): Promise<UiPreferences> {
  return requestJson<UiPreferences>(`${ACCOUNT_SERVICE_URL}/v1/profile/ui-preferences`, {
    headers: bearerHeaders(accessToken),
  });
}

export async function updateUiPreferences(
  accessToken: string,
  preferences: UiPreferences,
): Promise<UiPreferences> {
  return requestJson<UiPreferences>(`${ACCOUNT_SERVICE_URL}/v1/profile/ui-preferences`, {
    method: "PATCH",
    headers: bearerHeaders(accessToken, true),
    body: JSON.stringify(preferences),
  });
}

export async function listFriendRequests(
  accessToken: string,
): Promise<FriendRequestMailbox> {
  return requestJson<FriendRequestMailbox>(
    `${ACCOUNT_SERVICE_URL}/v1/friend-requests`,
    { headers: bearerHeaders(accessToken) },
  );
}

export async function sendFriendRequest(
  accessToken: string,
  recipientAccountId: string,
  message: string,
): Promise<{ request_id: string }> {
  return requestJson<{ request_id: string }>(`${ACCOUNT_SERVICE_URL}/v1/friend-requests`, {
    method: "POST",
    headers: bearerHeaders(accessToken, true),
    body: JSON.stringify({
      recipient_account_id: recipientAccountId,
      message,
    }),
  });
}

export async function respondFriendRequest(
  accessToken: string,
  requestId: string,
  response: "accept" | "reject",
): Promise<void> {
  await requestJson<void>(
    `${ACCOUNT_SERVICE_URL}/v1/friend-requests/${requestId}/${response}`,
    { method: "POST", headers: bearerHeaders(accessToken, true), body: "{}" },
  );
}

export async function listConversations(
  accessToken: string,
): Promise<Conversation[]> {
  return requestJson<Conversation[]>(`${MAILBOX_SERVICE_URL}/v1/conversations`, {
    headers: bearerHeaders(accessToken),
  });
}

export async function createDirectConversation(
  accessToken: string,
  peerAccountId: string,
): Promise<Conversation> {
  return requestJson<Conversation>(
    `${MAILBOX_SERVICE_URL}/v1/conversations/direct`,
    {
      method: "POST",
      headers: bearerHeaders(accessToken, true),
      body: JSON.stringify({ peer_account_id: peerAccountId }),
    },
  );
}


export async function updateConversationPreferences(
  accessToken: string,
  conversationId: string,
  input: { isPinned: boolean; isMuted: boolean },
): Promise<void> {
  await requestJson<void>(
    `${MAILBOX_SERVICE_URL}/v1/conversations/${conversationId}/preferences`,
    {
      method: "PATCH",
      headers: bearerHeaders(accessToken, true),
      body: JSON.stringify({
        is_pinned: input.isPinned,
        is_muted: input.isMuted,
      }),
    },
  );
}

export async function clearConversationHistory(
  accessToken: string,
  conversationId: string,
): Promise<void> {
  await requestJson<void>(
    `${MAILBOX_SERVICE_URL}/v1/conversations/${conversationId}/history`,
    { method: "DELETE", headers: bearerHeaders(accessToken) },
  );
}

export async function listCommonGroups(
  accessToken: string,
  accountId: string,
): Promise<CommonGroup[]> {
  return requestJson<CommonGroup[]>(
    `${MAILBOX_SERVICE_URL}/v1/contacts/${accountId}/common-groups`,
    { headers: bearerHeaders(accessToken) },
  );
}

export async function createGroup(
  accessToken: string,
  name: string,
  memberAccountIds: string[],
): Promise<GroupDetails> {
  return requestJson<GroupDetails>(`${MAILBOX_SERVICE_URL}/v1/groups`, {
    method: "POST",
    headers: bearerHeaders(accessToken, true),
    body: JSON.stringify({ name, member_account_ids: memberAccountIds }),
  });
}


export async function lookupGroup(
  accessToken: string,
  identifier: string,
): Promise<GroupDiscovery> {
  const params = new URLSearchParams({ identifier: identifier.trim() });
  return requestJson<GroupDiscovery>(
    `${MAILBOX_SERVICE_URL}/v1/groups/lookup?${params.toString()}`,
    { headers: bearerHeaders(accessToken) },
  );
}

export async function requestToJoinGroup(
  accessToken: string,
  groupId: string,
  message: string,
): Promise<{ request_id: string }> {
  return requestJson<{ request_id: string }>(
    `${MAILBOX_SERVICE_URL}/v1/groups/${groupId}/join-requests`,
    {
      method: "POST",
      headers: bearerHeaders(accessToken, true),
      body: JSON.stringify({ message }),
    },
  );
}

export async function listGroupJoinRequests(
  accessToken: string,
  groupId: string,
): Promise<GroupJoinRequest[]> {
  return requestJson<GroupJoinRequest[]>(
    `${MAILBOX_SERVICE_URL}/v1/groups/${groupId}/join-requests`,
    { headers: bearerHeaders(accessToken) },
  );
}

export async function respondGroupJoinRequest(
  accessToken: string,
  groupId: string,
  requestId: string,
  response: "accept" | "reject",
): Promise<void> {
  await requestJson<void>(
    `${MAILBOX_SERVICE_URL}/v1/groups/${groupId}/join-requests/${requestId}/${response}`,
    {
      method: "POST",
      headers: bearerHeaders(accessToken, true),
      body: "{}",
    },
  );
}

export async function getGroup(
  accessToken: string,
  groupId: string,
): Promise<GroupDetails> {
  return requestJson<GroupDetails>(`${MAILBOX_SERVICE_URL}/v1/groups/${groupId}`, {
    headers: bearerHeaders(accessToken),
  });
}

export async function addGroupMember(
  accessToken: string,
  groupId: string,
  accountId: string,
): Promise<void> {
  await requestJson<void>(`${MAILBOX_SERVICE_URL}/v1/groups/${groupId}/members`, {
    method: "POST",
    headers: bearerHeaders(accessToken, true),
    body: JSON.stringify({ account_id: accountId }),
  });
}

export async function removeGroupMember(
  accessToken: string,
  groupId: string,
  accountId: string,
): Promise<void> {
  await requestJson<void>(
    `${MAILBOX_SERVICE_URL}/v1/groups/${groupId}/members/${accountId}`,
    { method: "DELETE", headers: bearerHeaders(accessToken) },
  );
}

export async function setGroupMemberRole(
  accessToken: string,
  groupId: string,
  accountId: string,
  role: Exclude<GroupRole, "owner">,
): Promise<void> {
  await requestJson<void>(
    `${MAILBOX_SERVICE_URL}/v1/groups/${groupId}/members/${accountId}/role`,
    {
      method: "POST",
      headers: bearerHeaders(accessToken, true),
      body: JSON.stringify({ role }),
    },
  );
}

export async function dissolveGroup(
  accessToken: string,
  groupId: string,
): Promise<void> {
  await requestJson<void>(`${MAILBOX_SERVICE_URL}/v1/groups/${groupId}`, {
    method: "DELETE",
    headers: bearerHeaders(accessToken),
  });
}

export async function listMessages(
  accessToken: string,
  conversationId: string,
): Promise<ChatMessage[]> {
  const params = new URLSearchParams({ limit: "200" });
  return requestJson<ChatMessage[]>(
    `${MAILBOX_SERVICE_URL}/v1/conversations/${conversationId}/messages?${params.toString()}`,
    { headers: bearerHeaders(accessToken) },
  );
}

export async function searchMessages(
  accessToken: string,
  conversationId: string,
  query: string,
  limit = 200,
): Promise<ChatMessage[]> {
  const params = new URLSearchParams({ q: query, limit: String(limit) });
  return requestJson<ChatMessage[]>(
    `${MAILBOX_SERVICE_URL}/v1/conversations/${conversationId}/messages/search?${params.toString()}`,
    { headers: bearerHeaders(accessToken) },
  );
}

export async function sendMessage(
  accessToken: string,
  conversationId: string,
  body: string,
  clientMessageId: string,
  payloadFormat: "plaintext_dev_v0" | "media_v0" | "sticker_v0" = "plaintext_dev_v0",
): Promise<ChatMessage> {
  return requestJson<ChatMessage>(
    `${MAILBOX_SERVICE_URL}/v1/conversations/${conversationId}/messages`,
    {
      method: "POST",
      headers: bearerHeaders(accessToken, true),
      body: JSON.stringify({
        client_message_id: clientMessageId,
        payload_format: payloadFormat,
        body,
      }),
    },
  );
}

export async function uploadMedia(
  accessToken: string,
  conversationId: string,
  file: Blob,
  input: { kind: MediaKind; fileName: string },
): Promise<MediaObject> {
  const params = new URLSearchParams({
    kind: input.kind,
    file_name: input.fileName,
  });
  return requestJson<MediaObject>(
    `${MAILBOX_SERVICE_URL}/v1/conversations/${conversationId}/media?${params.toString()}`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": file.type || "application/octet-stream",
      },
      body: file,
    },
  );
}

export async function downloadMedia(
  accessToken: string,
  objectId: string,
): Promise<Blob> {
  return requestBlob(`${MAILBOX_SERVICE_URL}/v1/media/${objectId}`, {
    headers: bearerHeaders(accessToken),
  });
}

export async function sendCallSignal(
  accessToken: string,
  input: {
    callId: string;
    conversationId: string;
    toAccountId: string;
    media: CallMedia;
    signalType: CallSignalType;
    payload?: unknown;
  },
): Promise<void> {
  await requestJson<void>(`${MAILBOX_SERVICE_URL}/v1/calls/signals`, {
    method: "POST",
    headers: bearerHeaders(accessToken, true),
    body: JSON.stringify({
      call_id: input.callId,
      conversation_id: input.conversationId,
      to_account_id: input.toAccountId,
      media: input.media,
      signal_type: input.signalType,
      payload: input.payload ?? null,
    }),
  });
}

export async function markConversationRead(
  accessToken: string,
  conversationId: string,
): Promise<void> {
  await requestJson<{ conversation_id: string; last_read_seq: number }>(
    `${MAILBOX_SERVICE_URL}/v1/conversations/${conversationId}/read`,
    { method: "POST", headers: bearerHeaders(accessToken, true), body: "{}" },
  );
}
