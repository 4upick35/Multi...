export interface FeedMessage {
  id: string;
  title: string;
  text: string;
  author: string;
  createdAt: string;
  raw: Record<string, unknown>;
}

export interface FeedChannel {
  id: string;
  name: string;
  raw: Record<string, unknown>;
}
