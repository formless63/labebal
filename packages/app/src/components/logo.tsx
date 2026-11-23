/** The labebal mark: a label feeding out of a thermal printer (same artwork as the favicon). */
export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden>
      <rect width="64" height="64" rx="14" fill="#18181b" />
      <rect x="9" y="11" width="46" height="9" rx="4.5" fill="#3f3f46" />
      <rect x="13" y="14.5" width="38" height="2" rx="1" fill="#09090b" />
      <path d="M16 15.5h32V47l-4 4-4-4-4 4-4-4-4 4-4-4-4 4-4-4z" fill="#fafafa" />
      <g fill="#18181b">
        <rect x="20" y="24" width="3" height="15" />
        <rect x="25" y="24" width="1.5" height="15" />
        <rect x="28.5" y="24" width="4" height="15" />
        <rect x="34.5" y="24" width="1.5" height="15" />
        <rect x="38" y="24" width="2" height="15" />
        <rect x="42" y="24" width="2" height="15" />
      </g>
      <rect x="16" y="20" width="32" height="1.6" fill="#f59e0b" />
    </svg>
  );
}
