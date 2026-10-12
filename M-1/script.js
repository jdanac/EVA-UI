/* =========================================================
   NGE MAGI DELIBERATION STUDY: BEHAVIOR
   Vanilla JS. CSS owns the look; this file only sets attributes that the
   stylesheet reacts to:
     data-state   on .screen        idle, processing or resolved
     data-status  on each plate     standby, processing or voted
     data-vote    on each plate     approve or deny
     data-verdict on the verdict box  pending, deliberating, approve or deny
   Read top to bottom: setup, display, deliberation, fit, start up.
   ========================================================= */

const stage = document.querySelector('.screen');
const controls = document.querySelector('.controls');   // also the form
const motionInput = document.querySelector('#motion');
const motionText = document.querySelector('#motion-text');
const verdictBox = document.querySelector('.tag--verdict');
const verdictText = document.querySelector('#verdict-text');
const submitBtn = document.querySelector('#submit');
const resetBtn = document.querySelector('#reset');
const statusLine = document.querySelector('#status');

const VOTES = {
  approve: { jp: '承認', en: 'Approved', verb: 'approves' },
  deny:    { jp: '否定', en: 'Denied',   verb: 'denies' },
};

// Each computer takes between MIN_MS and MIN_MS + SPAN_MS to decide
const MIN_MS = 1800;
const SPAN_MS = 2600;

// One record per plate. pick is the menu that can force its vote.
const nodes = [...document.querySelectorAll('.node')].map(el => ({
  el,
  name: el.querySelector('.node__name').textContent,
  stampJp: el.querySelector('.stamp__jp'),
  stampEn: el.querySelector('.stamp__en'),
  pick: document.querySelector(`#pick-${el.dataset.node}`),
  timer: 0,           // pending timeout that casts this plate's vote
}));

let state = 'idle';   // idle, processing or resolved


/* ---------- DISPLAY ----------
   Small functions that write attributes and text. Nothing here decides
   anything; it only shows what it is told. */
function showNode(node, status, vote) {
  node.el.dataset.status = status;
  if (vote) {
    node.el.dataset.vote = vote;
    node.stampJp.textContent = VOTES[vote].jp;
    node.stampEn.textContent = VOTES[vote].en;
  } else {
    delete node.el.dataset.vote;
    node.stampJp.textContent = '';
    node.stampEn.textContent = '';
  }
}

function showVerdict(kind, text) {
  verdictBox.dataset.verdict = kind;
  verdictText.textContent = text;
}

function announce(text) {
  statusLine.textContent = text;
}

function setState(next) {
  state = next;
  stage.dataset.state = next;
  syncControls();
}

// The motion cannot change mid-deliberation, and an empty one cannot be submitted
function syncControls() {
  const busy = state === 'processing';
  motionInput.disabled = busy;
  nodes.forEach(n => { n.pick.disabled = busy; });
  submitBtn.disabled = busy || motionInput.value.trim() === '';
  resetBtn.disabled = state === 'idle';
}


/* ---------- DELIBERATION ----------
   SUBMIT sets every plate to processing and gives each its own timer. When a
   timer fires that computer votes, either what its menu forces or a coin
   flip. When all three have voted, two of three decides. */
function start() {
  if (state === 'processing' || motionInput.value.trim() === '') return;

  nodes.forEach(n => {
    clearTimeout(n.timer);
    showNode(n, 'processing', null);
    n.timer = setTimeout(() => castVote(n), MIN_MS + Math.random() * SPAN_MS);
  });
  showVerdict('deliberating', 'DELIBERATING');
  announce('Deliberation started.');
  setState('processing');
  resetBtn.focus();                  // SUBMIT and the menus are now disabled
}

function castVote(node) {
  const pick = node.pick.value;
  const vote = pick === 'auto' ? (Math.random() < 0.5 ? 'approve' : 'deny') : pick;
  showNode(node, 'voted', vote);
  announce(`${node.name} ${VOTES[vote].verb}.`);

  if (nodes.every(n => n.el.dataset.status === 'voted')) resolve();
}

function resolve() {
  const yes = nodes.filter(n => n.el.dataset.vote === 'approve').length;
  const no = nodes.length - yes;
  const outcome = yes > no ? 'approve' : 'deny';

  showVerdict(outcome, `${outcome === 'approve' ? 'APPROVED' : 'DENIED'} ${yes}-${no}`);
  announce(`Motion ${outcome === 'approve' ? 'approved' : 'denied'}, ${Math.max(yes, no)} to ${Math.min(yes, no)}.`);
  setState('resolved');
}

function reset(refocus = true) {
  nodes.forEach(n => {
    clearTimeout(n.timer);
    showNode(n, 'standby', null);
  });
  showVerdict('pending', 'PENDING');
  announce('');
  setState('idle');
  if (refocus) submitBtn.focus();
}

controls.addEventListener('submit', e => {
  e.preventDefault();
  start();
});
resetBtn.addEventListener('click', () => reset());

// Typing a new motion clears an old result, and the result box follows the field
motionInput.addEventListener('input', () => {
  motionInput.value = motionInput.value.toUpperCase();
  motionText.textContent = motionInput.value.trim();
  if (state === 'resolved') reset(false);
  else syncControls();
});


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
motionText.textContent = motionInput.value.trim();
reset(false);
controls.hidden = false;
