import TelegramBot, { SendMessageOptions } from "node-telegram-bot-api";
// @ts-ignore
import TorrentClient from "webtorrent";
import * as fs from "fs";
import TorrentScrapper, { torrentInfo } from "./TorrentScrapper";
import config1337x from "./sites/1337x";
import TorrentController, { webtorrentDownload } from "./TorrentController";

type messageWithOptions = {
  message: string;
  options?: SendMessageOptions;
};

function stringsToTelegramOptions(strings: string[]): SendMessageOptions {
  return {
    reply_markup: {
      inline_keyboard: [strings.map((str, index) => ({ text: String(index + 1), callback_data: str }))],
    },
  };
}

function cleanTorrentTitle(title: string): string {
  const withoutPeriods = title.replace(/\./g, " ");
  return withoutPeriods.length > 50 ? `${withoutPeriods.substring(0, 50)}...` : withoutPeriods;
}

export default class TorrentBot {
  private bot: TelegramBot = new TelegramBot(process.env.BOT_TOKEN ?? "", {
    polling: true,
    baseApiUrl: process.env.BOT_API_URL,
  });

  private scrapper1337x = new TorrentScrapper(config1337x);

  private intervalMessages: NodeJS.Timer[] = [];

  private searchHistory: torrentInfo[] = [];

  private informationMessages: NodeJS.Timer[] = [];

  private torrentController = new TorrentController();

  constructor() {
    this.setOnMessageAction("(.+)", "");
    this.setOnButtonAction("juliozorra piratea (.+)", this.searchTorrent.bind(this), "Buscando...");
    this.setOnButtonAction("juliozorra mué?e?strame las descargas", this.getDownloadsList.bind(this));
    this.bot.on("my_chat_member", this.onBotMembershipUpdate.bind(this));
    this.onButtonSelection(async (chatId, torrentId) => {
      if (this.searchHistory.find((torrent) => torrent.id === torrentId)) {
        await this.searchButtonHandler(chatId, torrentId);
      }
      if (this.torrentController.getTorrent(torrentId)) {
        await this.downloadInfoButtonHandler(chatId, torrentId);
      }
    });
    console.log("Bot started");
  }

  private setOnMessageAction(
    pattern: string,
    response: ((match: RegExpExecArray | null) => Promise<string>) | string,
    preResponse?: string,
    options?: ((match: RegExpExecArray | null) => Promise<SendMessageOptions | undefined>) | SendMessageOptions,
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

  private setOnButtonAction(
    pattern: string,
    finalResponse: ((match: RegExpExecArray | null) => Promise<messageWithOptions>) | messageWithOptions,
    preResponse?: string
  ) {
    const options:
      | ((match: RegExpExecArray | null) => Promise<SendMessageOptions | undefined>)
      | SendMessageOptions
      | undefined = async (match) => {
      const opts: SendMessageOptions | undefined =
        typeof finalResponse === "function"
          ? await finalResponse(match).then((val) => val.options)
          : finalResponse.options;
      return opts;
    };
    const Response: ((match: RegExpExecArray | null) => Promise<string>) | string = async (match) => {
      const msg: string =
        typeof finalResponse === "function"
          ? await finalResponse(match).then((val) => val.message)
          : finalResponse.message;
      return msg;
    };
    this.setOnMessageAction(pattern, Response, preResponse, options);
  }

  private onButtonSelection(action: (chatId: number, data: string) => void) {
    this.bot.on("callback_query", async (callbackQuery) => {
      const { data, message } = callbackQuery;
      if (data && message) {
        action(message.chat.id, data);
      }
    });
  }

  private async searchTorrent(match: RegExpExecArray | null): Promise<messageWithOptions> {
    await this.scrapper1337x.init();
    const torrents = await Promise.all(await this.scrapper1337x.search(match?.[1] ?? ""));
    await this.scrapper1337x.close();
    if (torrents.length === 0 || torrents.some((torr) => torr === undefined))
      return { message: "No se encontraron resultados o los resultados estan en categorias prohibidas" };
    torrents.forEach((torr) => {
      if (this.searchHistory.length > Number(process.env.MAX_SEARCH_HISTORY_SIZE)) this.searchHistory.shift();
      if (torr) this.searchHistory.push(torr);
    });
    return {
      message: `Selecciona el archivo que quieras descargar: ${torrents.map(
        (torr, index) => `\n\n${index + 1} - ${cleanTorrentTitle(torr ? torr.title : "")}`
      )}`,
      options: stringsToTelegramOptions(torrents.map((torr) => (torr ? torr.id : ""))),
    };
  }

  private async getDownloadsList(): Promise<messageWithOptions> {
    const downloads = this.torrentController.torrentList;
    if (downloads.length === 0) return { message: "No hay descargas en curso" };
    return {
      message: `Selecciona la descarga para ver la informacion: ${downloads.map(
        (download: webtorrentDownload) => `\n\n${download.name}`
      )}`,
      options: stringsToTelegramOptions(downloads.map((download: webtorrentDownload) => download.infoHash)),
    };
  }

  private async getDownloadInfo(infoHash: string): Promise<string> {
    const download = this.torrentController.getTorrent(infoHash);
    if (!download) throw new Error("No se encontro la descarga");
    return `Nombre: ${download.name}\nTamaño: ${download.length}\nDescargado: ${download.downloaded}\nVelocidad: ${
      download.downloadSpeed
    }\nEstado: ${download.done ? "Finalizado" : "En progreso"}
    `;
  }

  private async searchButtonHandler(chatId: number, torrentId: string) {
    try {
      const torrentInformations = this.searchHistory.find((torr) => torr?.id === torrentId);
      if (!torrentInformations) throw new Error("No se encontro el torrent");
      const torrent = await this.torrentController.downloadTorrent(torrentInformations);
      await this.bot.sendMessage(
        chatId,
        `Descargando ${torrent.name} \n\n Envia 'juliozorra muestrame las descargas' para ver las descargas en curso`
      );
      await this.torrentController.downloadWatcher(
        chatId,
        torrent.magnetURI,
        (sourceChatId: number, download: webtorrentDownload) => {
          this.sendVideo(sourceChatId, download);
        }
      );
      console.log("Torrent download started");
    } catch (e) {
      await this.bot.sendMessage(chatId, `${e}`);
      console.log(`Download error: ${e}`);
    }
  }

  private async downloadInfoButtonHandler(chatId: number, infoHash: string) {
    try {
      let downloadInfo = await this.getDownloadInfo(infoHash);
      const messageSent = await this.bot.sendMessage(chatId, downloadInfo);
      const intervalId = setInterval(async () => {
        const download = this.torrentController.getTorrent(infoHash);
        const currentDownloadInfo = await this.getDownloadInfo(infoHash);
        if (!download) {
          clearInterval(intervalId);
          this.informationMessages = this.informationMessages.filter((i) => i !== intervalId);
          return;
        }
        if (
          downloadInfo === currentDownloadInfo ||
          this.informationMessages.length > Number(process.env.MAX_DOWNLOAD_INFORMATION_MESSAGES ?? 5)
        )
          return;
        await this.bot.editMessageText(await this.getDownloadInfo(infoHash), {
          chat_id: messageSent.chat.id,
          message_id: messageSent.message_id,
        });
        downloadInfo = currentDownloadInfo;
      }, 20000);
      this.informationMessages.push(intervalId);
      console.log("Download info sent");
    } catch (e) {
      await this.bot.sendMessage(chatId, `${e}`);
      console.log(`Download info error sent: ${e}`);
    }
  }

  private sendVideo(chatId: number, torrent: webtorrentDownload) {
    torrent.files.forEach(async (file) => {
      if (file.name.endsWith(".mp4") || file.name.endsWith(".mkv") || file.name.endsWith(".avi")) {
        const buffer = fs.readFileSync(`${process.env.DOWNLOAD_PATH}/${file.path}`);
        await this.bot.sendChatAction(chatId, "upload_video");
        await this.bot.sendVideo(chatId, buffer);
      }
    });
  }

  private async onBotMembershipUpdate(chatMemberUpdate: TelegramBot.ChatMemberUpdated) {
    const newStatus = chatMemberUpdate.new_chat_member.status;
    if (newStatus === "member") {
      const message = `Hola, para buscar un torrent envia 'juliozorra piratea' y el nombre de la busqueda, motores disponibles: 1337x`;
      const interval = Number(process.env?.WELCOME_MESSAGE_INTERVAL_MINS);
      // first time
      await this.bot.sendMessage(chatMemberUpdate.chat.id, message);
      // interval
      setInterval(async () => {
        await this.bot.sendMessage(chatMemberUpdate.chat.id, message);
      }, (!Number.isNaN(interval) ? interval : 60) * 60 * 1000);
    }
  }
}
