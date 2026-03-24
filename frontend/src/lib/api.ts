import CONFIG from './config';

/**
 * Standard API fetching wrapper for the Multi-tenant SaaS platform.
 * It automatically adds authentication headers and handles error conditions.
 */

interface FetchOptions extends RequestInit {
  apiType?: 'AUTH' | 'CHAT';
}

export type ApiResponse<T = unknown> = 
  | { success: true; data: T; status: number; error?: never }
  | { success: false; error: string; status: number; data?: never };

export async function apiFetch<T = unknown>(
  endpoint: string, 
  options: FetchOptions = {}
): Promise<ApiResponse<T>> {
  const { apiType = 'AUTH', ...fetchOptions } = options;
  
  // Decide the base URL
  const baseUrl = apiType === 'AUTH' ? CONFIG.AUTH_API_URL : CONFIG.CHAT_API_URL;
  
  // Clean up endpoint prefixing
  const relativePath = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  const url = `${baseUrl}${relativePath}`;
  
  // Extract authentication token
  const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
  
  // Prepare headers
  const headers = new Headers(fetchOptions.headers || {});
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  if (!headers.has('Content-Type') && (fetchOptions.method === 'POST' || fetchOptions.method === 'PUT' || fetchOptions.method === 'PATCH')) {
    headers.set('Content-Type', 'application/json');
  }

  const mergedOptions: RequestInit = {
    ...fetchOptions,
    headers,
  };

  try {
    const response = await fetch(url, mergedOptions);
    
    // Attempt to parse JSON
    let data = null;
    const contentType = response.headers.get('content-type');
    if (contentType && contentType.includes('application/json')) {
      data = await response.json();
    } else {
      data = { message: await response.text() };
    }

    if (!response.ok) {
      const errorMessage = data?.message || data?.error || `HTTP error! status: ${response.status}`;
      throw new Error(errorMessage);
    }

    return { success: true, data, status: response.status };
  } catch (error: unknown) {
    const e = error as Error;
    console.error(`API Fetch Error [${url}]:`, e);
    return { success: false, error: e.message || 'Network error occurred', status: 500 };
  }
}

/**
 * Convenience helper for specialized WebSocket URLs.
 */
export function getWebSocketUrl(path: string = '/ws/task-status') {
  const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
  const baseUrl = CONFIG.WS_URL;
  const relativePath = path.startsWith('/') ? path : `/${path}`;
  
  return `${baseUrl}${relativePath}${token ? `?token=${token}` : ''}`;
}
