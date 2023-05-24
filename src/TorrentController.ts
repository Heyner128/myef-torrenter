import dayjs from "dayjs";
// @ts-ignore
import TorrentClient from "webtorrent";
import { torrentInfo } from "./TorrentScrapper";

export type webtorrentFile = {
  name: string;
  arrayBuffer: () => Buffer;
  path: string;
};

export type webtorrentDownload = {
  name: string;
  progress: number;
  downloadSpeed: number;
  uploadSpeed: number;
  length: number;
  downloaded: number;
  infoHash: string;
  magnetURI: string;
  files: webtorrentFile[];
  done: boolean;
  on: (event: string, callback: (e: Error) => void) => void;
};

type Download = {
  magnetURI: string;
  created: Date;
};

export default class TorrentController {
  private torrentClient: TorrentClient = new TorrentClient({
    downloadLimit: (Number(process.env.DOWNLOAD_SPEED_LIMIT_KBS) ?? 1) * 1024,
    uploadLimit: (Number(process.env.UPLOAD_SPEED_LIMIT_KBS) ?? 0.1) * 1024,
  });

  private downloadQueue: Download[] = [];

  get torrentList() {
    return this.torrentClient.torrents;
  }

  public async downloadTorrent(torrent: torrentInfo): Promise<webtorrentDownload> {
    if (!torrent?.magnet) throw new Error("El enlace al torrent no es valido");
    if (this.torrentClient.torrents.length === Number(process.env.MAX_QUEUE_SIZE))
      throw new Error("La cola de descargas esta llena");
    if (torrent.size_kbs > Number(process.env.MAX_DOWNLOAD_SIZE_KBS)) throw new Error("El archivo es muy grande");
    if (
      torrent.seeds / torrent.leeches < Number(process.env.MIN_RATIO) ||
      torrent.seeds < Number(process.env.MIN_SEEDS)
    )
      throw new Error("La descarga no tiene suficiente calidad");
    return this.addTorrent(torrent.magnet);
  }

  public async downloadWatcher(
    sourceChatId: number,
    magnetURI: string,
    onDone: (chatId: number, download: webtorrentDownload) => void
  ) {
    const intervalId = setInterval(async () => {
      const downloadAdditional = this.downloadQueue.find((d) => d.magnetURI === magnetURI);
      const download: webtorrentDownload | undefined = this.torrentClient.torrents.find(
        (d: webtorrentDownload) => d.magnetURI === magnetURI
      );
      if (!downloadAdditional || !download) return;
      const minutesElapsed = (dayjs().unix() - dayjs(downloadAdditional.created).unix()) / 60;
      if (minutesElapsed > Number(process.env.MAX_DOWNLOAD_AGE_MINS)) {
        this.removeTorrent(magnetURI);
        clearInterval(intervalId);
      }
      if (download.done) {
        console.log("video sent");
        onDone(sourceChatId, download);
        this.removeTorrent(magnetURI);
        clearInterval(intervalId);
      }
    }, 500);
  }

  public getTorrent(torrentId: string): webtorrentDownload | undefined {
    return this.torrentClient.torrents.find((t: webtorrentDownload) => t.infoHash === torrentId);
  }

  private async addTorrent(magnet: string): Promise<webtorrentDownload> {
    return new Promise((resolve, reject) => {
      try {
        this.torrentClient.add(
          magnet,
          {
            path: process.env.DOWNLOAD_PATH ?? "./downloads",
            destroyStoreOnDestroy: true,
          },
          (torrent: webtorrentDownload) => {
            this.downloadQueue.push({
              magnetURI: torrent.magnetURI,
              created: dayjs().toDate(),
            });
            torrent.on("error", (e: Error) => reject(e));

            resolve(torrent);
          }
        );
      } catch (e) {
        reject(e);
      }
    });
  }

  private removeTorrent(magnet: string) {
    const torrent = this.torrentClient.torrents.find((t: webtorrentDownload) => t.magnetURI === magnet);
    if (!torrent) throw new Error("No se encontro la descarga");
    torrent.destroy();
    this.downloadQueue = this.downloadQueue.filter((d) => d.magnetURI !== magnet);
  }
}
