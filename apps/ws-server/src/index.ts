import jwt from "jsonwebtoken";
import { WebSocket, WebSocketServer } from "ws";

import {
  PUSH_CHANNEL,
  createRedisClient,
  getEnv,
  type PushMessage
} from "@beacon/shared";

const env = getEnv();

// sockets per user
const clients = new Map<string, Set<WebSocket>>();


function track(userId: string, socket: WebSocket): void {
  const sockets = clients.get(userId) ?? new Set<WebSocket>();
  sockets.add(socket);
  clients.set(userId, sockets);
}


function untrack(userId: string, socket: WebSocket): void {
  const sockets = clients.get(userId);
  if (!sockets) return;
  sockets.delete(socket);
  if (sockets.size === 0) clients.delete(userId);
}


function authenticate(rawUrl: string | undefined): string | null {
  if (!rawUrl) return null;
  const token = new URL(rawUrl, "http://localhost").searchParams.get("token");
  if (!token) return null;

  try {
    const decoded = jwt.verify(token, env.JWT_SECRET);
    if (typeof decoded === "object" && decoded !== null && "userId" in decoded) {
      const userId = (decoded as { userId?: unknown }).userId;
      return typeof userId === "string" ? userId : null;
    }
    return null;
  } catch {
    return null;
  }
}

const wss = new WebSocketServer({ port: env.WS_PORT });

wss.on("connection", (socket, req) => {
  const userId = authenticate(req.url);
  if (!userId) {
    socket.close(1008, "unauthorized");
    return;
  }

  track(userId, socket);
  socket.on("close", () => untrack(userId, socket));
});

// fan out
const subscriber = createRedisClient("ws-subscriber");
void subscriber.subscribe(PUSH_CHANNEL);
subscriber.on("message", (_channel, payload) => {
  let message: PushMessage;
  try {
    message = JSON.parse(payload) as PushMessage;
  } catch {
    return;
  }

  const sockets = clients.get(message.userId);
  if (!sockets) return;

  const frame = JSON.stringify({ type: "notification", ...message });
  for (const socket of sockets) {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(frame);
    }
  }
});

console.log(`beacon ws-server listening on :${env.WS_PORT}`);
