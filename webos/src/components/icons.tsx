// Transport glyphs, drawn rather than borrowed from a font, so they stay crisp at TV size.
const props = { viewBox: '0 0 24 24', fill: 'currentColor', 'aria-hidden': true } as const;

export const RestartIcon = () => (
  <svg {...props}>
    <path d="M5 5h2.5v14H5zM19 5.6v12.8a.8.8 0 0 1-1.2.7L8.6 12.7a.8.8 0 0 1 0-1.4l9.2-6.4a.8.8 0 0 1 1.2.7z" />
  </svg>
);

export const NextIcon = () => (
  <svg {...props}>
    <path d="M16.5 5H19v14h-2.5zM5 5.6v12.8a.8.8 0 0 0 1.2.7l9.2-6.4a.8.8 0 0 0 0-1.4L6.2 4.9A.8.8 0 0 0 5 5.6z" />
  </svg>
);

export const PauseIcon = () => (
  <svg {...props}>
    <rect x="6" y="5" width="4" height="14" rx="1.2" />
    <rect x="14" y="5" width="4" height="14" rx="1.2" />
  </svg>
);

export const PlayIcon = () => (
  <svg {...props}>
    <path d="M8 5.5v13a.9.9 0 0 0 1.4.8l10-6.5a.9.9 0 0 0 0-1.6l-10-6.5A.9.9 0 0 0 8 5.5z" />
  </svg>
);
