import { MAILBOX_WS_URL } from "./config";
import type { ServerEvent, SocketStatus } from "./types";

export interface ChatSocketCallbacks {
  onEvent(event: ServerEvent): void;
  onStatus(status: SocketStatus): void;
}

export function connectChatSocket(
  accessToken: string,
  callbacks: ChatSocketCallbacks,
): () => void {
  let stopped = false;
  let socket: WebSocket | null = null;
  let reconnectTimer: number | null = null;
  let attempt = 0;

  const connect = () => {
    if (stopped) {
      return;
    }

    callbacks.onStatus("connecting");
    const url = new URL("/v1/ws", MAILBOX_WS_URL);
    url.searchParams.set("access_token", accessToken);
    socket = new WebSocket(url);

    socket.onopen = () => {
      attempt = 0;
      callbacks.onStatus("online");
    };

    socket.onmessage = (message) => {
      try {
        callbacks.onEvent(JSON.parse(String(message.data)) as ServerEvent);
      } catch (error) {
        console.error("Ignoring malformed chat websocket event", error);
      }
    };

    socket.onerror = () => {
      socket?.close();
    };

    socket.onclose = () => {
      socket = null;
      if (stopped) {
        callbacks.onStatus("offline");
        return;
      }

      callbacks.onStatus("offline");
      const delay = Math.min(10_000, 500 * 2 ** Math.min(attempt, 5));
      attempt += 1;
      reconnectTimer = window.setTimeout(connect, delay);
    };
  };

  connect();

  return () => {
    stopped = true;
    if (reconnectTimer !== null) {
      window.clearTimeout(reconnectTimer);
    }
    socket?.close();
    callbacks.onStatus("offline");
  };
}
