import type { CSSProperties } from 'react';

export function Icon({ name, size = 20, style }: { name: string; size?: number; style?: CSSProperties }) {
  const paths: Record<string, React.ReactNode> = {
    compass: <><path d="m16 8-3 5-5 3 3-5 5-3Z" /><circle cx="12" cy="12" r="9" /></>,
    box: <><path d="m12 3 9 5-9 5-9-5 9-5Zm-9 5v9l9 5 9-5V8M12 13v9M7 5.8l9 5" /></>,
    pin: <><path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z"/><circle cx="12" cy="10" r="2.5"/></>,
    arrow: <path d="M5 12h14m-6-6 6 6-6 6" />,
    pause: <><path d="M8 5v14M16 5v14" strokeWidth="3"/></>,
    play: <path d="m8 5 11 7-11 7V5Z"/>,
    sound: <><path d="M11 4 5 9H2v6h3l6 5V4ZM15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/></>,
    mute: <><path d="M11 4 5 9H2v6h3l6 5V4ZM16 9l6 6m0-6-6 6"/></>,
    help: <><circle cx="12" cy="12" r="9"/><path d="M9 9a3 3 0 0 1 6 0c0 2-3 2-3 4m0 3v.1"/></>,
    close: <path d="m6 6 12 12M6 18 18 6"/>,
    sun: <><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/></>,
    person: <><circle cx="12" cy="4" r="2"/><path d="m7 13 2-5h5l3 5m-7-2v5l-3 6m7-11v5l3 6M9 8l-3 3"/></>,
    car: <><path d="m4 9 2-5h12l2 5M3 10h18v8H3zM5 18v3m14-3v3M6 13h2m8 0h2"/></>,
    shield: <path d="m12 2 9 4v6c0 5-9 10-9 10S3 17 3 12V6l9-4Z"/>,
    check: <path d="m5 12 4 4L19 6"/>,
    restart: <><path d="M3 10a9 9 0 1 1 1 8M3 3v7h7"/></>,
    expand: <path d="M8 3H3v5m13-5h5v5M3 16v5h5m8 0h5v-5"/>,
    flag: <><path d="M5 22V3m0 1c5-5 9 5 15 0v10c-6 5-10-5-15 0"/></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={style}>{paths[name] ?? paths.compass}</svg>;
}
