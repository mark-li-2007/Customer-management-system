const API_BASE = '/api';

function getHeaders(): Record<string, string> {
  const user = localStorage.getItem('demoUserId') || 'u_admin';
  return {
    'Content-Type': 'application/json',
    'X-Demo-User-Id': user,
  };
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: { ...getHeaders(), ...(options.headers ?? {}) },
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body?.ok) {
    throw new Error(body?.message || `请求失败 (${response.status})`);
  }
  return body.data as T;
}

export const api = {
  get<T>(path: string): Promise<T> {
    return request<T>(path);
  },
  post<T>(path: string, data?: unknown): Promise<T> {
    return request<T>(path, { method: 'POST', body: JSON.stringify(data ?? {}) });
  },
  patch<T>(path: string, data?: unknown): Promise<T> {
    return request<T>(path, { method: 'PATCH', body: JSON.stringify(data ?? {}) });
  },
  put<T>(path: string, data?: unknown): Promise<T> {
    return request<T>(path, { method: 'PUT', body: JSON.stringify(data ?? {}) });
  },
  delete<T>(path: string): Promise<T> {
    return request<T>(path, { method: 'DELETE' });
  },
};
