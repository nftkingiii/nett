// Small stroke icons, 20px grid, rounded joins. No diagonal arrows.
const base = { width: 18, height: 18, viewBox: '0 0 20 20', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true };

export const TagIcon = (p) => (
  <svg {...base} {...p}><path d="M3 10.6V4a1 1 0 0 1 1-1h6.6a1 1 0 0 1 .7.3l5.4 5.4a1 1 0 0 1 0 1.4l-6.6 6.6a1 1 0 0 1-1.4 0L3.3 11.3a1 1 0 0 1-.3-.7Z" /><circle cx="7" cy="7" r="1.3" /></svg>
);
export const CompassIcon = (p) => (
  <svg {...base} {...p}><circle cx="10" cy="10" r="7" /><path d="m12.8 7.2-1.6 4-4 1.6 1.6-4 4-1.6Z" /></svg>
);
export const WalletIcon = (p) => (
  <svg {...base} {...p}><rect x="3" y="5" width="14" height="11" rx="2" /><path d="M3 8h14M13 12h1.5" /></svg>
);
export const BookIcon = (p) => (
  <svg {...base} {...p}><path d="M4 4.5A1.5 1.5 0 0 1 5.5 3H16v12H5.5A1.5 1.5 0 0 0 4 16.5v-12Z" /><path d="M4 16.5A1.5 1.5 0 0 0 5.5 18H16" /></svg>
);
export const SearchIcon = (p) => (
  <svg {...base} {...p}><circle cx="9" cy="9" r="5.5" /><path d="m13.2 13.2 3.3 3.3" /></svg>
);
export const ArrowRight = (p) => (
  <svg {...base} {...p}><path d="M4 10h11M11 6l4 4-4 4" /></svg>
);
export const CheckIcon = (p) => (
  <svg {...base} {...p}><path d="m4.5 10.5 3.5 3.5 7.5-8" /></svg>
);
export const StopIcon = (p) => (
  <svg {...base} {...p}><circle cx="10" cy="10" r="7" /><path d="M5.2 14.8 14.8 5.2" /></svg>
);
export const AlertIcon = (p) => (
  <svg {...base} {...p}><path d="M10 3.5 17.5 16.5h-15L10 3.5Z" /><path d="M10 8.5v3.5M10 14.2v.1" /></svg>
);
