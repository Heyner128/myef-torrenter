import TelegramBot from "node-telegram-bot-api";
import type { Message, SendMessageOptions, Update } from "node-telegram-bot-api";
import type { FastifyReply, FastifyRequest } from "fastify";
import logger from "./logger.js";
import TorrentScrapper from "./TorrentScrapper.js";
import type { TorrentInfo, TorrentScrapperOptions } from "./TorrentScrapper.js";
import config1337x from "./sites/1337x.js";
import TorrentController from "./TorrentController.js";
import type { WebtorrentDownload, TorrentControllerOptions } from "./TorrentController.js";
import fastify from "./webhook.js";

type MessageWithOptions = {
  message: string;
  options?: SendMessageOptions;
};

export type TorrentBotOptions = {
  max_search_history_size?: number;
  welcome_message_interval_mins?: number;
  max_download_information_messages?: number;
  download_info_messages_interval_secs?: number;
};

type Options = TorrentScrapperOptions & TorrentControllerOptions & TorrentBotOptions;

function stringsToTelegramOptions(strings: string[]): SendMessageOptions {
  return {
    reply_markup: {
      inline_keyboard: [
        strings.filter((str) => str !== "").map((str, index) => ({ text: String(index + 1), callback_data: str })),
      ],
    },
  };
}

function cleanTorrentTitle(title: string): string {
  const withoutPeriods = title.replace(/\./g, " ");
  return withoutPeriods.length > 50 ? `${withoutPeriods.substring(0, 50)}...` : withoutPeriods;
}

export default class TorrentBot {
  private bot: TelegramBot;

  private scrappers: TorrentScrapper[];

  private searchHistory: TorrentInfo[] = [];

  private informationMessages: NodeJS.Timer[] = [];

  private torrentController: TorrentController;

  private isSearching = false;

  constructor(private options?: Options) {
    this.torrentController = new TorrentController({
      download_speed_limit_kbs: this?.options?.download_speed_limit_kbs,
      upload_speed_limit_kbs: this?.options?.upload_speed_limit_kbs,
      max_queue_size: this?.options?.max_queue_size,
      max_download_size_kbs: this?.options?.max_download_size_kbs,
      min_ratio: this?.options?.min_ratio,
      min_seeds: this?.options?.min_seeds,
      max_download_age_mins: this?.options?.max_download_age_mins,
      download_folder: this?.options?.download_folder,
      remove_delay_secs: this?.options?.remove_delay_secs,
    });

    this.scrappers = [
      new TorrentScrapper("1337x", config1337x, {
        search_limit: this?.options?.search_limit,
      }),
    ];

    this.bot = new TelegramBot(process.env.BOT_TOKEN ?? "", {
      baseApiUrl: process.env.BOT_API_URL,
    });
  }

  public addEvents() {
    this.setOnMessageAction("(.+)", "");
    this.setOnMessageAction(
      "juliozorra comandos",
      `Comandos disponibles:\n\n - juliozorra piratea <nombre de la película o serie>\n\n - juliozorra muéstrame las descargas`
    );
    this.setOnMessageAction("juliozorra piratea (.+)", this.searchTorrent.bind(this));
    this.setOnMessageAction("juliozorra mué?e?strame las descargas", this.getDownloadsList.bind(this));
    this.bot.on("my_chat_member", this.onBotMembershipUpdate.bind(this));
    this.bot.on("error", (err) => logger.error(err));
    this.onCallbackQuery();
  }

  public async listen() {
    const environment = process.env.NODE_ENV ?? "development";

    if (environment === "development") {
      this.bot.on("polling_error", (error) => logger.error(error));
      await this.bot.startPolling();
    } else {
      this.bot.on("webhook_error", (error) => logger.error(error));
      if (!process.env.WEBHOOK_URL) throw new Error("Webhook url undefined");
      await this.bot.setWebHook(`${process.env.WEBHOOK_URL}/webhook${process.env.BOT_TOKEN}`);
      fastify.post<{
        Body: Update;
      }>(`/webhook${process.env.BOT_TOKEN}`, async (request: FastifyRequest, reply: FastifyReply) => {
        this.bot.processUpdate(request.body as Update);
        reply.send(200);
      });
      await fastify.listen({ port: Number(process.env.PORT) ?? 3000 });
    }
  }

  private setOnMessageAction(
    pattern: string,
    response: ((match: RegExpExecArray | null, msg?: Message) => Promise<MessageWithOptions | string>) | string
  ) {
    this.bot.onText(new RegExp(pattern, "i"), async (msg, match) => {
      if (msg.chat.type === "group" || msg.chat.type === "supergroup") {
        if (response === "") return;
        logger.info(`Group message "${msg.text}" received from ${msg.chat.title}`);
        const message = typeof response === "function" ? await response(match, msg) : response;
        await this.bot.sendMessage(
          msg.chat.id,
          typeof message === "string" ? message : message.message,
          typeof message === "string" ? undefined : message?.options
        );
        logger.info(`Message "${typeof message === "string" ? message : message.message}" sent to ${msg.chat.title}`);
      } else {
        if (response !== "") return;
        await this.bot.sendMessage(
          msg.chat.id,
          `
            No estoy diseñado para funcionar en chats privados, habla con mi creador para que me agregue a un grupo.
          `
        );
        logger.info(`Private message "${msg.text}" received, answered with error`);
      }
    });
  }

  private onCallbackQuery() {
    this.bot.on("callback_query", async (callbackQuery) => {
      const { data: torrentId, message } = callbackQuery;
      if (torrentId && message) {
        if (this.searchHistory.find((torrent) => torrent.id === torrentId)) {
          await this.searchButtonHandler(message.chat.id, torrentId);
        }
        if (this.torrentController.getTorrent(torrentId)) {
          await this.downloadInfoButtonHandler(message.chat.id, torrentId);
        }
      }
    });
  }

  private async searchTorrent(match: RegExpExecArray | null, msg?: Message): Promise<MessageWithOptions> {
    try {
      if (this.isSearching) return { message: "Ya estoy buscando algo, intenta mas tarde" };

      logger.info(`Bot is searching for "${match?.[1]}" in all sites`);

      if (msg) await this.bot.sendMessage(msg.chat.id, `Buscando ${match?.[1]} en todos los sitios...`);

      this.isSearching = true;
      const torrents: (TorrentInfo | null)[] = (
        await Promise.all(
          this.scrappers.map(async (scrapper) => {
            await scrapper.init();
            const results = await scrapper.search(match?.[1] ?? "");
            return Promise.all(results);
          })
        )
      )
        .flat()
        .filter((torr) => torr !== null);

      await Promise.all(this.scrappers.map((scrapper) => scrapper.close()));

      this.isSearching = false;

      if (torrents.length === 0 || torrents.every((torr) => torr === undefined))
        return { message: "No se encontraron resultados dentro de las categorias permitidas" };

      torrents.forEach((torr) => {
        if (this.searchHistory.length > (this?.options?.max_search_history_size ?? 20)) this.searchHistory.shift();
        if (torr) this.searchHistory.push(torr);
      });
      return {
        message: `Selecciona el archivo que quieras descargar: ${torrents.reduce(
          (acc, torr, index) => `${acc}\n\n${index + 1} - ${cleanTorrentTitle(torr ? torr.title : "")}`,
          ""
        )}`,
        options: stringsToTelegramOptions(torrents.map((torr) => torr?.id ?? "")),
      };
    } catch (err) {
      logger.error(err);
      this.isSearching = false;
      return { message: `Error de busqueda` };
    }
  }

  private async getDownloadsList(): Promise<MessageWithOptions> {
    const downloads = this.torrentController.torrentList;
    if (downloads.length === 0) return { message: "No hay descargas en curso" };
    return {
      message: `Selecciona la descarga para ver la informacion: ${downloads.map(
        (download: WebtorrentDownload) => `\n\n${download.name}`
      )}`,
      options: stringsToTelegramOptions(downloads.map((download: WebtorrentDownload) => download.infoHash)),
    };
  }

  private async getDownloadInfo(infoHash: string): Promise<string> {
    const download = this.torrentController.getTorrent(infoHash);
    if (!download) throw new Error("No se encontro la descarga");
    return `Nombre: ${download.name}\nTamaño: ${Math.round(download.length / 1024)} KB\nDescargado: ${Math.round(
      download.downloaded / 1024
    )} KB\nVelocidad: ${Math.round(download.downloadSpeed / 1024)} KB/s\nEstado: ${
      download.done ? "Finalizado" : "En progreso"
    }
    `;
  }

  private async searchButtonHandler(chatId: number, torrentId: string) {
    try {
      const torrentInformations = this.searchHistory.find((torr) => torr?.id === torrentId);
      if (!torrentInformations) {
        await this.bot.sendMessage(chatId, "No se encontro el torrent");
        return;
      }
      const torrent = await this.torrentController.downloadTorrent(torrentInformations);
      await this.bot.sendMessage(
        chatId,
        `Descargando ${torrent.name} \n\nEnvia 'juliozorra muestrame las descargas' para ver las descargas en curso`
      );
      await this.torrentController.downloadWatcher(
        chatId,
        torrent.infoHash,
        (sourceChatId: number, download: WebtorrentDownload) => {
          this.sendVideo(sourceChatId, download);
        }
      );
      logger.info("Torrent download started");
    } catch (e) {
      logger.error(`Download error: ${e}`);
      await this.bot.sendMessage(chatId, `${e}`);
    }
  }

  private async downloadInfoButtonHandler(chatId: number, infoHash: string) {
    try {
      let downloadInfo = await this.getDownloadInfo(infoHash);
      const messageSent = await this.bot.sendMessage(chatId, downloadInfo);
      const intervalId = setInterval(async () => {
        const download = this.torrentController.getTorrent(infoHash);
        if (!download) {
          clearInterval(intervalId);
          this.informationMessages = this.informationMessages.filter((i) => i !== intervalId);
          return;
        }
        const currentDownloadInfo = await this.getDownloadInfo(infoHash);
        if (downloadInfo === currentDownloadInfo || !this.informationMessages.includes(intervalId)) return;
        await this.bot.editMessageText(currentDownloadInfo, {
          chat_id: messageSent.chat.id,
          message_id: messageSent.message_id,
        });
        downloadInfo = currentDownloadInfo;
      }, (this?.options?.download_info_messages_interval_secs ?? 30) * 1000);
      if (this.informationMessages.length < (this?.options?.max_download_information_messages ?? 5))
        this.informationMessages.push(intervalId);
      logger.info("Download info sent");
    } catch (e) {
      logger.error(`Download info error: ${e}`);
      await this.bot.sendMessage(chatId, `No se pudo obtener la informacion de la descarga`);
    }
  }

  private sendVideo(chatId: number, torrent: WebtorrentDownload) {
    torrent.files.forEach(async (file) => {
      if (file.name.endsWith(".mp4") || file.name.endsWith(".mkv") || file.name.endsWith(".avi")) {
        await this.bot.sendChatAction(chatId, "upload_video");
        await this.bot.sendVideo(
          chatId,
          new URL(
            `${this?.options?.download_folder ?? "downloads"}/${file.path}`,
            import.meta.url.replace("/build/", "")
          ).toString(),
          // @ts-ignore
          { caption: file.name, supports_streaming: true }
        );
      }
    });
  }

  private async onBotMembershipUpdate(chatMemberUpdate: TelegramBot.ChatMemberUpdated) {
    const newStatus = chatMemberUpdate.new_chat_member.status;
    if (newStatus === "member") {
      const message = `Hola soy juliozorra pirata, envia 'juliozorra comandos' para ver los commandos disponibles \n\n Motores disponibles: ${this.scrappers.reduce(
        (acc, scrapper) => `${acc}\n${scrapper.name}`,
        ""
      )}`;
      const interval = this?.options?.welcome_message_interval_mins ?? 120;
      // first time
      await this.bot.sendMessage(chatMemberUpdate.chat.id, message);
      // interval
      setInterval(async () => {
        await this.bot.sendMessage(chatMemberUpdate.chat.id, message);
      }, (!Number.isNaN(interval) ? interval : 60) * 60 * 1000);
    }
  }
}
