import { SiteConfig } from "../TorrentScrapper";

export default {
  search_url: "https://1337x.to/sort-search/%s/seeders/desc/1/",
  list_selectors: {
    titles_selector: "table.table-list tbody tr td.coll-1.name a:nth-child(2)",
    seeds_selector: "table.table-list tbody tr td.coll-2.seeds",
    leeches_selector: "table.table-list tbody tr td.coll-3.leeches",
    sizes_selector: "table.table-list tbody tr td.coll-4.size",
  },
  magnet_selector: `a[href^="magnet:?xt=urn:btih:"]`,
  category_selector: ".torrent-detail-page ul.list:nth-child(2) span",
  allowed_categories: ["movies", "tv", "anime", "music", "documentaries"],
} as SiteConfig;
