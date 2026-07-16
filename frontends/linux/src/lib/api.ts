import {
  ACCOUNT_SERVICE_URL,
  MAILBOX_SERVICE_URL,
} from "./config";
import type { Account, ChatMessage, Conversation } from "./types";

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

interface ErrorPayload {
  code?: string;
  message?: string;
}

async function requestJson<T>(
  url: string,
  init?: RequestInit,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch {
    const origin = new URL(url).origin;
    throw new ApiError(
      0,
      "service_unreachable",
      `Cannot reach the local chat service at ${origin}. Run cargo xtask chat up and cargo xtask chat status.`,
    );
  }
  if (!response.ok) {
    let payload: ErrorPayload = {};
    try {
      payload = (await response.json()) as ErrorPayload;
    } catch {
      // The service might be down or return a non-JSON proxy error.
    }
    throw new ApiError(
      response.status,
      payload.code ?? "request_failed",
      payload.message ?? `Request failed with HTTP ${response.status}`,
    );
  }

  return (await response.json()) as T;
}

function actorHeaders(accountId: string): HeadersInit {
  return {
    "Content-Type": "application/json",
    "X-Chat-Account-Id": accountId,
  };
}

export async function listAccounts(query = ""): Promise<Account[]> {
  const params = new URLSearchParams();
  if (query.trim()) {
    params.set("query", query.trim());
  }
  params.set("limit", "100");
  return requestJson<Account[]>(
    `${ACCOUNT_SERVICE_URL}/v1/dev/accounts?${params.toString()}`,
  );
}

export async function createAccount(input: {
  username: string;
  displayName: string;
}): Promise<Account> {
  return requestJson<Account>(`${ACCOUNT_SERVICE_URL}/v1/dev/accounts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: input.username,
      display_name: input.displayName,
    }),
  });
}

export async function listConversations(
  accountId: string,
): Promise<Conversation[]> {
  return requestJson<Conversation[]>(`${MAILBOX_SERVICE_URL}/v1/conversations`, {
    headers: actorHeaders(accountId),
  });
}

export async function createDirectConversation(
  accountId: string,
  peerAccountId: string,
): Promise<Conversation> {
  return requestJson<Conversation>(
    `${MAILBOX_SERVICE_URL}/v1/conversations/direct`,
    {
      method: "POST",
      headers: actorHeaders(accountId),
      body: JSON.stringify({ peer_account_id: peerAccountId }),
    },
  );
}

export async function listMessages(
  accountId: string,
  conversationId: string,
): Promise<ChatMessage[]> {
  const params = new URLSearchParams({ limit: "200" });
  return requestJson<ChatMessage[]>(
    `${MAILBOX_SERVICE_URL}/v1/conversations/${conversationId}/messages?${params.toString()}`,
    { headers: actorHeaders(accountId) },
  );
}

export async function sendMessage(
  accountId: string,
  conversationId: string,
  body: string,
  clientMessageId: string,
): Promise<ChatMessage> {
  return requestJson<ChatMessage>(
    `${MAILBOX_SERVICE_URL}/v1/conversations/${conversationId}/messages`,
    {
      method: "POST",
      headers: actorHeaders(accountId),
      body: JSON.stringify({
        client_message_id: clientMessageId,
        body,
      }),
    },
  );
}

export async function markConversationRead(
  accountId: string,
  conversationId: string,
): Promise<void> {
  await requestJson<{ conversation_id: string; last_read_seq: number }>(
    `${MAILBOX_SERVICE_URL}/v1/conversations/${conversationId}/read`,
    {
      method: "POST",
      headers: actorHeaders(accountId),
      body: "{}",
    },
  );
}
