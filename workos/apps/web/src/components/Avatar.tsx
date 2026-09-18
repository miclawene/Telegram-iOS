"use client";

const COLORS = [
  "#2563EB", "#7C3AED", "#DB2777", "#DC2626",
  "#EA580C", "#16A34A", "#0891B2", "#4F46E5",
];

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h << 5) - h + s.charCodeAt(i);
  return Math.abs(h);
}

export function Avatar({
  name,
  size = 32,
}: {
  name: string | null | undefined;
  size?: number;
}) {
  const label = (name ?? "?").trim();
  const initials = label
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
  const color = COLORS[hashString(label) % COLORS.length];
  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-full font-medium text-white"
      style={{ width: size, height: size, background: color, fontSize: size * 0.4 }}
      aria-hidden
    >
      {initials || "?"}
    </div>
  );
}
