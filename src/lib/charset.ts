function detectCharsetInContentType(
  contentType: null | string,
): string | undefined {
  if (!contentType) {
    return undefined;
  }

  const match = /charset\s*=\s*["']?([^;"'\s]+)/i.exec(contentType);
  return match?.[1]?.toLowerCase();
}

function detectCharsetInMeta(html: string): string | undefined {
  const charsetMatch = /<meta[^>]+charset\s*=\s*["']?([^"'\s/>]+)/i.exec(html);
  if (charsetMatch?.[1]) {
    return charsetMatch[1].toLowerCase();
  }

  const contentMatch =
    /<meta[^>]+content\s*=\s*["'][^"']*charset=([^"'\s;]+)/i.exec(html);
  return contentMatch?.[1]?.toLowerCase();
}

function decodeWithCharset(bytes: Uint8Array, charset: string): string {
  try {
    return new TextDecoder(charset).decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

export function decodeHtml(
  bytes: ArrayBuffer | Uint8Array,
  contentType: null | string,
) {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const contentTypeCharset = detectCharsetInContentType(contentType);
  const preview = new TextDecoder("utf-8").decode(
    data.subarray(0, Math.min(data.byteLength, 2048)),
  );
  const metaCharset = detectCharsetInMeta(preview);
  const charset = contentTypeCharset ?? metaCharset ?? "utf-8";

  return {
    charset,
    html: decodeWithCharset(data, charset),
  };
}
