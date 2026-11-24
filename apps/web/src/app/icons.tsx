// Inline SVG icons for the app shell and the login page. Drawn with `currentColor`, so
// they take the color of the text next to them and follow the light and dark tokens.
// All decoration: each one sits next to a word that says the same thing, so screen
// readers skip them (aria-hidden). No icon package: a handful of shapes do not need one.

type IconProps = { size?: number };

function Svg({ size = 18, children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

// Shows: a ticket with a perforated edge.
export function ShowsIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h11A1.5 1.5 0 0 1 17 6.5V8a2 2 0 0 0 0 4v1.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 3 13.5V12a2 2 0 0 0 0-4Z" />
      <path d="M12.5 5.5v1.5M12.5 9.25v1.5M12.5 13v1.5" />
    </Svg>
  );
}

// API keys: a key.
export function KeyIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="7" cy="10" r="3.25" />
      <path d="M10.25 10H17M14.5 10v2.5M16.5 10v2" />
    </Svg>
  );
}

// The phone menu button: three lines.
export function MenuIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3.5 6h13M3.5 10h13M3.5 14h13" />
    </Svg>
  );
}

// Log out: an arrow leaving a door.
export function LogOutIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M8 4H5a1.5 1.5 0 0 0-1.5 1.5v9A1.5 1.5 0 0 0 5 16h3" />
      <path d="M12.5 13.5 16 10l-3.5-3.5M16 10H8" />
    </Svg>
  );
}

// A tick, for the login page's list of what the app does.
export function CheckIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="m5 10.5 3 3 7-7" />
    </Svg>
  );
}

// A magnifying glass, inside the search box on the shows page.
export function SearchIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="9" cy="9" r="5" />
      <path d="m16 16-3.5-3.5" />
    </Svg>
  );
}

// A plus, on the "New show" action.
export function PlusIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M10 4.5v11M4.5 10h11" />
    </Svg>
  );
}

// Guide: an open book, for "How Ledgerline works".
export function GuideIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M10 5.5C8.5 4.5 6.5 4 3.5 4v11c3 0 5 .5 6.5 1.5 1.5-1 3.5-1.5 6.5-1.5V4c-3 0-5 .5-6.5 1.5Z" />
      <path d="M10 5.5v11" />
    </Svg>
  );
}

// Artists: a microphone on a stand.
export function ArtistsIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="7.5" y="3" width="5" height="8.5" rx="2.5" />
      <path d="M5 9.5a5 5 0 0 0 10 0M10 14.5V17M7 17h6" />
    </Svg>
  );
}

// Venues: a hall with a pitched roof and a wide door.
export function VenuesIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3 8.5 10 4l7 4.5" />
      <path d="M4.5 8v8.5h11V8" />
      <path d="M8 16.5v-4.5h4v4.5" />
    </Svg>
  );
}

// Copy: two overlapping sheets.
export function CopyIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="7" y="7" width="9.5" height="9.5" rx="1.75" />
      <path d="M13 7V5.25A1.75 1.75 0 0 0 11.25 3.5h-6A1.75 1.75 0 0 0 3.5 5.25v6A1.75 1.75 0 0 0 5.25 13H7" />
    </Svg>
  );
}

// A cross, for "A key cannot" on the API keys page (next to the words, never instead).
export function CrossIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="m6 6 8 8M14 6l-8 8" />
    </Svg>
  );
}

// A warning triangle, for the one-time key callout.
export function WarningIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M10 3.5 2.75 16h14.5Z" />
      <path d="M10 8.5v3.5M10 14.25v.01" />
    </Svg>
  );
}

// Assistant: a four-point sparkle with a small one beside it.
export function SparkleIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M9 4c.55 3.2 2.3 4.95 5.5 5.5-3.2.55-4.95 2.3-5.5 5.5-.55-3.2-2.3-4.95-5.5-5.5C6.7 8.95 8.45 7.2 9 4Z" />
      <path d="M15.5 2.75v3M14 4.25h3" />
    </Svg>
  );
}
