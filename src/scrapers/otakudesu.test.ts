import { describe, expect, test } from "bun:test";
import {
  otakuAnime,
  parseOtakuAnime,
  parseOtakuHome,
  parseOtakuList,
  parseOtakuSearch,
} from "@/scrapers/otakudesu";

/** Trimmed from https://otakudesu.blog/ on 2026-10-25: one ongoing card with an
 *  airing day, one complete card with a score in the same slot. */
const HOME = `
<div class="rapi"><a href="https://otakudesu.blog/ongoing-anime/"><div id='rvod' class='rvad'><h1>On-going Anime</h1><div class='iconf'>Cek Anime On-going Lainnya</div></div></a><div class="venz"><ul>
<li><div class='detpost'><div class='epz'><span class="dashicons dashicons-desktop"></span> Episode 4</div><div class='epztipe'><i class='fa fa-star'></i> Minggu</div><div class="newnime">25 Okt</div><div class="thumb"><a href="https://otakudesu.blog/anime/aoashi-s2-sub-indo/" title=""><span class='overlay flaticon-play-button'></span><div class="thumbz"><img width="106" height="150" src="https://otakudesu.blog/wp-content/uploads/2026/10/158726.jpg" class="attachment-thumb" alt="Ao Ashi Season 2" /><h2 class="jdlflm">Ao Ashi Season 2</h2></div></a></div></div></li>
</ul></div></div>
<div class="rapi"><h1>Complete Anime</h1><div class="venz"><ul>
<li><div class='detpost'><div class='epz'><span class="dashicons dashicons-desktop"></span> 12 Episode</div><div class='epztipe'><i class='fa fa-star'></i> 6.88</div><div class="newnime">14 Okt</div><div class="thumb"><a href="https://otakudesu.blog/anime/saijo-osewa-sub-indo/" title="Saijo no Osewa (Episode 1 &#8211; 12) Subtitle Indonesia"><div class="thumbz"><img src="https://otakudesu.blog/wp-content/uploads/2026/09/Saijo-no-Osewa-Sub-Indo.jpg" /><h2 class="jdlflm">Saijo no Osewa</h2></div></a></div></div></li>
</ul></div></div>
`;

const LIST = `
<div class="venz"><ul>
<li><div class='detpost'><div class='epz'><span class="dashicons dashicons-desktop"></span> Episode 4</div><div class='epztipe'><i class='fa fa-star'></i> Minggu</div><div class="newnime">25 Okt</div><div class="thumb"><a href="https://otakudesu.blog/anime/aoashi-s2-sub-indo/"><img src="https://otakudesu.blog/wp-content/uploads/2026/10/158726.jpg" /><h2 class="jdlflm">Ao Ashi Season 2</h2></a></div></div></li>
<li><div class='detpost'><div class='epz'><span class="dashicons dashicons-desktop"></span> Episode 3</div><div class='epztipe'><i class='fa fa-star'></i> Minggu</div><div class="newnime">18 Okt</div><div class="thumb"><a href="https://otakudesu.blog/anime/yozakura-daisakusen-s2p2-sub-indo/"><img src="https://otakudesu.blog/wp-content/uploads/2026/10/159001.jpg" /><h2 class="jdlflm">Yozakura-san Chi no Daisakusen Season 2 Part 2</h2></a></div></div></li>
</ul></div>
<div class="pagination"><div class="pagenavix"><span>Pages</span><a class="prev page-numbers" href="https://otakudesu.blog/ongoing-anime/page/1/">Sebelumnya</a><span aria-current="page" class="page-numbers current">2</span><a class="next page-numbers" href="https://otakudesu.blog/ongoing-anime/page/3/">Berikutnya</a></div></div>
`;

const SEARCH = `
<ul class="chivsrc"><li style='list-style:none;'><img width="225" height="318" src="https://otakudesu.blog/wp-content/uploads/2026/01/154488.jpg" alt="Jujutsu Kaisen Season 3 Sub Indo" /><h2><a href="https://otakudesu.blog/anime/jjk-s3-sub-indo/" title="https://otakudesu.blog/anime/jjk-s3-sub-indo/">Jujutsu Kaisen Season 3 Subtitle Indonesia</a></h2><div class="set"><b>Genres</b> : <a href="https://otakudesu.blog/genres/action/">Action</a>, <a href="https://otakudesu.blog/genres/school/">School</a></div><div class="set"><b>Status</b> : Ongoing</div><div class="set"><b>Rating</b> : 7.57</div></li></ul>
`;

/** Batch block first with an empty list, then the episode list — the real page
 *  ships them in that order, so a heading match is what keeps episodes correct. */
const DETAIL = `
<div class="venser"><div class='jdlrx'><h1>Ao Ashi Season 2 Subtitle Indonesia <span style='float:right;font-size:12px'><i class='fa fa-eye'></i></span></h1></div><div class='fotoanime' style='overflow:inherit !important;'><img width="225" height="318" src="https://otakudesu.blog/wp-content/uploads/2026/10/158726.jpg" /><div class="infozin"><div class="infozingle"><p><span><b>Judul</b>: Ao Ashi Season 2</span></p><p><span><b>Skor</b>: </span></p><p><span><b>Status</b>: Ongoing</span></p><p><span><b>Genre</b>: <a href="https://otakudesu.blog/genres/comedy/">Comedy</a>, <a href="https://otakudesu.blog/genres/romance/">Romance</a></span></p></div></div><div class='sinopc'></div></div></div>
<div id="serieslist"></div><div class="episodelist"><div class="smokelister"><span class="monktit">Ao Ashi Season 2 Batch</span></div><ul></ul></div>
<div class="episodelist"><div class="smokelister"><span class="monktit">Ao Ashi Season 2 Episode List <span style="color: #000000;">(Link Download Episode + Streaming)</span></span></div><ul><li><span><a href="https://otakudesu.blog/episode/asohia-s2-episode-2-sub-indo/">Ao Ashi Season 2 Episode 2 Subtitle Indonesia</a></span><span class='zeebr' style='float:right'>11 Oktober,2026</span></li><li><span><a href="https://otakudesu.blog/episode/asohia-s2-episode-1-sub-indo/">Ao Ashi Season 2 Episode 1 &#8211; Sub Indo</a></span><span class='zeebr' style='float:right'>4 Oktober,2026</span></li></ul></div>
`;

describe("parseOtakuHome", () => {
  test("splits the two blocks and reads the shared day/score slot", () => {
    const home = parseOtakuHome(HOME);
    expect(home?.ongoing).toHaveLength(1);
    expect(home?.complete).toHaveLength(1);

    expect(home?.ongoing[0]).toEqual({
      title: "Ao Ashi Season 2",
      slug: "aoashi-s2-sub-indo",
      url: "https://otakudesu.blog/anime/aoashi-s2-sub-indo/",
      poster: "https://otakudesu.blog/wp-content/uploads/2026/10/158726.jpg",
      episode: 4,
      score: null,
      day: "Minggu",
      updated: "25 Okt",
    });

    expect(home?.complete[0]?.episode).toBe(12);
    expect(home?.complete[0]?.score).toBe(6.88);
    expect(home?.complete[0]?.day).toBeNull();
    expect(home?.complete[0]?.updated).toBe("14 Okt");
  });

  test("an empty body is a failure, not an empty list", () => {
    expect(parseOtakuHome("<html></html>")).toBeNull();
  });
});

describe("parseOtakuList", () => {
  test("reads the cards and the next anchor", () => {
    const list = parseOtakuList(LIST, 2);
    expect(list?.page).toBe(2);
    expect(list?.hasNext).toBe(true);
    expect(list?.items).toHaveLength(2);
    expect(list?.items[1]?.title).toBe(
      "Yozakura-san Chi no Daisakusen Season 2 Part 2",
    );
  });

  test("the last page has no next anchor and no cards is null", () => {
    const last = LIST.replace('class="next page-numbers"', 'class="none"');
    expect(parseOtakuList(last, 6)?.hasNext).toBe(false);
    expect(parseOtakuList("<html></html>", 999)).toBeNull();
  });
});

describe("parseOtakuSearch", () => {
  test("reads status and rating, ignores the genres row", () => {
    const items = parseOtakuSearch(SEARCH);
    expect(items).toHaveLength(1);
    expect(items?.[0]).toEqual({
      title: "Jujutsu Kaisen Season 3 Subtitle Indonesia",
      slug: "jjk-s3-sub-indo",
      url: "https://otakudesu.blog/anime/jjk-s3-sub-indo/",
      poster: "https://otakudesu.blog/wp-content/uploads/2026/01/154488.jpg",
      status: "Ongoing",
      score: 7.57,
    });
  });

  test("a page without the result list is null", () => {
    expect(parseOtakuSearch("<html></html>")).toBeNull();
  });
});

describe("parseOtakuAnime", () => {
  const url = "https://otakudesu.blog/anime/aoashi-s2-sub-indo/";

  test("reads the title, the info block and the episode list only", () => {
    const detail = parseOtakuAnime(DETAIL, url);
    expect(detail?.title).toBe("Ao Ashi Season 2 Subtitle Indonesia");
    expect(detail?.slug).toBe("aoashi-s2-sub-indo");
    expect(detail?.poster).toBe(
      "https://otakudesu.blog/wp-content/uploads/2026/10/158726.jpg",
    );
    expect(detail?.info).toEqual({
      Judul: "Ao Ashi Season 2",
      Status: "Ongoing",
      Genre: "Comedy, Romance",
    });
    expect(detail?.episodes).toHaveLength(2);
    expect(detail?.episodes[0]?.released).toBe("11 Oktober,2026");
  });

  test("decodes the entity in an episode title", () => {
    expect(parseOtakuAnime(DETAIL, url)?.episodes[1]?.title).toBe(
      "Ao Ashi Season 2 Episode 1 - Sub Indo",
    );
  });

  test("an empty synopsis block is an empty string", () => {
    expect(parseOtakuAnime(DETAIL, url)?.synopsis).toBe("");
  });

  test("no title is null", () => {
    expect(parseOtakuAnime("<html></html>", url)).toBeNull();
  });
});

describe("otakuAnime", () => {
  test("rejects a target that is not a slug without a request", async () => {
    expect(await otakuAnime("not a slug!")).toBeNull();
  });
});
