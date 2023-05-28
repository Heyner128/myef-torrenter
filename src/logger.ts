import winston from "winston";

const logger = winston.createLogger({
  level: "info",
  format: winston.format.json(),
  defaultMeta: { service: "torrent-bot" },
  exitOnError: false,
  transports: [
    new winston.transports.File({
      filename: "./logs/error.log",
      level: "error",
      handleExceptions: true,
    }),
    new winston.transports.File({
      filename: "./logs/combined.log",
      handleExceptions: true,
    }),
    new winston.transports.Console({
      format: winston.format.combine(winston.format.colorize(), winston.format.simple()),
      handleExceptions: true,
    }),
  ],
});

export default logger;
