/**
 * Helper client to interact with Google Drive API v3
 */

import { DRIVE_BACKUP_QUERY } from '../lib/backupNames';

const TOKEN_KEY = 'mustawdae_drive_access_token';
const EXPIRES_KEY = 'mustawdae_drive_access_expires';

let cachedAccessToken: string | null = null;
let cachedExpiresAt = 0;
// sessionStorage only (tab lifetime): avoid durable localStorage for OAuth access tokens.
try {
  cachedAccessToken = sessionStorage.getItem(TOKEN_KEY) || null;
  cachedExpiresAt = Number(sessionStorage.getItem(EXPIRES_KEY)) || 0;
  try {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(EXPIRES_KEY);
  } catch { /* ignore migration cleanup */ }
} catch { /* storage unavailable */ }

/** `expiresAt` is epoch ms; 0 means unknown, in which case Drive's 401 is what disconnects. */
export const setDriveAccessToken = (token: string, expiresAt = 0) => {
  cachedAccessToken = token || null;
  cachedExpiresAt = token ? expiresAt : 0;
  try {
    if (token) {
      sessionStorage.setItem(TOKEN_KEY, token);
      if (expiresAt) sessionStorage.setItem(EXPIRES_KEY, String(expiresAt));
      else sessionStorage.removeItem(EXPIRES_KEY);
    } else {
      sessionStorage.removeItem(TOKEN_KEY);
      sessionStorage.removeItem(EXPIRES_KEY);
    }
    try {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(EXPIRES_KEY);
    } catch { /* ignore */ }
  } catch (e) {
    console.error('[GoogleDrive] Persistence set error:', e);
  }
};

export const getDriveAccessToken = (): string | null => {
  if (cachedAccessToken && cachedExpiresAt && Date.now() >= cachedExpiresAt) setDriveAccessToken('');
  return cachedAccessToken;
};

export const hasDriveAccessToken = (): boolean => {
  return !!getDriveAccessToken();
};

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  createdTime: string;
  size?: string;
}

export const listBackupFiles = async (): Promise<DriveFile[]> => {
  const token = getDriveAccessToken();
  if (!token) {
    throw new Error('No Google Drive Access Token available. Please log in.');
  }

  const q = encodeURIComponent(DRIVE_BACKUP_QUERY);
  const url = `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,mimeType,createdTime,size)&orderBy=createdTime desc&pageSize=100`;

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`
    }
  });

  if (!response.ok) {
    const errText = await response.text();
    console.error('Google Drive List Error:', errText);
    if (response.status === 401 || response.status === 403) {
      setDriveAccessToken('');
    }
    throw new Error(`Failed to list backup files: [${response.status}] ${response.statusText}`);
  }

  const data = await response.json();
  return data.files || [];
};

export const uploadBackupFile = async (filename: string, content: string): Promise<DriveFile> => {
  const token = getDriveAccessToken();
  if (!token) {
    throw new Error('No Google Drive Access Token available. Please log in.');
  }

  const metadata = {
    name: filename,
    mimeType: 'application/json',
  };

  const boundary = '314159265358979323846';
  const delimiter = `\r\n--${boundary}\r\n`;
  const closeDelim = `\r\n--${boundary}--`;

  const body = 
    delimiter +
    'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
    JSON.stringify(metadata) +
    delimiter +
    'Content-Type: application/json\r\n\r\n' +
    content +
    closeDelim;

  const url = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart';
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': `multipart/related; boundary=${boundary}`
    },
    body: body
  });

  if (!response.ok) {
    const errText = await response.text();
    console.error('Google Drive Upload Error:', errText);
    if (response.status === 401 || response.status === 403) {
      setDriveAccessToken('');
    }
    throw new Error(`Upload to Google Drive failed: [${response.status}] ${response.statusText}`);
  }

  return response.json();
};

export const downloadBackupFile = async (fileId: string): Promise<any> => {
  const token = getDriveAccessToken();
  if (!token) {
    throw new Error('No Google Drive Access Token available. Please log in.');
  }

  const url = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`
    }
  });

  if (!response.ok) {
    const errText = await response.text();
    console.error('Google Drive Download Error:', errText);
    if (response.status === 401 || response.status === 403) {
      setDriveAccessToken('');
    }
    throw new Error(`Download from Google Drive failed: [${response.status}] ${response.statusText}`);
  }

  return response.json();
};

export const deleteBackupFile = async (fileId: string): Promise<boolean> => {
  const token = getDriveAccessToken();
  if (!token) {
    throw new Error('No Google Drive Access Token available. Please log in.');
  }

  const url = `https://www.googleapis.com/drive/v3/files/${fileId}`;
  const response = await fetch(url, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${token}`
    }
  });

  if (!response.ok) {
    const errText = await response.text();
    console.error('Google Drive Delete Error:', errText);
    if (response.status === 401 || response.status === 403) {
      setDriveAccessToken('');
    }
    throw new Error(`Failed to delete backup file: [${response.status}] ${response.statusText}`);
  }

  return true;
};
