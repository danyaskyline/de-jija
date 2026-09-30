/**
 * Client — walking skeleton stage.
 *
 * Two independent things happen here on purpose:
 *   1. PixiJS starts and shows an empty black canvas (proof the renderer works).
 *   2. A plain WebSocket sends 'ping' every 2 seconds (NOT via PixiJS) and logs
 *      the measured round-trip latency for every 'pong' the server answers.
 *
 * No game logic: no map, no movement, no sprites, no battles.
 */

import { Application } from 'pixi.js';

import type { PingMessage, ServerMessage } from '@de-jija/shared';

/** How often the client sends 'ping', in milliseconds. */
const PING_INTERVAL_MS = 2000;

/** How long to wait before reconnecting after a dropped connection, in ms. */
const RECONNECT_DELAY_MS = 2000;

/** Where the game server listens. Override with VITE_WS_URL in a .env file. */
const WS_URL = import.meta.env.VITE_WS_URL ?? 'ws://localhost:3000';

/**
 * Starts PixiJS and appends its canvas to the page.
 * Nothing is drawn — an empty black screen is exactly what we expect here.
 */
async function startPixi(): Promise<void> {
  const app = new Application();

  await app.init({
    background: '#000000',
    resizeTo: window,
    antialias: false,
  });

  document.body.appendChild(app.canvas);

  console.log(`[pixi] renderer ready, canvas ${app.canvas.width}x${app.canvas.height}`);
}

/**
 * Connects to the server, then sends 'ping' every PING_INTERVAL_MS.
 * Each 'pong' is logged together with the latency measured on the client:
 * latency = now - timestamp that we put into the ping.
 */
function startPingLoop(): void {
  let socket: WebSocket | null = null;

  const connect = (): void => {
    socket = new WebSocket(WS_URL);

    socket.addEventListener('open', () => {
      console.log(`[ws] connected to ${WS_URL}`);
    });

    socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data)) as ServerMessage;

      if (message.type === 'pong') {
        const latencyMs = Date.now() - message.timestamp;
        console.log(
          `[ws] pong received — latency ~${latencyMs} ms (server time: ${message.serverTime})`,
        );
      }
    });

    socket.addEventListener('close', () => {
      console.warn(`[ws] disconnected — retrying in ${RECONNECT_DELAY_MS} ms (is the server running?)`);
      setTimeout(connect, RECONNECT_DELAY_MS);
    });

    socket.addEventListener('error', () => {
      console.error('[ws] connection error — start the server with "npm run dev:server"');
    });
  };

  // The timer lives outside connect(), so it keeps working across reconnects.
  setInterval(() => {
    if (socket?.readyState !== WebSocket.OPEN) {
      return;
    }

    const ping: PingMessage = { type: 'ping', timestamp: Date.now() };
    socket.send(JSON.stringify(ping));
  }, PING_INTERVAL_MS);

  connect();
}

void startPixi();
startPingLoop();
