import type { CSSProperties } from "react";

export function Icon({
  name,
  size = 18,
  style,
}: {
  name: string;
  size?: number;
  style?: CSSProperties;
}) {
  const paths: Record<string, string> = {
    grid: "M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z",
    people:
      "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M16 3a4 4 0 0 1 0 8M22 21v-2a4 4 0 0 0-3-3.87M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0",
    judge: "M20 21H4M7 16V7l5-4 5 4v9M9 11h6M9 15h6",
    room: "M3 21h18M5 21V3h14v18M9 7h1M14 7h1M9 11h1M14 11h1M10 21v-6h4v6",
    settings:
      "M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0",
    arrow: "M5 12h14M13 6l6 6-6 6",
    download: "M12 3v12M7 10l5 5 5-5M4 16v5h16v-5",
    upload: "M12 16V4M7 9l5-5 5 5M4 16v5h16v-5",
    print: "M6 8V3h12v5M6 17H3V8h18v9h-3M6 14h12v7H6zM17 11h1",
    check: "M5 12l4 4L19 6",
    lock: "M6 10h12v11H6zM8 10V6a4 4 0 0 1 8 0v4",
    unlock: "M6 10h12v11H6zM8 10V6a4 4 0 0 1 7.5-2",
    close: "M6 6l12 12M6 18 18 6",
    plus: "M12 5v14M5 12h14",
    reset: "M3 10a9 9 0 1 1 2 8M3 3v7h7",
    alert: "m12 3 10 18H2L12 3zM12 9v5M12 17h.01",
    clock: "M12 8v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0",
    spark: "m12 3 2.7 6.3L21 12l-6.3 2.7L12 21l-2.7-6.3L3 12l6.3-2.7L12 3z",
    chevron: "m9 5 7 7-7 7",
    trash: "M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7",
    globe:
      "M3 12h18M12 3a17 17 0 0 1 0 18 17 17 0 0 1 0-18M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0",
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.65"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={style}
    >
      <path d={paths[name] || paths.grid} />
    </svg>
  );
}
