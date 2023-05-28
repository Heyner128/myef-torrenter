import dayjs from "dayjs";
// @ts-ignore
import TorrentClient from "webtorrent";
import logger from "./logger";
// @ts-ignore
import { TorrentInfo } from "./TorrentScrapper";

export type TorrentControllerOptions = {
  download_speed_limit: number;
  upload_speed_limit: number;
  max_queue_size: number;
  max_download_size_kbs: number;
  min_ratio: number;
  min_seeds: number;
  max_download_age_mins: number;
  download_path: string;
  remove_delay_secs: number;
};

export type WebtorrentFile = {
  name: string;
  arrayBuffer: () => Buffer;
  path: string;
};

export type WebtorrentDownload = {
  name: string;
  progress: number;
  downloadSpeed: number;
  uploadSpeed: number;
  length: number;
  downloaded: number;
  infoHash: string;
  magnetURI: string;
  files: WebtorrentFile[];
  done: boolean;
  on: (event: string, callback: (e: Error) => void) => void;
};

type Download = {
  magnetBrowser: string;
  infoHash: string;
  created: Date;
};

export default class TorrentController {
  constructor(private options?: TorrentControllerOptions) {
    this.torrentClient.on("error", (err: Error) => {
      logger.error(err);
    });
  }

  private torrentClient: TorrentClient = new TorrentClient({
    downloadLimit: (this?.options?.download_speed_limit ?? 700) * 1024,
    uploadLimit: (this?.options?.upload_speed_limit ?? 50) * 1024,
  });

  private downloadQueue: Download[] = [];

  get torrentList() {
    return this.torrentClient.torrents;
  }

  public downloadTorrent(torrent: TorrentInfo): Promise<WebtorrentDownload> {
    if (!torrent?.magnet) throw new Error("El enlace al torrent no es valido");
    if (this.torrentClient.torrents.length === (this.options?.max_queue_size ?? 3))
      throw new Error("La cola de descargas esta llena");
    if (torrent.size_kbs > (this?.options?.max_download_size_kbs ?? 2048000))
      throw new Error("El archivo es muy grande");
    if (
      torrent.seeds / torrent.leeches < (this?.options?.min_ratio ?? 5) ||
      torrent.seeds < (this?.options?.min_seeds ?? 10)
    )
      throw new Error("La descarga no tiene suficiente calidad");
    try {
      return this.addTorrent(torrent.magnet);
    } catch (e) {
      throw new Error("No se pudo descargar el torrent, probablemente ya este en la lista descargas");
    }
  }

  public async downloadWatcher(
    sourceChatId: number,
    magnetBrowser: string,
    onDone: (chatId: number, download: WebtorrentDownload) => void
  ) {
    const intervalId = setInterval(async () => {
      const downloadAdditional = this.downloadQueue.find((d) => d.magnetBrowser === magnetBrowser);
      const download: WebtorrentDownload | undefined = this.torrentClient.torrents.find(
        (d: WebtorrentDownload) => d.infoHash === downloadAdditional?.infoHash
      );
      if (!downloadAdditional || !download) {
        clearInterval(intervalId);
        return;
      }
      const minutesElapsed = (dayjs().unix() - dayjs(downloadAdditional.created).unix()) / 60;
      if (minutesElapsed > (this?.options?.max_download_age_mins ?? 90)) {
        this.removeTorrent(magnetBrowser);
        clearInterval(intervalId);
      }
      if (download.done) {
        logger.info("download finished successfully");
        onDone(sourceChatId, download);
        // this gives time to the status messages to update
        setTimeout(() => this.removeTorrent.call(this, magnetBrowser), (this?.options?.remove_delay_secs ?? 60) * 1000);
        clearInterval(intervalId);
      }
    }, 500);
  }

  public getTorrent(torrentId: string): WebtorrentDownload | undefined {
    return this.torrentClient.torrents.find((t: WebtorrentDownload) => t.infoHash === torrentId);
  }

  private async addTorrent(magnetBrowser: string): Promise<WebtorrentDownload> {
    return new Promise((resolve, reject) => {
      try {
        const torrentInClient = this.torrentClient.torrents.find(
          (t: WebtorrentDownload) =>
            t.infoHash === this.downloadQueue.find((d) => d.magnetBrowser === magnetBrowser)?.infoHash
        );
        if (torrentInClient) reject(new Error("El torrent ya esta en la lista de descargas"));
        this.torrentClient.add(
          magnetBrowser,
          {
            path: this?.options?.download_path ?? "./downloads",
            destroyStoreOnDestroy: true,
          },
          (torrent: WebtorrentDownload) => {
            this.downloadQueue.push({
              magnetBrowser,
              infoHash: torrent.infoHash,
              created: dayjs().toDate(),
            });
            resolve(torrent);
          }
        );
      } catch (e) {
        reject(e);
      }
    });
  }

  private removeTorrent(magnetBrowser: string) {
    const torrent = this.torrentClient.torrents.find(
      (t: WebtorrentDownload) =>
        t.infoHash === this.downloadQueue.find((d) => d.magnetBrowser === magnetBrowser)?.infoHash
    );
    if (!torrent) throw new Error("No se encontro la descarga");
    torrent.destroy();
    this.downloadQueue = this.downloadQueue.filter((d) => d.magnetBrowser !== magnetBrowser);
  }
}
