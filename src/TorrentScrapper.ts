import puppeteer, { Browser } from "puppeteer";
import { Worker } from "snowflake-uuid";

type torrentSelectors = {
  titles_selector: string;
  seeds_selector: string;
  leeches_selector: string;
  sizes_selector: string;
};

export type torrentInfo = {
  id: string;
  title: string;
  seeds: number;
  leeches: number;
  size_kbs: number;
  link: string;
  magnet: string | undefined;
  category: string | undefined;
};

export type siteConfig = {
  search_url: string;
  list_selectors: torrentSelectors;
  magnet_selector: string;
  category_selector: string;
  allowed_categories: string[];
};

const generator = new Worker(0, 1, {
  workerIdBits: 5,
  datacenterIdBits: 5,
  sequenceBits: 12,
});

function sizeParser(size: string) {
  const sizeRegex = /(\d+(?:\.\d+)?)\s*(\w+)/;
  const sizeMatch = sizeRegex.exec(size);
  if (sizeMatch) {
    const sizeValue = Number(sizeMatch[1]);
    const sizeUnit = sizeMatch[2];
    switch (sizeUnit) {
      case "GB":
        return sizeValue * 1024 * 1024;
      case "MB":
        return sizeValue * 1024;
      case "KB":
        return sizeValue;
      default:
        return 0;
    }
  }
  return 0;
}

export default class TorrentScrapper {
  private browser: Browser | undefined;

  // eslint-disable-next-line no-useless-constructor
  constructor(private site: siteConfig) {}

  async init() {
    this.browser = await puppeteer.launch();
  }

  async search(search: string): Promise<Promise<torrentInfo | undefined>[]> {
    const page = await this.browser?.newPage();
    await page?.goto(encodeURI(this.site.search_url.replace("%s", search)));
    const titles = await page?.$$eval(this.site.list_selectors.titles_selector, (el) =>
      (el as HTMLElement[]).map((e) => e.innerText)
    );
    const seeds = await page?.$$eval(this.site.list_selectors.seeds_selector, (el) =>
      (el as HTMLElement[]).map((e) => e.innerText)
    );
    const leeches = await page?.$$eval(this.site.list_selectors.leeches_selector, (el) =>
      (el as HTMLElement[]).map((e) => e.innerText)
    );
    const sizes = await page?.$$eval(this.site.list_selectors.sizes_selector, (el) =>
      (el as HTMLElement[]).map((e) => e.innerText)
    );
    const links = await page?.$$eval(this.site.list_selectors.titles_selector, (el) =>
      (el as HTMLLinkElement[]).map((e) => e.href)
    );
    if (titles && seeds && leeches && sizes && links) {
      return titles.slice(0, Number(process.env.SEARCH_LIMIT) ?? 3).map(async (_el: any, index: number) => {
        const { magnet, category } = await this.getAdditionalInformation(links[index]);
        if (category && this.site.allowed_categories.includes(category.toLowerCase())) {
          return {
            id: generator.nextId().toString(),
            title: titles[index],
            seeds: Number(seeds[index]),
            leeches: Number(leeches[index]),
            size_kbs: sizeParser(sizes[index]),
            link: links[index],
            magnet,
            category,
          };
        }
      });
    }
    throw new Error("No results found");
  }

  private async getAdditionalInformation(URL: string): Promise<{ magnet?: string; category?: string }> {
    const page = await this.browser?.newPage();
    await page?.goto(URL);
    const magnet = await page?.$eval(this.site.magnet_selector, (el) => (el as HTMLLinkElement).href);
    const category = await page?.$eval(this.site.category_selector, (el) => (el as HTMLLinkElement).innerText);

    return { magnet, category };
  }

  async close() {
    await this.browser?.close();
  }
}
