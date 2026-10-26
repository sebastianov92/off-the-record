/* A WebSocket server for one app on the same TV: bound to 127.0.0.1 only, the
 * subset of RFC 6455 a browser client needs (handshake, masked text frames,
 * ping/pong, close; no extensions, no fragmentation). It refuses handshakes
 * whose Host is not 127.0.0.1:PORT (DNS rebinding) or whose Origin is a web page;
 * the app's own file:// page sends "null" or "file://". */
#ifndef OTR_WS_H
#define OTR_WS_H

#define WS_MAX_CLIENTS 4

typedef struct {
    void (*on_open)(void *ctx, int client);
    void (*on_message)(void *ctx, int client, const char *text, int len);
    void (*on_close)(void *ctx, int client);
    void *ctx;
} ws_handlers;

typedef struct ws_server ws_server;

ws_server *ws_listen(int port);
/* Waits up to timeout_ms for network events and dispatches them. */
void ws_poll(ws_server *s, int timeout_ms, const ws_handlers *h);
int ws_send(ws_server *s, int client, const char *text, int len);
void ws_close(ws_server *s, int client);
void ws_free(ws_server *s);

#endif
