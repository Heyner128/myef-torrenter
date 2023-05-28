import winston from "winston";
import path from "path";

const logger = winston.createLogger({
  level: "info",
  format: winston.format.json(),
  defaultMeta: { service: "torrent-bot" },
  exitOnError: false,
  transports: [
    new winston.transports.File({
      filename: path.join(__dirname, "logs", "error.log"),
      level: "error",
      handleExceptions: true,
      handleRejections: true,
    }),
    new winston.transports.File({
      filename: path.join(__dirname, "logs", "combined.log"),
      handleExceptions: true,
      handleRejections: true,
    }),
    new winston.transports.Console({
      format: winston.format.combine(winston.format.colorize(), winston.format.simple()),
      handleExceptions: true,
      handleRejections: true,
    }),
  ],
});

export default logger;
