const USER_AGENT = "AnsabPipeline/0.1 (research project)";
const RATE_LIMIT_MS = 500;

let lastRequestTime = 0;

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function rateLimitedFetch(url: string, retries = 2): Promise<Response | null> {
  const now = Date.now();
  const elapsed = now - lastRequestTime;
  if (elapsed < RATE_LIMIT_MS) {
    await sleep(RATE_LIMIT_MS - elapsed);
  }
  lastRequestTime = Date.now();

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url, {
        headers: { "User-Agent": USER_AGENT },
        redirect: "follow",
      });
      if (response.ok) return response;
      console.error(`HTTP ${response.status} for ${url}`);
      if (attempt < retries) await sleep(1000 * (attempt + 1));
    } catch (err) {
      console.error(`Fetch error (attempt ${attempt + 1}/${retries + 1}):`, (err as Error).message);
      if (attempt < retries) await sleep(1000 * (attempt + 1));
    }
  }
  return null;
}

export async function fetchWikipediaSummary(title: string): Promise<string> {
  const encoded = encodeURIComponent(title);
  const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encoded}`;
  const res = await rateLimitedFetch(url);
  if (!res) return "";
  try {
    const data = await res.json();
    return (data as { extract?: string }).extract ?? "";
  } catch {
    return "";
  }
}

export async function fetchWikipediaFull(title: string): Promise<string> {
  const encoded = encodeURIComponent(title);
  const url = `https://en.wikipedia.org/w/api.php?action=query&titles=${encoded}&prop=extracts&explaintext=true&format=json`;
  const res = await rateLimitedFetch(url);
  if (!res) return "";
  try {
    const data = (await res.json()) as {
      query?: { pages?: Record<string, { extract?: string }> };
    };
    const pages = data.query?.pages;
    if (!pages) return "";
    const page = Object.values(pages)[0];
    return page?.extract ?? "";
  } catch {
    return "";
  }
}

export function extractWikipediaTitleFromUrl(url: string): string {
  const match = url.match(/\/wiki\/([^#?]+)/);
  if (!match) return "";
  return decodeURIComponent(match[1].replace(/_/g, " "));
}

export async function searchWikipedia(query: string): Promise<string[]> {
  const encoded = encodeURIComponent(query);
  const url = `https://en.wikipedia.org/w/api.php?action=opensearch&search=${encoded}&limit=5&format=json`;
  const res = await rateLimitedFetch(url);
  if (!res) return [];
  try {
    const data = (await res.json()) as [string, string[]];
    return data[1] ?? [];
  } catch {
    return [];
  }
}
