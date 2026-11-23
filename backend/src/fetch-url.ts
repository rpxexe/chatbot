import { lookup } from "node:dns/promises";
import { BlockList } from "node:net";
import { HttpError } from "./extract.js";

const MAX_BYTES = 10 * 1024 * 1024;
const MAX_REDIRECTS = 5;

// Private, loopback, link-local (incl. cloud metadata 169.254.169.254) and other non-public ranges.
// BlockList also checks IPv4-mapped IPv6 (::ffff:a.b.c.d) against the IPv4 rules, so no ::ffff:0:0/96 entry (it would block all IPv4).
const blocked = new BlockList();
for (const [net, bits] of [["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16],
  ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["224.0.0.0", 3]] as const) {
  blocked.addSubnet(net, bits, "ipv4");
}
for (const [net, bits] of [["::", 128], ["::1", 128], ["64:ff9b::", 96], ["fc00::", 7], ["fe80::", 10], ["ff00::", 8]] as const) {
  blocked.addSubnet(net, bits, "ipv6");
}

export const isBlockedAddress = (ip: string, family: number) => blocked.check(ip, family === 6 ? "ipv6" : "ipv4");

// shortcut: checks DNS before connecting but not the connected socket, so DNS rebinding can slip through; pin the resolved IP via a custom undici dispatcher if this endpoint is ever exposed beyond trusted admins.
async function assertPublic(url: URL) {
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new HttpError(400, "Only http and https URLs are allowed");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  let addrs: { address: string; family: number }[];
  try {
    addrs = await lookup(host, { all: true });
  } catch {
    throw new HttpError(422, `Could not resolve ${host}`);
  }
  if (addrs.some((a) => isBlockedAddress(a.address, a.family))) {
    throw new HttpError(400, "That URL points to a private or local network address");
  }
}

export async function fetchUrl(raw: string): Promise<{ buf: Buffer; contentType: string; url: URL }> {
  let url: URL;
  try { url = new URL(raw); } catch { throw new HttpError(400, "Invalid URL"); }

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertPublic(url);
    let res: Response;
    try {
      res = await fetch(url, {
        redirect: "manual",
        signal: AbortSignal.timeout(15_000),
        headers: { "user-agent": "KnowledgeBaseImporter/1.0", accept: "text/html,application/pdf,text/*;q=0.9" },
      });
    } catch (e) {
      throw new HttpError(422, `Could not fetch URL: ${(e as Error).message}`);
    }
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      url = new URL(res.headers.get("location")!, url);
      continue;
    }
    if (!res.ok) throw new HttpError(422, `URL returned HTTP ${res.status}`);
    if (Number(res.headers.get("content-length") ?? 0) > MAX_BYTES) throw new HttpError(413, "Page is larger than 10 MB");

    const chunks: Uint8Array[] = [];
    let size = 0;
    for await (const c of res.body as unknown as AsyncIterable<Uint8Array>) {
      size += c.length;
      if (size > MAX_BYTES) throw new HttpError(413, "Page is larger than 10 MB");
      chunks.push(c);
    }
    return { buf: Buffer.concat(chunks), contentType: res.headers.get("content-type") ?? "", url };
  }
  throw new HttpError(422, "Too many redirects");
}
