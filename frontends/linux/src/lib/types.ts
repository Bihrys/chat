export interface Account {
  account_id: string;
  username: string;
  display_name: string;
  created_at: string;
}

export interface AuthSession {
  access_token: string;
  expires_at: string;
  account: Account;
}

export interface ChatMessage {
  message_seq: number;
  message_id: string;
  conversation_id: string;
  sender_account_id: string;
  client_message_id: string;
  payload_format: "plaintext_dev_v0" | "unknown";
  body: string;
  created_at: string;
}

export interface Conversation {
  conversation_id: string;
  peer_account_id: string;
  created_at: string;
  last_message_at: string | null;
  unread_count: number;
  last_message: ChatMessage | null;
}

export type ServerEvent =
  | {
      type: "connected";
      payload: { account_id: string };
    }
  | {
      type: "message_created";
      payload: { message: ChatMessage };
    }
  | {
      type: "conversation_read";
      payload: {
        conversation_id: string;
        account_id: string;
        last_read_seq: number;
      };
    };

export type SocketStatus = "connecting" | "online" | "offline";
