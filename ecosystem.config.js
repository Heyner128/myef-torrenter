module.exports = {
  apps: [
    {
      name: "juliozorra",
      script: "npm",
      args: "run start",
      env: {
        NODE_ENV: "development",
        PUPPETEER_SKIP_CHROMIUM_DOWNLOAD: true,
        PUPPETEER_EXECUTABLE_PATH: "/usr/bin/chromium-browser",
      },
    },
  ],
};
