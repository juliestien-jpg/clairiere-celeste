// Icônes rondes et simples (tracés au trait). Décoratives : le libellé texte est toujours à côté.
export type IconName = "fruit" | "bowl" | "sparkle" | "drop" | "leaf" | "moon" | "sun" | "heart";

const PATHS: Record<IconName, string> = {
  bowl: "M4 11h16a8 8 0 0 1-16 0zM9 7c0-1.2 1-1.2 1-2.4M14 7c0-1.2 1-1.2 1-2.4",
  fruit: "M12 9a6 6 0 1 0 0 12 6 6 0 0 0 0-12zM12 9c0-2.5 1-4.5 3.5-5",
  sparkle: "M12 3c.8 5 2 7 9 9-7 2-8.2 4-9 9-.8-5-2-7-9-9 7-2 8.2-4 9-9z",
  drop: "M12 3c4 5 6 8 6 11a6 6 0 0 1-12 0c0-3 2-6 6-11z",
  leaf: "M5 19c0-8 5-14 14-14 0 9-6 14-14 14zM5 19l8-8",
  moon: "M20 14a8 8 0 1 1-10-10 6.5 6.5 0 0 0 10 10z",
  sun: "M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z",
  heart: "M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 5.5-7 10-7 10z",
};

export function Icon({ name }: { name: IconName }) {
  return (
    <svg
      className="icon"
      viewBox="0 0 24 24"
      width="24"
      height="24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
