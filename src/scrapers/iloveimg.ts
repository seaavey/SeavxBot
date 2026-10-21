// iloveimg.com tools share one upload + tool-call flow. TOKEN is the site's
// public client token, not a secret.
const TOKEN =
  "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJpc3MiOiIiLCJhdWQiOiIiLCJpYXQiOjE1MjMzNjQ4MjQsIm5iZiI6MTUyMzM2NDgyNCwianRpIjoicHJvamVjdF9wdWJsaWNfYzkwNWRkMWMwMWU5ZmQ3NzY5ODNjYTQwZDBhOWQyZjNfT1Vzd2EwODA0MGI4ZDJjN2NhM2NjZGE2MGQ2MTBhMmRkY2U3NyJ9.qvHSXgCJgqpC4gd6-paUlDLFmg0o2DsOvb1EUYPYx_E";

function post(host: string, path: string, form: FormData): Promise<Response> {
  return fetch(`https://${host}.iloveimg.com/v1/${path}`, {
    method: "POST",
    body: form,
    headers: { authorization: `Bearer ${TOKEN}` },
    signal: AbortSignal.timeout(90_000),
  });
}

/**
 * Uploads `imageUrl` and runs `tool` on it, returning the result blob or null.
 *
 * The task id is only format-checked (32 hex), and the upload answers the
 * `server_filename` the tool call needs. Extra tool options go in `fields`.
 */
export async function runTool(
  host: string,
  tool: string,
  imageUrl: string,
  fields: Record<string, string> = {},
): Promise<Blob | null> {
  try {
    const source = await fetch(imageUrl, {
      signal: AbortSignal.timeout(30_000),
    });
    if (!source.ok) return null;

    // Only jpg/png are accepted.
    const isPng =
      source.headers.get("content-type")?.startsWith("image/png") ?? false;
    const task = crypto.randomUUID().replaceAll("-", "");
    const upload = new FormData();
    upload.append("task", task);
    upload.append(
      "file",
      new Blob([await source.arrayBuffer()], {
        type: isPng ? "image/png" : "image/jpeg",
      }),
      isPng ? "image.png" : "image.jpg",
    );

    const res = await post(host, "upload", upload);
    if (!res.ok) return null;
    const { server_filename } = (await res.json()) as {
      server_filename?: string;
    };
    if (!server_filename) return null;

    const form = new FormData();
    form.append("task", task);
    form.append("server_filename", server_filename);
    for (const [key, value] of Object.entries(fields)) form.append(key, value);

    const result = await post(host, tool, form);
    return result.ok ? await result.blob() : null;
  } catch {
    return null;
  }
}

/** Removes the background and returns a transparent PNG, or null on failure.
 *  The tool only exists on api4g–api6g; api20g answers 500. */
export function removeBackground(imageUrl: string): Promise<Blob | null> {
  return runTool("api4g", "removebackground", imageUrl);
}

/** Upscales the image 2x on api20g, or returns null on any failure. */
export function upscale(imageUrl: string): Promise<Blob | null> {
  return runTool("api20g", "upscale", imageUrl, { scale: "2" });
}
