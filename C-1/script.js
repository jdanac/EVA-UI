/* =========================================================
   NGE ACTIVE TIME DISPLAY STUDY: BEHAVIOR
   Vanilla JS. CSS owns the look; this file only sets attributes
   (data-v on each digit, data-state on the screen, aria-current on a mode
   label) and the stylesheet reacts to them.
   Read top to bottom: setup, display, entry, countdown.
   ========================================================= */

const stage = document.querySelector('.screen');
const readout = document.querySelector('.readout');
const digits = [...readout.querySelectorAll('.digit')];   // HH MM SS then ms, left to right
const controls = document.querySelector('.controls');
const form = document.querySelector('.entry');
const input = document.querySelector('#time');
const startBtn = document.querySelector('#start');
const resetBtn = document.querySelector('#reset');
const racing = document.querySelector('.mode--racing');
const statusLine = document.querySelector('#status');

const MAX_SECONDS = 99 * 3600 + 59 * 60 + 59;
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

let state = 'idle';       // idle, running or done
let setSeconds = 0;       // the time currently entered in the field
let endAt = 0;            // performance.now() value at which the countdown hits zero
let frame = 0;            // id of the pending animation frame
let lastShown = -1;       // last value drawn, so unchanged frames cost nothing


/* ---------- DISPLAY ----------
   Turn a number of milliseconds into nine digits and set each digit's
   data-v. The display never does any other drawing. */
function render(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const seconds = totalSeconds % 60;
  const millis = Math.floor(ms) % 1000;

  const values = [
    Math.floor(hours / 10), hours % 10,
    Math.floor(minutes / 10), minutes % 10,
    Math.floor(seconds / 10), seconds % 10,
    Math.floor(millis / 100), Math.floor(millis / 10) % 10, millis % 10,
  ];
  values.forEach((value, i) => {
    if (digits[i].dataset.v !== String(value)) digits[i].dataset.v = value;
  });
}


/* ---------- ENTRY ----------
   Microwave-style: digits fill the field from the right, so typing 1, 3, 0
   gives 00:01:30. Backspace shifts them back. Letters are ignored. */
const pad2 = (n) => String(n).padStart(2, '0');

function formatSeconds(total) {
  return `${pad2(Math.floor(total / 3600))}:${pad2(Math.floor(total / 60) % 60)}:${pad2(total % 60)}`;
}

// Keep the last six digits and lay them out as HH:MM:SS, without changing their values
function formatTyped(text) {
  const d = text.replace(/\D/g, '').slice(-6).padStart(6, '0');
  return `${d.slice(0, 2)}:${d.slice(2, 4)}:${d.slice(4)}`;
}

// 00:00:99 is allowed while typing and becomes 00:01:39 once the field loses focus
function parseSeconds(text) {
  const [h, m, s] = text.split(':').map(Number);
  return Math.min(h * 3600 + m * 60 + s, MAX_SECONDS);
}

input.addEventListener('input', () => {
  input.value = formatTyped(input.value);
  setSeconds = parseSeconds(input.value);
  if (state === 'done') setState('idle');     // a new time starts a fresh round
  if (state === 'idle') render(setSeconds * 1000);
  syncControls();
});

input.addEventListener('change', () => {
  input.value = formatSeconds(setSeconds);
});

form.addEventListener('submit', (event) => {
  event.preventDefault();
  input.value = formatSeconds(setSeconds);
  start();
});

resetBtn.addEventListener('click', reset);


/* ---------- COUNTDOWN ----------
   The end time is fixed when START is pressed and every frame measures how far
   away it is. Nothing is added up tick by tick, so a throttled or hidden tab
   still shows the right time when it wakes up. */
function start() {
  if (setSeconds === 0 || state === 'running') return;
  endAt = performance.now() + setSeconds * 1000;
  lastShown = -1;
  setState('running');
  unlockAlarm();
  resetBtn.focus();                  // START and the field are now disabled
  frame = requestAnimationFrame(tick);
}

function tick(now) {
  // The frame timestamp can be a few ms older than the start time, so clamp it
  const remaining = Math.min(Math.max(0, endAt - now), setSeconds * 1000);

  // Reduced motion: count in whole seconds with the milliseconds held at 000,
  // instead of a blur of digits changing every frame
  const shown = reduceMotion.matches
    ? Math.ceil(remaining / 1000) * 1000
    : Math.floor(remaining);

  if (shown !== lastShown) {
    render(shown);
    lastShown = shown;
  }

  if (remaining > 0) frame = requestAnimationFrame(tick);
  else finish();
}

function finish() {
  render(0);
  setState('done');
  playAlarm();
}

function reset() {
  cancelAnimationFrame(frame);
  render(setSeconds * 1000);
  setState('idle');
  startBtn.focus();
}


/* ---------- ALARM ----------
   When the countdown ends the sound plays, waits half a second after it
   finishes, then plays once more. Anything that leaves the done state (RESET,
   typing a new time) cuts it off. */
const alarm = new Audio('sounds/alarm.mp3');
const ALARM_PLAYS = 2;
const ALARM_GAP = 500;    // ms of silence between the plays
let alarmLeft = 0;        // plays still to go
let alarmTimer = 0;       // pending timeout for the next play

// Browsers only allow sound after the person has interacted with the page, and
// Safari wants the first play() inside the gesture itself. START is that
// gesture, so play the clip muted for an instant to unlock it for later.
function unlockAlarm() {
  alarm.muted = true;
  alarm.play()
    .then(() => { alarm.pause(); alarm.currentTime = 0; })
    .catch(() => {})
    .finally(() => { alarm.muted = false; });
}

function playAlarmOnce() {
  alarm.currentTime = 0;
  alarm.play().catch(() => {});      // blocked or missing file: stay silent
}

function playAlarm() {
  alarmLeft = ALARM_PLAYS;
  playAlarmOnce();
}

function stopAlarm() {
  alarmLeft = 0;
  clearTimeout(alarmTimer);
  alarm.pause();
  alarm.currentTime = 0;
}

alarm.addEventListener('ended', () => {
  alarmLeft -= 1;
  if (alarmLeft > 0) alarmTimer = setTimeout(playAlarmOnce, ALARM_GAP);
});


/* ---------- STATE ----------
   One place decides what the page looks like for each state. */
function setState(next) {
  state = next;
  stage.dataset.state = next;
  if (next !== 'done') stopAlarm();

  const running = next === 'running';
  input.disabled = running;
  if (running) racing.setAttribute('aria-current', 'true');
  else racing.removeAttribute('aria-current');

  readout.setAttribute('aria-label', {
    idle: 'Active time display',
    running: 'Active time display, counting down',
    done: 'Active time display, countdown finished',
  }[next]);
  statusLine.textContent = { idle: '', running: 'Countdown started.', done: 'Countdown finished.' }[next];

  syncControls();
}

function syncControls() {
  startBtn.disabled = state === 'running' || setSeconds === 0;
  resetBtn.disabled = state === 'idle';
}


/* ---------- FIT TO THE WINDOW ----------
   Publishes the scale that fits the 1280x720 stage; style.css applies it. */
const root = document.documentElement;

function fit() {
  // Leave a margin so the registration marks on the body show around the stage
  const gutter = root.clientWidth >= 900 ? 48 : 12;
  const scale = Math.min((root.clientWidth - gutter * 2) / 1280, (root.clientHeight - gutter * 2) / 720);
  root.style.setProperty('--scale', scale.toFixed(4));
}

window.addEventListener('resize', fit);
fit();


/* ---------- START UP ---------- */
setSeconds = parseSeconds(formatTyped(input.value));
input.value = formatSeconds(setSeconds);
render(setSeconds * 1000);
setState('idle');
controls.hidden = false;
