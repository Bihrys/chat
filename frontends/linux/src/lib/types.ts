export interface Account {
  account_id: string;
  username: string;
  display_name: string;
  chat_id: string;
  avatar_data_url?: string | null;
  remark_name?: string | null;
  source?: string | null;
  tags?: string | null;
  friend_permission?: "all" | "chat_only";
  is_starred?: boolean;
  is_blocked?: boolean;
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
  payload_format: "plaintext_dev_v0" | "media_v0" | "sticker_v0" | "recalled_v0" | "unknown";
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
  is_pinned: boolean;
  is_muted: boolean;
  last_message: ChatMessage | null;
}

export interface CommonGroup {
  group_id: string;
  conversation_id: string;
  group_code: string;
  name: string;
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


export type GroupJoinRequestStatus = "pending" | "accepted" | "rejected";

export interface GroupDiscovery {
  group_id: string;
  conversation_id: string;
  group_code: string;
  name: string;
  member_count: number;
  actor_role: GroupRole | null;
  join_request_status: GroupJoinRequestStatus | null;
}

export interface GroupJoinRequest {
  request_id: string;
  group_id: string;
  applicant_account_id: string;
  message: string;
  status: GroupJoinRequestStatus;
  created_at: string;
  updated_at: string;
}


export type MediaKind = "image" | "video" | "voice" | "sticker" | "file";

export interface MediaObject {
  object_id: string;
  conversation_id: string;
  owner_account_id: string;
  media_kind: MediaKind;
  file_name: string;
  content_type: string;
  byte_len: number;
  created_at: string;
}

export interface MediaMessagePayload {
  object_id: string;
  media_kind: MediaKind;
  file_name: string;
  content_type: string;
  byte_len: number;
  duration_ms?: number;
  width?: number;
  height?: number;
}

export type CallMedia = "audio" | "video";
export type CallSignalType = "offer" | "answer" | "ice" | "hangup" | "reject" | "busy";

export interface CallSignal {
  call_id: string;
  conversation_id: string;
  from_account_id: string;
  to_account_id: string;
  media: CallMedia;
  signal_type: CallSignalType;
  payload: unknown;
}

export interface UiPreferences {
  locale: "zh-CN" | "en";
  theme: "dark" | "light";
  font_size_level: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
}

export type ServerEvent =
  | { type: "connected"; payload: { account_id: string } }
  | { type: "message_created"; payload: { message: ChatMessage } }
  | { type: "message_recalled"; payload: { message: ChatMessage } }
  | { type: "call_signal"; payload: { signal: CallSignal } }
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
