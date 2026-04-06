export type ErrorBodyValue = boolean | number | null | string | string[];

export type ErrorBody = Record<string, ErrorBodyValue>;

export type Result<T> =
  | { ok: true; value: T }
  | { ok: false; error: { body: ErrorBody; status: number } };

export type FeedItem = {
  desc: null | string;
  link: string;
  title: string;
};

export type FeedRequest = {
  debug: boolean;
  desc?: string;
  item: string;
  lang: string;
  limit: number;
  link: string;
  title?: string;
  ttl: number;
  url: string;
};

export type PageResult = {
  charset: string;
  html: string;
};

export type ScrapeResult = {
  charset: string;
  fetchMs: number;
  fetchedAt: string;
  items: FeedItem[];
  sourceTitle: string;
  sourceUrl: string;
  totalAfterDedup: number;
  totalAfterLimit: number;
  totalMatched: number;
};
