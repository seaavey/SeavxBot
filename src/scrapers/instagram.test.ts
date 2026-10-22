import { describe, expect, test } from "bun:test";
import { parseApiItems, parseInstagramEmbed } from "@/scrapers/instagram";

/** The embed page hands the payload to the browser as an escaped JS string. */
const embed = (media: unknown): string => {
  const json = JSON.stringify({ gql_data: { shortcode_media: media } });
  // Quoting the string once yields exactly the escaped form the page ships.
  const escaped = JSON.stringify(json).slice(1, -1);
  return `<script>window.__d="${escaped}"</script>`;
};

const image = (name: string) => ({
  is_video: false,
  display_url: `https://cdn.test/${name}.jpg?a=1&b=2`,
  owner: { username: "someone" },
});

describe("instagram embed payload", () => {
  test("a carousel yields one item per slide, in order", () => {
    const html = embed({
      is_video: false,
      display_url: "https://cdn.test/first.jpg",
      owner: { username: "someone" },
      edge_sidecar_to_children: {
        edges: [
          { node: image("slide1") },
          {
            node: {
              is_video: true,
              video_url: "https://cdn.test/slide2.mp4?a=1&b=2",
              display_url: "https://cdn.test/slide2.jpg",
            },
          },
          { node: image("slide3") },
        ],
      },
    });

    const edges = parseInstagramEmbed(html)?.edge_sidecar_to_children?.edges;
    expect(
      edges?.map((edge) => edge.node.video_url ?? edge.node.display_url),
    ).toEqual([
      "https://cdn.test/slide1.jpg?a=1&b=2",
      "https://cdn.test/slide2.mp4?a=1&b=2",
      "https://cdn.test/slide3.jpg?a=1&b=2",
    ]);
  });

  test("a single post is its own node", () => {
    const html = embed({
      is_video: true,
      video_url: "https://cdn.test/clip.mp4?a=1&b=2",
      owner: { username: "someone" },
    });

    expect(parseInstagramEmbed(html)?.video_url).toBe(
      "https://cdn.test/clip.mp4?a=1&b=2",
    );
  });

  test("braces and quotes inside a caption survive the scan", () => {
    const caption = "say {" + '"hi"' + "} and } then end";
    const html = embed({
      ...image("slide1"),
      edge_media_to_caption: {
        edges: [{ node: { text: caption } }],
      },
    });

    expect(parseInstagramEmbed(html)?.display_url).toBe(
      "https://cdn.test/slide1.jpg?a=1&b=2",
    );
  });

  test("markup without the payload yields null", () => {
    expect(parseInstagramEmbed("<html><body>nope</body></html>")).toBeNull();
  });
});

describe("snapinsta response", () => {
  const anchor = (title: string, href: string) =>
    `<a href="${href}" class="abutton" rel="nofollow" title="${title}"><span>${title}</span></a>`;

  test("keeps slides in order and skips thumbnails", () => {
    const html = [
      anchor("Download Image", "https://dl.test/1"),
      anchor("Download Thumbnail", "https://dl.test/thumb"),
      anchor("Download Video", "https://dl.test/2"),
      anchor("Download with SaveInsta app", "#"),
      anchor("Download Image", "https://dl.test/3"),
    ].join("\n");

    expect(parseApiItems(html)).toEqual([
      { url: "https://dl.test/1", kind: "image", mimetype: "image/jpeg" },
      { url: "https://dl.test/2", kind: "video", mimetype: "video/mp4" },
      { url: "https://dl.test/3", kind: "image", mimetype: "image/jpeg" },
    ]);
  });
});
