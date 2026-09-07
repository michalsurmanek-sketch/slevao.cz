// Legacy compatibility entrypoint for clients that previously registered /sw.js.
// Keep one canonical implementation in /service-worker.js.
importScripts('/service-worker.js');
