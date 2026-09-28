/**
 * Reading a JSON API response without the cryptic failure mode.
 *
 * When a route crashes at module level — a stale Prisma client is the usual
 * cause — Next serves an HTML error page. Calling `res.json()` on that throws
 * `Unexpected token '<', "<!DOCTYPE "... is not valid JSON`, which tells the
 * person at the screen nothing at all. These helpers turn it into a sentence.
 */
export type ApiEnvelope<T = ApiData> = {
  success: boolean;
  data?: T;
  error?: string;
  details?: ApiData;
};

/**
 * Response payloads are shaped by each route and read straight off the
 * envelope, exactly as `res.json()` used to hand them over. Callers narrow
 * them at the point of use.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ApiData = any;

function describeNonJson(res: Response, body: string) {
  const looksLikeHtml = /^\s*<(!doctype|html)/i.test(body);
  if (looksLikeHtml) {
    return res.status >= 500
      ? `The server hit an error on ${res.url.replace(/^https?:\/\/[^/]+/, '')} (HTTP ${res.status}). ` +
          'Check the terminal running the app — if it mentions Prisma, stop it, run `npx prisma generate`, and start it again.'
      : `That request returned a web page instead of data (HTTP ${res.status}). You may need to sign in again.`;
  }
  const snippet = body.trim().slice(0, 160);
  return snippet
    ? `Unexpected response from the server (HTTP ${res.status}): ${snippet}`
    : `Empty response from the server (HTTP ${res.status}).`;
}

/** Parses the envelope, or returns a readable error when the body is not JSON. */
export async function readJson<T = ApiData>(res: Response): Promise<ApiEnvelope<T>> {
  const body = await res.text();
  try {
    return JSON.parse(body) as ApiEnvelope<T>;
  } catch {
    return { success: false, error: describeNonJson(res, body) };
  }
}

/**
 * Fetch and unwrap in one step. Throws an Error carrying the server's message
 * (or a readable substitute) so callers can keep using try/catch.
 */
export async function fetchJson<T = ApiData>(input: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(input, init);
  } catch {
    throw new Error(`Could not reach the server at ${input}. Is it still running?`);
  }
  const json = await readJson<T>(res);
  if (!res.ok || json.success === false) {
    throw new Error(json.error ?? `Request failed with HTTP ${res.status}`);
  }
  return json.data as T;
}
