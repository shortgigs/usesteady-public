interface Props {
  className?: string;
  withBackground?: boolean;
}

/**
 * Inline SVG recreation of the UseSteady brand mark.
 *
 * Blue  (left)  = the input/review side
 * Green (right) = the approved/executed side
 *
 * Source: brand asset in the web repository (public/icon.png)
 * Colors: #4A7CF7 · #22C55E
 */
export function BrandMark({ className = "w-7 h-7", withBackground = true }: Props) {
  return (
    <svg
      className={className}
      viewBox="0 0 48 48"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      focusable="false"
    >
      {withBackground && (
        <rect width="48" height="48" rx="10" fill="#0A0A0A" />
      )}

      {/* Blue slider — review / input */}
      <circle cx="10" cy="24" r="3.5" fill="#4A7CF7" />
      <line
        x1="10" y1="24" x2="21" y2="24"
        stroke="#4A7CF7" strokeWidth="3.5" strokeLinecap="round"
      />
      <line
        x1="21" y1="13" x2="21" y2="35"
        stroke="#4A7CF7" strokeWidth="3.5" strokeLinecap="round"
      />

      {/* Green slider — approved / executed */}
      <line
        x1="27" y1="13" x2="27" y2="35"
        stroke="#22C55E" strokeWidth="3.5" strokeLinecap="round"
      />
      <line
        x1="27" y1="24" x2="38" y2="24"
        stroke="#22C55E" strokeWidth="3.5" strokeLinecap="round"
      />
      <circle cx="38" cy="24" r="3.5" fill="#22C55E" />
    </svg>
  );
}
