module.exports = {
  apps: [
    {
      name:
        process.env.PM2_APP_NAME ||
        "zhe-ai",
      cwd: __dirname,
      script:
        "server/dist/index.js",
      interpreter: "node",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      watch: false,
      restart_delay: 3000,
      exp_backoff_restart_delay: 1000,
      max_memory_restart:
        process.env.PM2_MAX_MEMORY ||
        "1G",
      kill_timeout: 20000,
      listen_timeout: 15000,
      env: {
        NODE_ENV: "production"
      }
    }
  ]
};
