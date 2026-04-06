import { escapeXml } from "../utils/escape-xml";
import type { FeedItem } from "./types";

type GenerateAtomInput = {
  fetchedAt: string;
  items: FeedItem[];
  selfUrl: string;
  sourceTitle: string;
  sourceUrl: string;
};

function renderEntry(item: FeedItem, fetchedAt: string): string {
  const lines = [
    "  <entry>",
    `    <title>${escapeXml(item.title)}</title>`,
    `    <link href="${escapeXml(item.link)}" rel="alternate"/>`,
    `    <id>${escapeXml(item.link)}</id>`,
    `    <updated>${escapeXml(fetchedAt)}</updated>`,
  ];

  if (item.desc) {
    lines.push(`    <summary>${escapeXml(item.desc)}</summary>`);
  }

  lines.push("  </entry>");
  return lines.join("\n");
}

export function generateAtom(input: GenerateAtomInput): string {
  const entries = input.items
    .map((item) => renderEntry(item, input.fetchedAt))
    .join("\n");

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<feed xmlns="http://www.w3.org/2005/Atom">',
    `  <title>${escapeXml(input.sourceTitle)}</title>`,
    `  <link href="${escapeXml(input.sourceUrl)}" rel="alternate"/>`,
    `  <link href="${escapeXml(input.selfUrl)}" rel="self"/>`,
    `  <id>${escapeXml(input.sourceUrl)}</id>`,
    `  <updated>${escapeXml(input.fetchedAt)}</updated>`,
    entries,
    "</feed>",
  ].join("\n");
}
