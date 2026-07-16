import { GroupIcon } from "./PreferenceIcons";

export function UserAvatar({
  label,
  avatarUrl,
  group = false,
  small = false,
  large = false,
  className = "",
}: {
  label: string;
  avatarUrl?: string | null;
  group?: boolean;
  small?: boolean;
  large?: boolean;
  className?: string;
}) {
  return (
    <span
      className={`ui-avatar ${group ? "group" : ""} ${small ? "small" : ""} ${large ? "large" : ""} ${className}`.trim()}
      aria-label={label}
    >
      {!group && avatarUrl ? (
        <img src={avatarUrl} alt="" draggable={false} />
      ) : group ? (
        <GroupIcon />
      ) : (
        initials(label)
      )}
    </span>
  );
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
