#include "ws.h"

#include <arpa/inet.h>
#include <errno.h>
#include <fcntl.h>
#include <netinet/in.h>
#include <poll.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>
#include <sys/socket.h>
#include <unistd.h>

#include "sha1.h"

#define BUF 65536
#define MAX_FRAME 65536

typedef struct {
    int fd;
    int open; /* handshake done */
    unsigned char in[BUF];
    int have;
} client;

struct ws_server {
    int fd;
    int port;
    client clients[WS_MAX_CLIENTS];
};

ws_server *ws_listen(int port) {
    int fd = socket(AF_INET, SOCK_STREAM, 0);
    if (fd < 0) return NULL;
    int one = 1;
    setsockopt(fd, SOL_SOCKET, SO_REUSEADDR, &one, sizeof(one));
    struct sockaddr_in a = {0};
    a.sin_family = AF_INET;
    a.sin_port = htons(port);
    a.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
    if (bind(fd, (struct sockaddr *)&a, sizeof(a)) < 0 || listen(fd, 4) < 0) {
        close(fd);
        return NULL;
    }
    fcntl(fd, F_SETFL, O_NONBLOCK);
    ws_server *s = calloc(1, sizeof(*s));
    s->fd = fd;
    s->port = port;
    for (int i = 0; i < WS_MAX_CLIENTS; i++) s->clients[i].fd = -1;
    return s;
}

static void drop(ws_server *s, int i, const ws_handlers *h) {
    client *c = &s->clients[i];
    if (c->fd < 0) return;
    int was_open = c->open;
    close(c->fd);
    c->fd = -1;
    c->open = 0;
    c->have = 0;
    if (was_open && h && h->on_close) h->on_close(h->ctx, i);
}

static int write_all(int fd, const void *data, size_t len) {
    const char *p = data;
    while (len) {
        ssize_t n = send(fd, p, len, 0);
        if (n < 0 && (errno == EAGAIN || errno == EINTR)) {
            struct pollfd w = {fd, POLLOUT, 0};
            poll(&w, 1, 50);
            continue;
        }
        if (n <= 0) return -1;
        p += n;
        len -= n;
    }
    return 0;
}

static const char *header(const char *req, const char *name, char *out, size_t size) {
    size_t nl = strlen(name);
    for (const char *line = strstr(req, "\r\n"); line; line = strstr(line + 2, "\r\n")) {
        const char *l = line + 2;
        if (!strncasecmp(l, name, nl) && l[nl] == ':') {
            const char *v = l + nl + 1;
            while (*v == ' ') v++;
            const char *end = strstr(v, "\r\n");
            size_t len = end ? (size_t)(end - v) : strlen(v);
            if (len >= size) len = size - 1;
            memcpy(out, v, len);
            out[len] = 0;
            return out;
        }
    }
    return NULL;
}

static void base64(const unsigned char *in, int len, char *out) {
    static const char t[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    int o = 0;
    for (int i = 0; i < len; i += 3) {
        int v = in[i] << 16 | (i + 1 < len ? in[i + 1] << 8 : 0) | (i + 2 < len ? in[i + 2] : 0);
        out[o++] = t[v >> 18 & 63];
        out[o++] = t[v >> 12 & 63];
        out[o++] = i + 1 < len ? t[v >> 6 & 63] : '=';
        out[o++] = i + 2 < len ? t[v & 63] : '=';
    }
    out[o] = 0;
}

static int handshake(ws_server *s, client *c) {
    c->in[c->have] = 0;
    char *end = strstr((char *)c->in, "\r\n\r\n");
    if (!end) return c->have >= BUF - 1 ? -1 : 0; /* wait for the rest */
    const char *req = (const char *)c->in;
    char host[128], key[128], origin[256], upgrade[64], expect[64];
    snprintf(expect, sizeof(expect), "127.0.0.1:%d", s->port);
    const char *reason = NULL;
    if (strncmp(req, "GET ", 4)) reason = "400 Bad Request";
    else if (!header(req, "Host", host, sizeof(host)) || strcmp(host, expect)) reason = "403 Forbidden";
    else if (header(req, "Origin", origin, sizeof(origin)) &&
             (!strncasecmp(origin, "http://", 7) || !strncasecmp(origin, "https://", 8))) reason = "403 Forbidden";
    else if (!header(req, "Upgrade", upgrade, sizeof(upgrade)) || strcasecmp(upgrade, "websocket")) reason = "400 Bad Request";
    else if (!header(req, "Sec-WebSocket-Key", key, sizeof(key))) reason = "400 Bad Request";
    if (reason) {
        char resp[128];
        int n = snprintf(resp, sizeof(resp), "HTTP/1.1 %s\r\nContent-Length: 0\r\nConnection: close\r\n\r\n", reason);
        write_all(c->fd, resp, n);
        return -1;
    }
    char joined[256];
    snprintf(joined, sizeof(joined), "%s258EAFA5-E914-47DA-95CA-C5AB0DC85B11", key);
    unsigned char digest[20];
    sha1((const unsigned char *)joined, strlen(joined), digest);
    char accept[32];
    base64(digest, 20, accept);
    char resp[256];
    int n = snprintf(resp, sizeof(resp),
                     "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
                     "Sec-WebSocket-Accept: %s\r\n\r\n", accept);
    if (write_all(c->fd, resp, n) < 0) return -1;
    int used = (int)(end + 4 - (char *)c->in);
    memmove(c->in, c->in + used, c->have - used);
    c->have -= used;
    c->open = 1;
    return 1;
}

static int send_frame(int fd, int opcode, const char *data, int len) {
    unsigned char h[4];
    int hl = 2;
    h[0] = 0x80 | opcode;
    if (len < 126) h[1] = len;
    else { h[1] = 126; h[2] = len >> 8; h[3] = len & 255; hl = 4; }
    if (write_all(fd, h, hl) < 0) return -1;
    return len ? write_all(fd, data, len) : 0;
}

int ws_send(ws_server *s, int i, const char *text, int len) {
    if (i < 0 || i >= WS_MAX_CLIENTS || s->clients[i].fd < 0 || !s->clients[i].open || len > 65535) return -1;
    return send_frame(s->clients[i].fd, 1, text, len);
}

void ws_close(ws_server *s, int i) {
    if (i < 0 || i >= WS_MAX_CLIENTS || s->clients[i].fd < 0) return;
    if (s->clients[i].open) send_frame(s->clients[i].fd, 8, NULL, 0);
    close(s->clients[i].fd);
    s->clients[i].fd = -1;
    s->clients[i].open = 0;
    s->clients[i].have = 0;
}

/* Parses as many whole frames as the buffer holds. -1 means drop the client. */
static int frames(ws_server *s, int i, const ws_handlers *h) {
    client *c = &s->clients[i];
    for (;;) {
        if (c->have < 2) return 0;
        unsigned char *p = c->in;
        int fin = p[0] & 0x80, op = p[0] & 0x0f, masked = p[1] & 0x80;
        long long len = p[1] & 0x7f;
        int at = 2;
        if (len == 126) {
            if (c->have < 4) return 0;
            len = p[2] << 8 | p[3];
            at = 4;
        } else if (len == 127) {
            return -1; /* nothing the app sends is that big */
        }
        if (!masked || !fin || len > MAX_FRAME) return -1; /* clients must mask; no fragments */
        if (c->have < at + 4 + len) return 0;
        unsigned char *mask = p + at, *data = p + at + 4;
        for (long long k = 0; k < len; k++) data[k] ^= mask[k & 3];
        int whole = at + 4 + (int)len;
        if (op == 1 && h->on_message) {
            char saved = data[len];
            data[len] = 0;
            h->on_message(h->ctx, i, (char *)data, (int)len);
            if (c->fd < 0) return 0; /* closed by the handler */
            data[len] = saved;
        } else if (op == 8) {
            return -1;
        } else if (op == 9) {
            send_frame(c->fd, 10, (char *)data, (int)len);
        }
        memmove(c->in, c->in + whole, c->have - whole);
        c->have -= whole;
    }
}

void ws_poll(ws_server *s, int timeout_ms, const ws_handlers *h) {
    struct pollfd fds[WS_MAX_CLIENTS + 1];
    int n = 0;
    fds[n++] = (struct pollfd){s->fd, POLLIN, 0};
    int map[WS_MAX_CLIENTS + 1];
    for (int i = 0; i < WS_MAX_CLIENTS; i++) {
        if (s->clients[i].fd < 0) continue;
        map[n] = i;
        fds[n++] = (struct pollfd){s->clients[i].fd, POLLIN, 0};
    }
    if (poll(fds, n, timeout_ms) <= 0) return;
    if (fds[0].revents & POLLIN) {
        int fd = accept(s->fd, NULL, NULL);
        if (fd >= 0) {
            int slot = -1;
            for (int i = 0; i < WS_MAX_CLIENTS; i++) if (s->clients[i].fd < 0) { slot = i; break; }
            if (slot < 0) close(fd);
            else {
                fcntl(fd, F_SETFL, O_NONBLOCK);
                s->clients[slot].fd = fd;
                s->clients[slot].open = 0;
                s->clients[slot].have = 0;
            }
        }
    }
    for (int k = 1; k < n; k++) {
        if (!(fds[k].revents & (POLLIN | POLLHUP | POLLERR))) continue;
        int i = map[k];
        client *c = &s->clients[i];
        if (c->fd < 0) continue;
        ssize_t got = recv(c->fd, c->in + c->have, BUF - 1 - c->have, 0);
        if (got <= 0) {
            drop(s, i, h);
            continue;
        }
        c->have += (int)got;
        if (!c->open) {
            int r = handshake(s, c);
            if (r < 0) { drop(s, i, h); continue; }
            if (r == 0) continue;
            if (h->on_open) h->on_open(h->ctx, i);
            if (c->fd < 0) continue;
        }
        if (frames(s, i, h) < 0) drop(s, i, h);
    }
}

void ws_free(ws_server *s) {
    if (!s) return;
    for (int i = 0; i < WS_MAX_CLIENTS; i++) if (s->clients[i].fd >= 0) close(s->clients[i].fd);
    close(s->fd);
    free(s);
}
