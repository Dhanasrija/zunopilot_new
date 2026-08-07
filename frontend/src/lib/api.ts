import axios, { AxiosError } from 'axios';
import { toast } from 'sonner';
import { useAuthStore } from '@/stores/auth.store';

/*
 * **No default `Content-Type`, and that is load-bearing.**
 *
 * It used to be `application/json`, which silently broke every file upload. Axios's
 * `transformRequest` reads the header first: seeing `application/json` on a `FormData` body it
 * runs `JSON.stringify(formDataToJSON(data))` instead of sending multipart, so the request
 * left the browser as `{"file":{}}` and the server answered "No file was uploaded" — a
 * message that points at the caller when the fault was here.
 *
 * Nothing is lost by omitting it: axios sets `application/json` itself for any object payload,
 * and lets the browser set `multipart/form-data` with its boundary for a `FormData` one. A
 * boundary is generated per request, so it is not something a default header could ever
 * declare correctly anyway.
 */
export const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || '/api',
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (r) => r,
  (error: AxiosError<{ message?: string }>) => {
    const status = error.response?.status;
    const msg = error.response?.data?.message || error.message || 'Request failed';
    if (status === 401) {
      useAuthStore.getState().clear();
      if (!window.location.pathname.startsWith('/login')) {
        window.location.href = '/login';
      }
    } else if (status && status >= 400) {
      toast.error(msg);
    }
    return Promise.reject(error);
  }
);
