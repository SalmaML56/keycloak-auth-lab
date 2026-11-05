// Thin wrapper around the backend so the UI can show the HTTP status and the
// raw response body of every call.

import { config } from "./config";

export type ApiResult = {
  status: number;
  body: string;
};

export async function callApi(path: string, accessToken?: string): Promise<ApiResult> {
  const headers: Record<string, string> = {};
  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }

  try {
    const response = await fetch(`${config.apiBaseUrl}${path}`, { headers });
    return { status: response.status, body: await response.text() };
  } catch (error) {
    return {
      status: 0,
      body: `Network error calling ${path}: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

export function statusClass(status: number): string {
  if (status === 200) return "status-200";
  if (status === 401) return "status-401";
  if (status === 403) return "status-403";
  return "status-other";
}
