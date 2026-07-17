import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { Account, CommonGroup } from "../lib/types";
import type { Translation } from "../lib/preferences";
import { UserAvatar } from "./UserAvatar";

type ContactActions = {
  onSaveRemark(value: string): Promise<void>;
  onSaveTags(value: string): Promise<void>;
  onSetPermission(value: "all" | "chat_only"): Promise<void>;
  onToggleStarred(): Promise<void>;
  onToggleBlocked(): Promise<void>;
  onDelete(): Promise<void>;
  onRecommend(recipientAccountId: string): Promise<void>;
};

type ContactProfileProps = ContactActions & {
  account: Account;
  commonGroups: CommonGroup[];
  contacts: Account[];
  busy: boolean;
  t: Translation;
  compact?: boolean;
  onStartChat(): void;
  onOpenGroup(conversationId: string): void;
  onClose?: () => void;
};

type DialogMode = "identity" | "permission" | "recommend" | null;

export function ContactProfile(props: ContactProfileProps) {
  return (
    <div className={props.compact ? "contact-popover-wrap" : "contact-profile"}>
      <ContactProfileCard {...props} />
    </div>
  );
}

export function ContactProfilePopover(props: ContactProfileProps) {
  return (
    <div className="contact-popover-backdrop" onMouseDown={props.onClose}>
      <div className="contact-popover-anchor" onMouseDown={(event) => event.stopPropagation()}>
        <ContactProfileCard {...props} compact />
      </div>
    </div>
  );
}

function ContactProfileCard(props: ContactProfileProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [dialog, setDialog] = useState<DialogMode>(null);
  const [remark, setRemark] = useState(props.account.remark_name ?? "");
  const [tags, setTags] = useState(props.account.tags ?? "");
  const [permission, setPermission] = useState<"all" | "chat_only">(
    props.account.friend_permission ?? "all",
  );
  const [recommendRecipient, setRecommendRecipient] = useState("");

  useEffect(() => {
    setRemark(props.account.remark_name ?? "");
    setTags(props.account.tags ?? "");
    setPermission(props.account.friend_permission ?? "all");
    setMenuOpen(false);
    setDialog(null);
  }, [
    props.account.account_id,
    props.account.friend_permission,
    props.account.remark_name,
    props.account.tags,
  ]);

  const displayName = props.account.remark_name?.trim() || props.account.display_name;
  const recommendContacts = useMemo(
    () => props.contacts.filter((contact) => contact.account_id !== props.account.account_id),
    [props.account.account_id, props.contacts],
  );

  return (
    <section className={`contact-profile-card ${props.compact ? "compact" : ""}`}>
      <div className="contact-card-menu-anchor">
        <button
          className="contact-more-button"
          type="button"
          aria-label={props.t.more}
          onClick={() => setMenuOpen((open) => !open)}
        >
          ···
        </button>
        {menuOpen && (
          <div className="contact-action-menu">
            <button type="button" onClick={() => { setMenuOpen(false); setDialog("identity"); }}>
              {props.t.setRemarkAndTags}
            </button>
            <button type="button" onClick={() => { setMenuOpen(false); setDialog("permission"); }}>
              {props.t.setFriendPermission}
            </button>
            <button type="button" onClick={() => { setMenuOpen(false); setDialog("recommend"); }}>
              {props.t.recommendToFriend}
            </button>
            <button
              type="button"
              onClick={() => {
                setMenuOpen(false);
                void props.onToggleStarred();
              }}
            >
              {props.account.is_starred ? props.t.unstarContact : props.t.starContact}
            </button>
            <button
              type="button"
              onClick={() => {
                setMenuOpen(false);
                void props.onToggleBlocked();
              }}
            >
              {props.account.is_blocked ? props.t.removeFromBlacklist : props.t.addToBlacklist}
            </button>
            <button
              className="danger"
              type="button"
              onClick={() => {
                setMenuOpen(false);
                if (window.confirm(props.t.deleteContactConfirm)) void props.onDelete();
              }}
            >
              {props.t.deleteContact}
            </button>
          </div>
        )}
      </div>

      <div className="contact-profile-heading">
        <UserAvatar
          label={displayName}
          avatarUrl={props.account.avatar_data_url}
          large
        />
        <div>
          <h1>
            {displayName}
            {props.account.is_starred && <span className="star-mark" aria-label={props.t.starContact}>★</span>}
          </h1>
          {props.account.remark_name && <p>{props.account.display_name}</p>}
          {props.account.is_blocked && <p className="blocked-mark">{props.t.blacklisted}</p>}
        </div>
      </div>

      <dl className="contact-profile-fields">
        <div>
          <dt>{props.t.remarkName}</dt>
          <dd>{props.account.remark_name || props.t.notSet}</dd>
        </div>
        <div>
          <dt>{props.t.tags}</dt>
          <dd>{props.account.tags || props.t.notSet}</dd>
        </div>
        <div>
          <dt>{props.t.username}</dt>
          <dd>{props.account.username}</dd>
        </div>
        <div>
          <dt>{props.t.chatId}</dt>
          <dd>{props.account.chat_id}</dd>
        </div>
        <div>
          <dt>{props.t.commonGroups}</dt>
          <dd>
            {props.commonGroups.length === 0 ? (
              <span>{props.t.noCommonGroups}</span>
            ) : (
              <span className="common-group-links">
                {props.commonGroups.map((group) => (
                  <button
                    key={group.group_id}
                    type="button"
                    onClick={() => props.onOpenGroup(group.conversation_id)}
                  >
                    {group.name}
                  </button>
                ))}
              </span>
            )}
          </dd>
        </div>
        <div>
          <dt>{props.t.source}</dt>
          <dd>{props.account.source === "friend_request" ? props.t.addedByFriendRequest : props.t.unknownSource}</dd>
        </div>
      </dl>

      <button className="contact-chat-button" type="button" onClick={props.onStartChat} disabled={props.busy}>
        {props.t.startChat}
      </button>

      {dialog === "identity" && (
        <ProfileDialog title={props.t.setRemarkAndTags} onClose={() => setDialog(null)}>
          <label>
            {props.t.remarkName}
            <input maxLength={64} value={remark} onChange={(event) => setRemark(event.target.value)} />
          </label>
          <label>
            {props.t.tags}
            <input maxLength={256} value={tags} onChange={(event) => setTags(event.target.value)} />
          </label>
          <button
            className="primary-button full"
            type="button"
            disabled={props.busy}
            onClick={() => {
              void (async () => {
                await props.onSaveRemark(remark);
                await props.onSaveTags(tags);
                setDialog(null);
              })();
            }}
          >
            {props.t.save}
          </button>
        </ProfileDialog>
      )}

      {dialog === "permission" && (
        <ProfileDialog title={props.t.setFriendPermission} onClose={() => setDialog(null)}>
          <label className="permission-choice">
            <input
              type="radio"
              checked={permission === "all"}
              onChange={() => setPermission("all")}
            />
            <span>
              <strong>{props.t.permissionAll}</strong>
              <small>{props.t.permissionAllDescription}</small>
            </span>
          </label>
          <label className="permission-choice">
            <input
              type="radio"
              checked={permission === "chat_only"}
              onChange={() => setPermission("chat_only")}
            />
            <span>
              <strong>{props.t.permissionChatOnly}</strong>
              <small>{props.t.permissionChatOnlyDescription}</small>
            </span>
          </label>
          <button
            className="primary-button full"
            type="button"
            disabled={props.busy}
            onClick={() => void props.onSetPermission(permission).then(() => setDialog(null))}
          >
            {props.t.save}
          </button>
        </ProfileDialog>
      )}

      {dialog === "recommend" && (
        <ProfileDialog title={props.t.recommendToFriend} onClose={() => setDialog(null)}>
          <label>
            {props.t.chooseRecipient}
            <select value={recommendRecipient} onChange={(event) => setRecommendRecipient(event.target.value)}>
              <option value="">{props.t.chooseRecipient}</option>
              {recommendContacts.map((contact) => (
                <option key={contact.account_id} value={contact.account_id}>
                  {contact.remark_name || contact.display_name}
                </option>
              ))}
            </select>
          </label>
          <button
            className="primary-button full"
            type="button"
            disabled={props.busy || !recommendRecipient}
            onClick={() => void props.onRecommend(recommendRecipient).then(() => setDialog(null))}
          >
            {props.t.sendContactCard}
          </button>
        </ProfileDialog>
      )}
    </section>
  );
}

function ProfileDialog({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose(): void;
}) {
  return (
    <div className="profile-dialog-backdrop" onMouseDown={onClose}>
      <section className="profile-dialog" onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <h2>{title}</h2>
          <button type="button" onClick={onClose}>×</button>
        </header>
        <div>{children}</div>
      </section>
    </div>
  );
}
