import type { FileRef } from '@io/shared';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Fetch wrapper: JSON in/out, CSRF header, 401 → app-wide sign-out event. */
export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(path, {
    method: init.method ?? 'GET',
    credentials: 'same-origin',
    headers: {
      'X-Requested-With': 'image-organizer',
      ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : null;
  if (!res.ok) {
    if (res.status === 401 && path !== '/api/auth/login') window.dispatchEvent(new Event('io:unauthorized'));
    throw new ApiError(res.status, data?.error ?? res.statusText);
  }
  return data as T;
}

export const qs = (params: Record<string, string | number | undefined>) =>
  new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined) as [string, string][]).toString();

export const thumbUrl = (f: FileRef & { mtimeMs?: number }, size: number) =>
  `/api/thumb?${qs({ root: f.root, rel: f.rel, size, v: f.mtimeMs ? Math.round(f.mtimeMs) : undefined })}`;

export const fileUrl = (f: FileRef & { mtimeMs?: number }) => `/api/file?${qs({ root: f.root, rel: f.rel, v: f.mtimeMs ? Math.round(f.mtimeMs) : undefined })}`;

/** Upload one file to /import with progress (XHR, since fetch has no upload progress). */
export function uploadFile(file: File, rel: string, onProgress: (fraction: number) => void): Promise<FileRef> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/import/upload?${qs({ rel, lastModified: file.lastModified })}`);
    xhr.setRequestHeader('X-Requested-With', 'image-organizer');
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => {
      let body: { error?: string } & FileRef;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        body = { error: xhr.statusText } as never;
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(body);
      else reject(new ApiError(xhr.status, body.error ?? xhr.statusText));
    };
    xhr.onerror = () => reject(new ApiError(0, 'Network error'));
    const form = new FormData();
    form.append('file', file, file.name);
    xhr.send(form);
  });
}
