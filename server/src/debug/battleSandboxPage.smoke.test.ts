/**
 * Smoke test of the DEV-TOOL battle sandbox PAGE (server/debug/battle-sandbox.html).
 *
 * The unit tests of battleDebugRoutes.ts cover the API contract, but nothing covered
 * the page itself: a one-character mistake in the browser JS left the page completely
 * blank with a red line nobody could explain. So this test opens the real HTML file in
 * jsdom against a real server (real configs, real HTTP) and only checks the INITIAL
 * LOADING:
 *   - no red "Не удалось загрузить песочницу" line;
 *   - no uncaught JS errors;
 *   - the SVG field has fieldWidth × fieldHeight hexes (from config/battle-rules.json);
 *   - both side panels are built.
 *
 * WHAT IS NOT COVERED (honest list): clicks, drags, pointer events, attacks and rounds —
 * jsdom has no layout and no pointer, so only the loading phase is exercised. A visual
 * defect in the CSS or in hex drawing would not be caught here either.
 */

import { readFileSync } from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import express from 'express';
import { JSDOM, VirtualConsole, type DOMWindow } from 'jsdom';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initBattleRules } from '../battle/battleRules';
import { initCombatRules } from '../combat/combatRules';
import { initSkills } from '../combat/skills';
import { createBattleDebugRouter } from './battleDebugRoutes';
import { createDebugRouter } from './debugRoutes';

const PAGE_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../debug/battle-sandbox.html',
);

/** The red line the page shows instead of the sandbox when init() throws. */
const LOAD_FAILURE_TEXT = 'Не удалось загрузить песочницу';

let server: Server;
let origin = '';
let pageHtml = '';

beforeAll(async () => {
  // The very same config loading as index.ts does, with the real files from /config.
  initCombatRules();
  initSkills();
  const battleRules = initBattleRules();

  // Both debug routers, exactly as index.ts mounts them.
  const app = express();
  app.use('/debug', createDebugRouter());
  app.use('/debug', createBattleDebugRouter());

  server = await new Promise<Server>((resolve) => {
    const started = app.listen(0, '127.0.0.1', () => resolve(started));
  });

  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  pageHtml = readFileSync(PAGE_PATH, 'utf8');

  // The hex count the page must draw, read from the config file itself — so the test
  // never hardcodes 15 × 11 and cannot drift away from config/battle-rules.json.
  expectedField = { width: battleRules.fieldWidth, height: battleRules.fieldHeight };
});

let expectedField = { width: 0, height: 0 };

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

/** Waits until the page is done: init() either finished or wrote the red line. */
async function waitForInit(window: DOMWindow, timeoutMs = 5000): Promise<void> {
  const status = window.document.getElementById('status');
  const started = Date.now();

  while (Date.now() - started < timeoutMs) {
    const text = status?.textContent ?? '';

    if (text.includes(LOAD_FAILURE_TEXT) || (text !== '' && text !== 'Загрузка…')) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

/** Loads the page in jsdom and collects every error it throws. */
function openPage(): { window: DOMWindow; errors: string[] } {
  const errors: string[] = [];
  const virtualConsole = new VirtualConsole();

  virtualConsole.on('jsdomError', (error: Error) => errors.push(error.message));
  virtualConsole.on('error', (message: unknown) => errors.push(String(message)));

  const dom = new JSDOM(pageHtml, {
    url: `${origin}/debug/battle-sandbox`,
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    virtualConsole,
    // The inline script of the page runs while the document is being parsed, so fetch
    // has to exist BEFORE that: beforeParse is the only hook early enough.
    beforeParse(window) {
      // jsdom has no fetch. Hand the page the real one, resolved against the server
      // origin, so the relative paths of the page ('/debug/units') hit our test server.
      window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input), origin).toString();
        return fetch(url, init);
      }) as typeof window.fetch;

      window.addEventListener('error', (event: Event) => {
        errors.push(String((event as ErrorEvent).message ?? 'unknown error'));
      });
    },
  });

  const window = dom.window;

  return { window, errors };
}

describe('страница /debug/battle-sandbox загружается', () => {
  it('показывает поле и обе панели сторон, а не красную строку ошибки', async () => {
    const { window, errors } = openPage();

    await waitForInit(window);

    const document = window.document;
    const statusText = document.getElementById('status')?.textContent ?? '';

    // The full status text goes into the assertion message, so a failure names the stage.
    expect(
      statusText.includes(LOAD_FAILURE_TEXT),
      `страница показала ошибку загрузки: ${statusText}`,
    ).toBe(false);
    expect(errors, 'страница бросила необработанные ошибки').toEqual([]);

    // The hex field: one polygon per cell, straight from the battle rules config.
    const hexes = document.querySelectorAll('#field-svg .hex-cell');
    const expectedHexes = expectedField.width * expectedField.height;

    expect(expectedHexes, 'не удалось прочитать размеры поля из конфига').toBeGreaterThan(0);
    expect(hexes.length, 'поле нарисовано не полностью').toBe(expectedHexes);

    // Both side panels exist and are filled: the preset pickers are in them.
    for (const side of ['left', 'right']) {
      const column = document.getElementById(`col-${side}`);

      expect(column, `панель ${side} не найдена`).not.toBeNull();
      expect(
        column?.querySelector(`#preset-${side}`),
        `в панели ${side} нет списка шаблонов юнитов`,
      ).not.toBeNull();
    }

    window.close();
  }, 20000);
});

describe('панель очереди ходов показывает то, что прислал сервер', () => {
  it('рисует два сегмента, индикатор и кнопки хода', async () => {
    const { window, errors } = openPage();

    await waitForInit(window);

    const document = window.document;
    const turns = document.getElementById('turns');

    expect(turns, 'панель очереди не найдена').not.toBeNull();

    // The panel must have real content, not the "no queue yet" placeholder:
    // the page creates a battle during init, so the queue exists.
    const text = turns?.textContent ?? '';

    expect(text).toContain('Приоритет:');
    expect(text).toContain('Сегмент ходов');
    expect(text).toContain('Ждут в этом раунде');

    // The indicator must name both the current side and where it goes next.
    expect(text).toMatch(/Приоритет: (левая|правая) → после следующей ничьей: (левая|правая)/);

    // Two buttons for the current unit, wired to the new routes.
    expect(document.getElementById('btn-end-turn')).not.toBeNull();
    expect(document.getElementById('btn-wait')).not.toBeNull();

    expect(errors, 'ошибки при отрисовке панели очереди').toEqual([]);

    window.close();
  }, 20000);
});

describe('журнал страницы показывает новые события очереди ходов', () => {
  it('рисует PriorityRolled / PriorityPassed / UnitWaited / TurnStarted и не падает', async () => {
    const { window, errors } = openPage();

    await waitForInit(window);

    const document = window.document;

    expect(
      document.getElementById('status')?.textContent ?? '',
      `страница не загрузилась: ${document.getElementById('status')?.textContent ?? ''}`,
    ).not.toContain(LOAD_FAILURE_TEXT);

    const renderOne = (event: Record<string, unknown>): string => {
      const line = document.createElement('div');

      // The very function of the page that turns an event into a line.
      const source = (window as unknown as { logLineFor?: (event: unknown) => string }).logLineFor;

      if (typeof source === 'function') {
        line.textContent = source(event);
      } else {
        // The page keeps its functions inside a script scope; if a future edit
        // makes them private, we still check that no error was thrown.
        line.textContent = String(event.type);
      }

      return line.textContent ?? '';
    };

    expect(renderOne({ type: 'PriorityRolled', side: 'left' })).toContain('левая');
    expect(renderOne({ type: 'PriorityRolled', side: 'right' })).toContain('правая');
    expect(
      renderOne({
        type: 'PriorityPassed',
        round: 1,
        from: 'left',
        to: 'right',
        unitIds: ['a1', 'b1'],
      }),
    ).toContain('a1, b1');
    expect(renderOne({ type: 'UnitWaited', unitId: 'a1', round: 2 })).toContain('a1');
    expect(renderOne({ type: 'TurnStarted', round: 2, unitId: 'b1' })).toContain('b1');

    // An event type this page does not know: it must show the type, not crash.
    expect(renderOne({ type: 'SomethingNewInTheFuture' })).toBe('SomethingNewInTheFuture');

    expect(errors, 'ошибки при отрисовке событий очереди').toEqual([]);

    window.close();
  }, 20000);
});