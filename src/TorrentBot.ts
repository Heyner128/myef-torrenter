import TelegramBot from "node-telegram-bot-api";
import TorrentClient from "webtorrent";

export default class TorrentBot {
  private bot: TelegramBot = new TelegramBot(process.env.BOT_TOKEN ?? "", { polling: true });

  private torrent_client = new TorrentClient();

  private interval_messages_ids: NodeJS.Timer[] = [];

  constructor() {
    this.setAction("(.+)", "");
    this.setAction("/start", "test intervalic msgs", undefined, 4000);
    this.setAction("/stop", "stop intervalic msgs", () => {
      this.interval_messages_ids.forEach((intervalId) => {
        clearInterval(intervalId);
      });
    });
    console.log("Bot started");
  }

  setAction(pattern: string, response: string, action?: () => Promise<void> | void, repeatInterval?: number) {
    this.bot.onText(new RegExp(pattern, "i"), async (msg) => {
      if (msg.chat.type === "group" || msg.chat.type === "supergroup") {
        console.log(`Group message "${msg.text}" received from ${msg.chat.title}`);
        if (response === "") return;
        const doAction = async () => {
          if (action) await action();
          await this.bot.sendMessage(msg.chat.id, response);
          console.log(`Message "${response}" sent to ${msg.chat.title}`);
        };
        if (repeatInterval) {
          const intervalId = setInterval(doAction, repeatInterval);
          this.interval_messages_ids.push(intervalId);
          console.log(`Message "${response}" set to repeat every ${repeatInterval}ms`);
        } else {
          await doAction();
        }
      } else {
        await this.bot.sendMessage(
          msg.chat.id,
          `
            No estoy diseñado para funcionar en chats privados, habla con mi creador para que me agregue a un grupo.
          `
        );
        console.log(`Private message ${msg.text} received, answered with error`);
      }
    });
  }
}
