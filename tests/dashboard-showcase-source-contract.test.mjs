import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL('../' + path, import.meta.url), 'utf8');

test('Start pokazuje pełną drogę klienta i najważniejsze obszary ServiceOS', async () => {
  const source = await read('src/pages/Dashboard.tsx');

  for (const phrase of [
    'Od przyjęcia klienta do odbioru urządzenia.',
    'Tak wygląda pełna wizyta klienta',
    'Klient przychodzi do punktu',
    'Powstaje zlecenie i karta serwisowa',
    'Urządzenie trafia do właściwej osoby',
    'Serwis prowadzi naprawę krok po kroku',
    'Koszty i dokumenty są przy zleceniu',
    'Klient dostaje informacje',
    'Telefon wraca do punktu i czeka na odbiór',
    'Zlecenie kończy się pełną historią',
    'SPOTKANIA I SZKOLENIA',
    'ROLE W ZESPOLE',
    'DLA SZEFA'
  ]) {
    assert.ok(source.includes(phrase), 'brakuje treści prezentacyjnej: ' + phrase);
  }
});

test('Start zachowuje prawdziwe moduły i akcje aplikacji', async () => {
  const source = await read('src/pages/Dashboard.tsx');

  assert.match(source, /<MeetingsCard role={role}/);
  assert.match(source, /onNavigate\('service'\)/);
  assert.match(source, /onNavigate\('customers'\)/);
  assert.match(source, /onNavigate\('earnings'\)/);
  assert.match(source, /onNavigate\('administration'\)/);
  assert.match(source, /onOpenHelp/);
  assert.match(source, /window\.lockOn\.data\.getDashboard/);
  assert.match(source, /window\.lockOn\.data\.getWeather/);
});

test('Układ mobilny zmienia panel boczny w dolną nawigację', async () => {
  const css = await read('src/styles.css');

  assert.ok(css.includes('/* Telefon: nawigacja przechodzi w dolny pasek'));
  assert.match(css, /@media\(max-width:720px\)[\s\S]*\.sidebar\{[\s\S]*position:fixed/);
  assert.match(css, /\.nav-list\{[\s\S]*overflow-x:auto/);
  assert.match(css, /\.dashboard-showcase\{padding:16px 12px 92px\}/);
  assert.match(css, /\.help-chat-panel\{[\s\S]*bottom:calc\(76px \+ env\(safe-area-inset-bottom\)\)/);
});
