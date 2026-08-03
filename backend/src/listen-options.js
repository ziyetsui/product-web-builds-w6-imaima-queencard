function getListenOptions(env = {}) {
  if (env && env.server) {
    return {
      port: env.server.port,
      host: env.server.host,
    };
  }

  return {
    port: Number(env.PORT || 8787),
    host: env.MINIAPP_BACKEND_HOST || "127.0.0.1",
  };
}

module.exports = {
  getListenOptions,
};
