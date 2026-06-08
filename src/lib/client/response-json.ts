type JsonPayload = Record<string, unknown>;

function summarizeNonJsonBody(body: string): string {
  return body
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180);
}

export async function readJsonResponse<T extends JsonPayload = JsonPayload>(
  response: Response
): Promise<T & { error?: string }> {
  const contentType = response.headers.get('content-type') || '';

  if (contentType.toLowerCase().includes('application/json')) {
    return response.json() as Promise<T & { error?: string }>;
  }

  const text = await response.text().catch(() => '');
  const summary = summarizeNonJsonBody(text);
  const status = [response.status, response.statusText].filter(Boolean).join(' ');

  const error = response.ok
    ? summary
      ? `Expected JSON response but received: ${summary}`
      : 'Expected JSON response but received a non-JSON response'
    : summary
      ? `Server returned ${status}: ${summary}`
      : `Server returned ${status || 'a non-JSON error response'}`;

  return { error } as T & { error: string };
}
