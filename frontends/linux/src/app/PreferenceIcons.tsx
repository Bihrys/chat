import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

function IconBase(props: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    />
  );
}

export function ChatIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M20 11.4a7.2 7.2 0 0 1-7.5 7.1 8.8 8.8 0 0 1-3.5-.7L4.5 20l1.4-4a6.8 6.8 0 0 1-1.4-4.1A7.2 7.2 0 0 1 12 4.8a7.2 7.2 0 0 1 8 6.6Z" />
      <path d="M8.5 11.7h.01M12 11.7h.01M15.5 11.7h.01" />
    </IconBase>
  );
}

export function ContactsIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <circle cx="9" cy="8" r="3" />
      <path d="M3.7 18.5c.5-3 2.4-4.8 5.3-4.8s4.8 1.8 5.3 4.8" />
      <path d="M16.5 6.6a2.5 2.5 0 0 1 0 4.8M16.2 14.2c2.4.2 3.9 1.7 4.2 4.3" />
    </IconBase>
  );
}

export function MenuIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M5 7h14M5 12h14M5 17h14" />
    </IconBase>
  );
}

export function SearchIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <circle cx="10.8" cy="10.8" r="6" />
      <path d="m15.3 15.3 4.2 4.2" />
    </IconBase>
  );
}

export function PlusIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M12 5v14M5 12h14" />
    </IconBase>
  );
}

export function ChevronIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="m9 6 6 6-6 6" />
    </IconBase>
  );
}

export function FriendRequestIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <circle cx="9" cy="8" r="3" />
      <path d="M3.7 18.5c.5-3 2.4-4.8 5.3-4.8s4.8 1.8 5.3 4.8" />
      <path d="M18 8v6M15 11h6" />
    </IconBase>
  );
}

export function GroupIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <circle cx="8" cy="9" r="2.7" />
      <circle cx="16.2" cy="9.6" r="2.2" />
      <path d="M3.8 18.2c.4-2.8 2-4.3 4.5-4.3s4.2 1.5 4.5 4.3" />
      <path d="M13 14.3c2.7-.7 5.6.7 6.3 3.9" />
    </IconBase>
  );
}

export function SettingsIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6 1.7 1.7 0 0 0 10 3v-.2h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z" />
    </IconBase>
  );
}

export function MoonIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M20 14.5A8.5 8.5 0 1 1 11.5 4 6.8 6.8 0 0 0 20 14.5Z" />
    </IconBase>
  );
}

export function SunIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2.2M12 19.8V22M2 12h2.2M19.8 12H22M4.9 4.9l1.6 1.6M17.5 17.5l1.6 1.6M17.5 6.5l1.6-1.6M4.9 19.1l1.6-1.6" />
    </IconBase>
  );
}
