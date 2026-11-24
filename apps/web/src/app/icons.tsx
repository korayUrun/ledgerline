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
