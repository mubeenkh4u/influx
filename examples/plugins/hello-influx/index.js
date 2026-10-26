window.Influx.registerPlugin({
  name: "Hello Influx",
  description: "A small example of a standalone Influx plugin.",
  authors: [],
  start() {
    console.info("[Hello Influx] Plugin started");
  },
  stop() {
    console.info("[Hello Influx] Plugin stopped");
  },
});
