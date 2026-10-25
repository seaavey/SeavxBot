// PM2 process definition: pm2 start ecosystem.config.cjs
// CommonJS on purpose: package.json is "type": "module" and PM2 loads the file
// with require().
module.exports = {
  apps: [
    {
      name: "seavxbot",
      // Not `interpreter: "bun"`: PM2's bun wrapper require()s the entry file,
      // and Bun rejects that for a module with top-level await (config.ts awaits
      // the TOML import), so bun runs as the binary itself.
      script: "bun",
      args: "src/index.ts",
      interpreter: "none",
      // auth_info/, data/ and config.toml are resolved against the cwd, so the
      // process must start in the repo no matter where pm2 was invoked.
      cwd: __dirname,
      time: true,
      // The killed process leaves its WhatsApp socket registered for a moment;
      // a replacement that authenticates inside that window gets 440, which the
      // bot treats as terminal and then sits idle under pm2.
      restart_delay: 3000,
    },
  ],
};
