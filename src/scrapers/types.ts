/** A single downloadable file resolved from a post. */
export interface MediaItem {
  /** Direct CDN URL. */
  url: string;
  /** `video` sends as a playable clip, `image` as a photo. */
  kind: "video" | "image";
  mimetype: string;
}

/** Everything a post yields: a video, or the slides of a photo carousel. */
export interface ScrapedMedia {
  /** Ordered items; a carousel has one entry per slide. */
  items: MediaItem[];
  caption: string;
}
