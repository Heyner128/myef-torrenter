import TelegramBot, { SendMessageOptions } from "node-telegram-bot-api";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import TorrentClient from "webtorrent";
import TorrentScrapper, { torrentInfo } from "./TorrentScrapper";
import config1337x from "./sites/1337x";

type torrentOptions = {
  message: string;
  options?: torrentInfo[];
};

function torrentsToOptions(torrents: torrentInfo[]): SendMessageOptions {
  return {
    reply_markup: {
      inline_keyboard: [torrents.map((torrent, index) => ({ text: String(index + 1), callback_data: torrent.id }))],
    },
  };
}

function cleanTorrentTitle(title: string): string {
  const withoutPeriods = title.replace(/\./g, " ");
  const truncated = withoutPeriods.length > 50 ? `${withoutPeriods.substring(0, 50)}...` : withoutPeriods;
  return truncated;
}

export default class TorrentBot {
  private bot: TelegramBot = new TelegramBot(process.env.BOT_TOKEN ?? "", { polling: true });

  private torrentClient: TorrentClient = new TorrentClient({
    downloadLimit: Number(process.env.DOWNLOAD_SPEED_LIMIT_KBS) ?? 1 * 1000,
    uploadLimit: Number(process.env.UPLOAD_SPEED_LIMIT_KBS) ?? 0.1 * 1000,
    path: process.env.DOWNLOAD_PATH ?? "./downloads",
  });

  private scrapper1337x = new TorrentScrapper(config1337x);

  private intervalMessages: NodeJS.Timer[] = [];

  private searchHistory: torrentInfo[] = [];

  constructor() {
    this.setOnMessageAction("(.+)", "");
    this.setOnButtonAction("juliozorra piratea (.+)", "Buscando...", this.searchTorrent.bind(this));
    console.log("Bot started");
  }

  setOnMessageAction(
    pattern: string,
    response: ((match: RegExpExecArray | null) => Promise<string>) | string,
    preResponse?: string,
    options?: ((match: RegExpExecArray | null) => Promise<SendMessageOptions>) | SendMessageOptions,
    repeatInterval?: number
  ) {
    this.bot.onText(new RegExp(pattern, "i"), async (msg, match) => {
      if (msg.chat.type === "group" || msg.chat.type === "supergroup") {
        if (response === "") return;
        console.log(`Group message "${msg.text}" received from ${msg.chat.title}`);
        if (preResponse) {
          await this.bot.sendMessage(msg.chat.id, preResponse);
          console.log(`Message ${preResponse} sent to ${msg.chat.title}`);
        }
        const finalMessage = typeof response === "function" ? await response(match) : response;
        const finalOptions = typeof options === "function" ? await options(match) : options;
        const doAction = async () => {
          await this.bot.sendMessage(msg.chat.id, finalMessage, finalOptions);
          console.log(`Message "${finalMessage}" sent to ${msg.chat.title}`);
        };
        if (repeatInterval) {
          const intervalId = setInterval(doAction, repeatInterval);
          this.intervalMessages.push(intervalId);
          console.log(`Message "${response}" set to repeat every ${repeatInterval}ms`);
        } else {
          await doAction();
        }
      } else {
        if (response !== "") return;
        await this.bot.sendMessage(
          msg.chat.id,
          `
            No estoy diseñado para funcionar en chats privados, habla con mi creador para que me agregue a un grupo.
          `
        );
        console.log(`Private message "${msg.text}" received, answered with error`);
      }
    });
  }

  setOnButtonAction(
    pattern: string,
    preResponse: string,
    firstResponse: ((match: RegExpExecArray | null) => Promise<torrentOptions>) | torrentOptions
  ) {
    const options: ((match: RegExpExecArray | null) => Promise<SendMessageOptions>) | SendMessageOptions = async (
      match
    ) => {
      const opts: SendMessageOptions =
        typeof firstResponse === "function"
          ? await firstResponse(match).then((val) => torrentsToOptions(val.options ?? []))
          : torrentsToOptions(firstResponse.options ?? []);
      return opts;
    };
    const Response: ((match: RegExpExecArray | null) => Promise<string>) | string = async (match) => {
      const msg: string =
        typeof firstResponse === "function"
          ? await firstResponse(match).then((val) => val.message)
          : firstResponse.message;
      return msg;
    };
    this.setOnMessageAction(pattern, Response, preResponse, options);
  }

  onButtonSelection(action: (chatId: number, torrentId: string) => void) {
    this.bot.on("callback_query", async (callbackQuery) => {
      const { data, message } = callbackQuery;
      if (data && message) {
        action(message.chat.id, data);
      }
    });
  }

  private async searchTorrent(match: RegExpExecArray | null): Promise<torrentOptions> {
    await this.scrapper1337x.init();
    const torrents = await Promise.all(await this.scrapper1337x.search(match?.[1] ?? ""));
    await this.scrapper1337x.close();
    if (torrents.length === 0) return { message: "No se encontraron resultados" };
    torrents.forEach((torr) => this.searchHistory.push(torr));
    return {
      message: `Selecciona el torrent que quieras descargar: ${torrents.map(
        (torr, index) => `\n\n${index + 1} - ${cleanTorrentTitle(torr.title)}`
      )}`,
      options: torrents,
    };
  }

  private downloadTorrent(torrentId: string): void {
    const torrent = this.searchHistory.find((torr) => torr.id === torrentId);
    if (!torrent?.magnet) throw new Error("El enlace al torrent no es valido");
    if (this.torrentClient.torrents.length === Number(process.env.MAX_QUEUE_SIZE))
      throw new Error("La cola de descargas esta llena");
    if (torrent.size_kbs > Number(process.env.MAX_TORRENT_SIZE_KBS)) throw new Error("El archivo es muy grande");
    if (torrent.seeds / torrent.leeches < Number(process.env.MIN_SEEDS_RATIO))
      throw new Error("La descarga no tiene suficiente calidad");
    this.torrentClient.add(torrent.magnet);
  }
}
