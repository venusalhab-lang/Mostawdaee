import { Capacitor } from '@capacitor/core';

export function getApiBase(): string {
  const fromEnv = String((import.meta as any).env?.VITE_API_BASE_URL || '').replace(/\/$/, '');
  if (fromEnv) return fromEnv;
  if (Capacitor.isNativePlatform()) {
    return '';
  }
  return '';
}

export function apiUrl(path: string): string {
  const base = getApiBase();
  const normalized = path.startsWith('/') ? path : `/${path}`;
  return `${base}${normalized}`;
}
