/**
 * Game server — walking skeleton stage.
 *
 * What it does right now:
 *   1. HTTP server (Express) and WebSocket server (ws) share ONE port, as
 *      decided in docs/architecture.md ("один процесс, один адрес").
 *   2. Every connected client is logged (connect / disconnect).
 *   3. Incoming 'ping' messages are answered with 'pong' + server time.
 *
 * What it deliberately does NOT do yet: map, movement, battles, database,
 * authorization. See docs/architecture.md for the real protocol.
 */

import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import express from 'express';
import { WebSocketServer } from 'ws';

import type { ClientMessage, PongMessage } from '@de-jija/shared';

import { initBattleRules, DEFAULT_BATTLE_RULES_PATH } from './battle/battleRules';
import { createBattleDebugRouter } from './debug/battleDebugRoutes';
import { DEFAULT_COMBAT_RULES_PATH, initCombatRules } from './combat/combatRules';
import { DEFAULT_SKILLS_PATH, initSkills } from './combat/skills';
import { createDebugRouter } from './debug/debugRoutes';

const currentDir = path.dirname(fileURLToPath(import.meta.url));

/** 127.0.0.1 by default: not exposed to the local network, no firewall prompt.
 *  Set HOST=0.0.0.0 to let other devices (e.g. a phone) connect. */
const HOST = process.env.HOST ?? '127.0.0.1';
const PORT = Number(process.env.PORT ?? 3000);

/** Built client (client/dist). Served only if it exists, so the whole thing can
 *  later be tested from a single address (see docs/architecture.md). */
const CLIENT_DIST = path.resolve(currentDir, '../../client/dist');

/**
 * Balance rules and skill data are loaded exactly once, here, before anything starts
 * listening. A broken config file must stop the server with a readable message instead
 * of letting it run with half-loaded data (docs/decisions.md, 012).
 */
try {
  const rules = initCombatRules();

  console.log(`[config] combat rules loaded from ${DEFAULT_COMBAT_RULES_PATH}`);
  console.log(`[config] ${JSON.stringify(rules)}`);

  const skills = initSkills();

  console.log(`[config] ${skills.skills.length} skills loaded from ${DEFAULT_SKILLS_PATH}`);

  // The battlefield size is a SEPARATE config from the damage formula
  // (docs/battle.md, 019), but it is validated exactly as strictly.
  const battleRules = initBattleRules();

  console.log(`[config] battle rules loaded from ${DEFAULT_BATTLE_RULES_PATH}`);
  console.log(`[config] ${JSON.stringify(battleRules)}`);
} catch (error) {
  console.error('[config] НЕ УДАЛОСЬ ЗАГРУЗИТЬ КОНФИГ — сервер не стартует:');
  console.error(`[config] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

const app = express();

if (existsSync(CLIENT_DIST)) {
  app.use(express.static(CLIENT_DIST));
  console.log(`[http] serving built client from ${CLIENT_DIST}`);
} else {
  console.log('[http] client/dist not found — run "npm run dev:client" for the dev client');
}

// DEV-TOOL: the combat sandbox (server/debug/combat-sandbox.html + POST /debug/attack)
// and the battle API (/debug/battles/...). It is a developer tool: separate routes,
// no player authorization, no game state, and it never touches the game protocol
// in /shared. Not mounted in production.
// // DEV-TOOL: not mounted in production (docs/conventions.md)
if (process.env.NODE_ENV === 'production') {
  console.log('[debug] combat sandbox is disabled (NODE_ENV=production)');
} else {
  app.use('/debug', createDebugRouter());
  app.use('/debug', createBattleDebugRouter());
  console.log(`[debug] combat sandbox: http://${HOST}:${PORT}/debug/combat-sandbox`);
  console.log(`[debug] battle API:     http://${HOST}:${PORT}/debug/battles`);
}

const httpServer = createServer(app);
const webSocketServer = new WebSocketServer({ server: httpServer });

/** Simple incrementing id, used only to make the console log readable. */
let nextClientId = 1;

webSocketServer.on('connection', (socket, request) => {
  const clientId = nextClientId++;

  console.log(
    `[ws] client #${clientId} connected from ${request.socket.remoteAddress} (online: ${webSocketServer.clients.size})`,
  );

  socket.on('message', (raw) => {
    const message = parseClientMessage(raw.toString());

    if (!message) {
      console.warn(`[ws] client #${clientId} sent something that is not a valid message`);
      return;
    }

    if (message.type === 'ping') {
      const reply: PongMessage = {
        type: 'pong',
        timestamp: message.timestamp, // echo, so the client can measure latency
        serverTime: Date.now(),
      };

      socket.send(JSON.stringify(reply));
      console.log(`[ws] client #${clientId} ping -> pong`);
    }
  });

  socket.on('close', () => {
    console.log(`[ws] client #${clientId} disconnected (online: ${webSocketServer.clients.size})`);
  });

  socket.on('error', (error) => {
    console.error(`[ws] client #${clientId} socket error: ${error.message}`);
  });
});

/** Turns a raw WebSocket payload into a message we can work with, or null. */
function parseClientMessage(raw: string): ClientMessage | null {
  try {
    const parsed: unknown = JSON.parse(raw);

    if (typeof parsed === 'object' && parsed !== null && 'type' in parsed) {
      return parsed as ClientMessage;
    }

    return null;
  } catch {
    return null;
  }
}

httpServer.listen(PORT, HOST, () => {
  console.log(`[http] listening on http://${HOST}:${PORT} (websocket: ws://${HOST}:${PORT})`);
});

// Ctrl+C should stop the server cleanly, so the port is freed immediately in dev.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    console.log(`[server] ${signal} received, shutting down`);
    webSocketServer.close();
    httpServer.close(() => process.exit(0));
  });
}
