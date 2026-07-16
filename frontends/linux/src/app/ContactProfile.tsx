import { useEffect, useState } from "react";
import type { Account, CommonGroup } from "../lib/types";
import type { Translation } from "../lib/preferences";
import { UserAvatar } from "./UserAvatar";

export function ContactProfile({
  account,
  commonGroups,
  busy,
  t,
  onSaveRemark,
  onStartChat,
  onOpenGroup,
}: {
  account: Account;
  commonGroups: CommonGroup[];
  busy: boolean;
  t: Translation;
  onSaveRemark(value: string): Promise<void>;
  onStartChat(): void;
  onOpenGroup(conversationId: string): void;
}) {
  const [editing, setEditing] = useState(false);
  const [remark, setRemark] = useState(account.remark_name ?? "");

  useEffect(() => {
    setRemark(account.remark_name ?? "");
    setEditing(false);
  }, [account.account_id, account.remark_name]);

  const displayName = account.remark_name?.trim() || account.display_name;

  return (
    <div className="contact-profile">
      <section className="contact-profile-card">
        <div className="contact-profile-heading">
          <UserAvatar
            label={displayName}
            avatarUrl={account.avatar_data_url}
            large
          />
          <div>
            <h1>{displayName}</h1>
            {account.remark_name && <p>{account.display_name}</p>}
          </div>
        </div>

        <dl className="contact-profile-fields">
          <div>
            <dt>{t.remarkName}</dt>
            <dd>
              {editing ? (
                <form
                  className="remark-editor"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void onSaveRemark(remark)
                      .then(() => setEditing(false))
                      .catch(() => undefined);
                  }}
                >
                  <input
                    autoFocus
                    maxLength={64}
                    value={remark}
                    onChange={(event) => setRemark(event.target.value)}
                    placeholder={account.display_name}
                  />
                  <button type="submit" disabled={busy}>{t.save}</button>
                  <button type="button" onClick={() => setEditing(false)}>{t.cancel}</button>
                </form>
              ) : (
                <button className="profile-value-button" type="button" onClick={() => setEditing(true)}>
                  {account.remark_name || t.notSet}
                </button>
              )}
            </dd>
          </div>
          <div>
            <dt>{t.username}</dt>
            <dd>{account.username}</dd>
          </div>
          <div>
            <dt>{t.chatId}</dt>
            <dd>{account.chat_id}</dd>
          </div>
          <div>
            <dt>{t.commonGroups}</dt>
            <dd>
              {commonGroups.length === 0 ? (
                <span>{t.noCommonGroups}</span>
              ) : (
                <span className="common-group-links">
                  {commonGroups.map((group) => (
                    <button
                      key={group.group_id}
                      type="button"
                      onClick={() => onOpenGroup(group.conversation_id)}
                    >
                      {group.name}
                    </button>
                  ))}
                </span>
              )}
            </dd>
          </div>
          <div>
            <dt>{t.source}</dt>
            <dd>{account.source === "friend_request" ? t.addedByFriendRequest : t.unknownSource}</dd>
          </div>
        </dl>

        <button className="contact-chat-button" type="button" onClick={onStartChat} disabled={busy}>
          {t.startChat}
        </button>
      </section>
    </div>
  );
}
