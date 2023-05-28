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
      handleRejections: true,
    }),
    new winston.transports.File({
      filename: "./logs/combined.log",
      handleExceptions: true,
      handleRejections: true,
    }),
  ],
});

if (process.env.NODE_ENV !== "production") {
  logger.add(
    new winston.transports.Console({
      format: winston.format.combine(winston.format.colorize({ all: true }), winston.format.simple()),
    })
  );
}

export default logger;
