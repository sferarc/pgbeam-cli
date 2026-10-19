function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function isDotSegment(segment: string): boolean {
  const decoded = safeDecode(segment);
  return decoded === "." || decoded === "..";
}

function assertRelativePath(path: string): void {
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\")) {
    throw new Error(
      `Refusing API path "${path}": it must be a path on the PgBeam API starting with a single "/", not a URL or another host.`,
    );
  }
  const pathname = path.split(/[?#]/, 1)[0];
  if (pathname.split("/").some(isDotSegment)) {
    throw new Error(`Refusing API path "${path}": "." and ".." segments are not allowed.`);
  }
}

function assertPathParam(key: string, value: string): void {
  const decoded = safeDecode(value);
  const bad =
    value === "" ||
    isDotSegment(value) ||
    value.includes("/") ||
    value.includes("\\") ||
    decoded.includes("/") ||
    decoded.includes("\\");
  if (bad) {
    throw new Error(
      `Refusing path parameter ${key}=${JSON.stringify(value)}: it must be a single non-empty path segment, not ".", "..", or a value containing "/".`,
    );
  }
}

/**
 * Build the request URL for a raw API call and refuse anything that would leave
 * the API origin or resolve to a different route than the one the caller named.
 */
export function buildApiUrl(
  baseUrl: string,
  path: string,
  pathParams?: Record<string, string>,
  queryParams?: Record<string, string>,
): URL {
  assertRelativePath(path);

  let resolved = path;
  if (pathParams) {
    for (const [key, value] of Object.entries(pathParams)) {
      assertPathParam(key, value);
      resolved = resolved.replace(`{${key}}`, encodeURIComponent(value));
    }
  }

  const url = new URL(resolved, baseUrl);
  if (url.origin !== new URL(baseUrl).origin) {
    throw new Error(`Refusing API path "${path}": it resolves outside ${new URL(baseUrl).origin}.`);
  }

  if (queryParams) {
    for (const [key, value] of Object.entries(queryParams)) {
      url.searchParams.set(key, value);
    }
  }
  return url;
}
