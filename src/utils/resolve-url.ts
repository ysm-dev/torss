export function resolveUrl(input: string, baseUrl: string): null | string {
  const trimmed = input.trim();

  if (!trimmed || trimmed.startsWith("#")) {
    return null;
  }

  const candidate = trimmed.startsWith("//") ? `https:${trimmed}` : trimmed;
  const resolved = new URL(candidate, baseUrl);

  if (resolved.protocol !== "http:" && resolved.protocol !== "https:") {
    return null;
  }

  return resolved.toString();
}
