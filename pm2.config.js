module.exports = {
  apps: [{
    name: 'XRPLD_DEBUG_STREAM',
    script: 'index.js',
    watch: true,
    instances: 1,
    exec_mode: 'cluster',
    ignore_watch: ["node_modules", "db", ".git"],
    env: {
      PORT: 8080,
      ENDPOINT: 'http://localhost:1400/',
      DEBUG: 'stream*'
    }
  }]
}
