import pino from "pino";

const logger = pino.default({
  transport: {
    targets: [
      {
        target: "pino-pretty",
        options: {
          colorize: true,
        },
        level: "info",
      },
      {
        target: "pino/file",
        level: "error",
        options: {
          destination: "./logs/error.log",
          mkdir: true,
        },
      },
      {
        target: "pino/file",
        level: "info",
        options: {
          destination: "./logs/info.log",
          mkdir: true,
        },
      },
    ],
  },
});
export default logger;
