import type { Account, Conversation } from "../lib/types";
import type { Translation } from "../lib/preferences";
import { PlusIcon, SearchIcon } from "./PreferenceIcons";
import { UserAvatar } from "./UserAvatar";

export function DirectChatDetails({
  open,
  peer,
  conversation,
  searchQuery,
  t,
  busy,
  onSearchQueryChange,
  onOpenPeer,
  onStartGroup,
  onToggleMuted,
  onTogglePinned,
  onClearHistory,
  onClose,
}: {
  open: boolean;
  peer: Account | null;
  conversation: Conversation;
  searchQuery: string;
  t: Translation;
  busy: boolean;
  onSearchQueryChange(value: string): void;
  onOpenPeer(): void;
  onStartGroup(): void;
  onToggleMuted(): void;
  onTogglePinned(): void;
  onClearHistory(): void;
  onClose(): void;
}) {
  if (!open) return null;
  const name = peer?.remark_name || peer?.display_name || t.unknownUser;
  return (
    <aside className="chat-details-drawer">
      <header>
        <h2>{t.chatDetails}</h2>
        <button type="button" onClick={onClose}>×</button>
      </header>

      <div className="chat-details-people">
        <button className="chat-details-person" type="button" onClick={onOpenPeer}>
          <UserAvatar label={name} avatarUrl={peer?.avatar_data_url} />
          <span>{name}</span>
        </button>
        <button className="chat-details-add" type="button" onClick={onStartGroup}>
          <span><PlusIcon /></span>
          <small>{t.add}</small>
        </button>
      </div>

      <label className="chat-details-search">
        <SearchIcon />
        <input
          value={searchQuery}
          onChange={(event) => onSearchQueryChange(event.target.value)}
          placeholder={t.searchChatContent}
        />
      </label>

      <button className="settings-row" type="button" onClick={onToggleMuted} disabled={busy}>
        <span>{t.muteNotifications}</span>
        <span className={`switch ${conversation.is_muted ? "on" : ""}`}><i /></span>
      </button>
      <button className="settings-row" type="button" onClick={onTogglePinned} disabled={busy}>
        <span>{t.pinChat}</span>
        <span className={`switch ${conversation.is_pinned ? "on" : ""}`}><i /></span>
      </button>
      <button className="chat-details-clear" type="button" onClick={onClearHistory} disabled={busy}>
        {t.clearChatHistory}
      </button>
    </aside>
  );
}
