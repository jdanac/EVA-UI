/* =========================================================
   NGE WARNING SCREEN STUDY: BEHAVIOR
   Vanilla JS. CSS owns the look and the blinks; this file only:
     - counts down from 30 seconds and writes the readout,
     - steps the status words as the count falls (data-pending flags a word
       that is still changing, and CSS blinks it),
     - sets data-state on .screen (counting or sealed),
     - scales the screen to fit the window.
   Read top to bottom: setup, countdown, fit, start up.
   ========================================================= */

const stage = document.querySelector('.screen');
const timeEl = document.querySelector('#time');
const sealTag = document.querySelector('#seal-en');
const statusLine = document.querySelector('#status');

const SECONDS = 30;       // length of the countdown
const HOLD_MS = 6000;     // how long the sealed screen stays before it starts over

// Each status word, and the second at which it takes each value. A word keeps
// a value until the count reaches the next threshold, so the lists run from the
// start of the countdown down to zero.
const STEPS = {
  response: { el: document.querySelector('#response'), steps: [[30, 'STANDBY'], [20, 'ARMING'], [14, 'ENGAGED']] },
  shutter:  { el: document.querySelector('#shutter'),  steps: [[30, 'OPEN'],    [10, 'CLOSING'], [0, 'CLOSED']] },
};
const calm = window.matchMedia('(prefers-reduced-motion: reduce)');
const PENDING = ['ARMING', 'CLOSING'];   // values that are still in motion

let endAt = 0;            // performance.now() value at which the countdown hits zero
let shown = -1;           // the whole second the status words were last updated for
let frame = 0;
let restart = 0;          // pending timeout that starts the next round


/* ---------- COUNTDOWN ----------
   The end time is fixed when a round starts and every frame measures how far
   away it is, so a slow or paused tab cannot make the clock drift. */
function pad(n) {
  return String(n).padStart(2, '0');
}

// Minutes, seconds and hundredths (two digits, so 00:29:99 is one hundredth
// short of 30 seconds). Hundredths round up, so the readout reaches 00:00:00
// exactly when the time is up and never shows it early.
function format(ms) {
  const hundredths = Math.ceil(ms / 10);
  return `${pad(Math.floor(hundredths / 6000))}:${pad(Math.floor(hundredths / 100) % 60)}:${pad(hundredths % 100)}`;
}

function announce(text) {
  statusLine.textContent = text;
}

// Update any status word that changes at this whole second
function stepWords(sec) {
  if (sec === shown) return;
  shown = sec;

  for (const [key, line] of Object.entries(STEPS)) {
    const word = line.steps.filter(([at]) => sec <= at).pop()[1];
    if (line.el.textContent === word) continue;
    line.el.textContent = word;
    if (PENDING.includes(word)) line.el.dataset.pending = '';
    else delete line.el.dataset.pending;
    if (sec < SECONDS) announce(`${key === 'shutter' ? 'Outer shutter' : 'Auto response'} ${word.toLowerCase()}.`);
  }
}

function begin() {
  clearTimeout(restart);
  cancelAnimationFrame(frame);
  stage.dataset.state = 'counting';
  sealTag.textContent = 'SEAL IN';
  announce('');
  shown = -1;
  timeEl.textContent = format(SECONDS * 1000);
  stepWords(SECONDS);
  endAt = performance.now() + SECONDS * 1000;
  frame = requestAnimationFrame(tick);
}

function tick(now) {
  // The first frame's timestamp can be a hair older than the moment the round
  // started, which would read as more than the full time, so clamp to the length
  const ms = Math.min(SECONDS * 1000, Math.max(0, endAt - now));
  // Under reduced motion the hundredths would be a blur of changing digits, so
  // the readout moves once a second instead
  timeEl.textContent = format(calm.matches ? Math.ceil(ms / 1000) * 1000 : ms);
  stepWords(Math.ceil(ms / 1000));
  if (ms > 0) {
    frame = requestAnimationFrame(tick);
  } else {
    stage.dataset.state = 'sealed';
    sealTag.textContent = 'SEALED';
    announce('Bulkhead sealed.');
    restart = setTimeout(begin, HOLD_MS);
  }
}


/* ---------- FIT TO THE WINDOW ----------
   Publishes the scale that fits the 1280x720 stage; style.css applies it with
   zoom. It measures clientWidth/clientHeight, not innerWidth, which a mobile
   browser can inflate to the stage width. The gutter leaves room for the
   registration marks on the body. */
const root = document.documentElement;

function fit() {
  const gutter = root.clientWidth >= 900 ? 48 : 12;
  const scale = Math.min((root.clientWidth - gutter * 2) / 1280, (root.clientHeight - gutter * 2) / 720);
  root.style.setProperty('--scale', scale.toFixed(4));
}

window.addEventListener('resize', fit);
fit();


/* ---------- START UP ---------- */
begin();
