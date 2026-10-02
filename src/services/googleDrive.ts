/**
 * Helper client to interact with Google Drive API v3
 */

let cachedAccessToken: string | null = (() => {
  try {
    return localStorage.getItem('mustawdae_drive_access_token') || null;
  } catch (e) {
    return null;
  }
})();

export const setDriveAccessToken = (token: string) => {
  cachedAccessToken = token;
  try {
    if (token) {
      localStorage.setItem('mustawdae_drive_access_token', token);
    } else {
      localStorage.removeItem('mustawdae_drive_access_token');
    }
  } catch (e) {
    console.error('[GoogleDrive] Persistence set error:', e);
  }
};

export const getDriveAccessToken = (): string | null => {
  return cachedAccessToken;
};

export const hasDriveAccessToken = (): boolean => {
  return !!cachedAccessToken;
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

  const q = encodeURIComponent("name contains 'mustawdae_' and trashed = false");
  const url = `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,mimeType,createdTime,size)&orderBy=createdTime desc`;

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`
    }
  });

  if (!response.ok) {
    const errText = await response.text();
    console.error('Google Drive List Error:', errText);
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
    throw new Error(`Failed to delete backup file: [${response.status}] ${response.statusText}`);
  }

  return true;
};
