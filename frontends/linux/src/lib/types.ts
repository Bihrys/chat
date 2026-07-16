export interface Account {
  account_id: string;
  username: string;
  display_name: string;
  chat_id: string;
  created_at: string;
}

export interface AuthSession {
  access_token: string;
  expires_at: string;
  account: Account;
}

export interface FriendRequest {
  request_id: string;
  sender_account_id: string;
  recipient_account_id: string;
  message: string;
  status: "pending" | "accepted" | "rejected" | "cancelled";
  created_at: string;
  updated_at: string;
  peer: Account;
}

export interface FriendRequestMailbox {
  incoming: FriendRequest[];
  outgoing: FriendRequest[];
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

export type GroupRole = "owner" | "admin" | "member";

export interface Conversation {
  conversation_id: string;
  kind: "direct" | "group";
  peer_account_id: string | null;
  group_id: string | null;
  group_code: string | null;
  group_name: string | null;
  group_role: GroupRole | null;
  member_count: number | null;
  created_at: string;
  last_message_at: string | null;
  unread_count: number;
  last_message: ChatMessage | null;
}

export interface GroupMember {
  account_id: string;
  role: GroupRole;
  joined_at: string;
}

export interface GroupDetails {
  group_id: string;
  conversation_id: string;
  group_code: string;
  name: string;
  owner_account_id: string;
  actor_role: GroupRole;
  created_at: string;
  members: GroupMember[];
}

export type ServerEvent =
  | { type: "connected"; payload: { account_id: string } }
  | { type: "message_created"; payload: { message: ChatMessage } }
  | {
      type: "conversation_read";
      payload: {
        conversation_id: string;
        account_id: string;
        last_read_seq: number;
      };
    }
  | { type: "group_updated"; payload: { group_id: string } };

export type SocketStatus = "connecting" | "online" | "offline";
