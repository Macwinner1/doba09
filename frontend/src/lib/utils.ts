import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/** Session storage keyed by PIN, so two games in two tabs don't overwrite each other. */
export const storage = {
  savePlayer(pin: string, data: { playerId: string; rejoinToken: string; nickname: string }) {
    if (typeof window === 'undefined') return;
    sessionStorage.setItem(`feyi:player:${pin}`, JSON.stringify(data));
  },
  loadPlayer(pin: string) {
    if (typeof window === 'undefined') return null;
    const raw = sessionStorage.getItem(`feyi:player:${pin}`);
    return raw ? (JSON.parse(raw) as { playerId: string; rejoinToken: string; nickname: string }) : null;
  },
  clearPlayer(pin: string) {
    if (typeof window === 'undefined') return;
    sessionStorage.removeItem(`feyi:player:${pin}`);
  },
  saveHost(pin: string, hostToken: string) {
    if (typeof window === 'undefined') return;
    sessionStorage.setItem(`feyi:host:${pin}`, hostToken);
  },
  loadHost(pin: string) {
    if (typeof window === 'undefined') return null;
    return sessionStorage.getItem(`feyi:host:${pin}`);
  },
};
