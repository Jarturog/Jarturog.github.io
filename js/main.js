const CV = 'assets/cv.pdf';
const PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/';
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const wait = ms => new Promise(r => setTimeout(r, reduceMotion ? 0 : ms));
const $ = id => document.getElementById(id);

const stage = $('stage'), card = $('postcard'), envelope = $('envelope'), letter = $('letter');
const reader = $('reader'), pages = $('pages'), readerScroll = $('readerScroll');


// ---------- Stars for the night sky ----------
(() => {
  const g = document.querySelector('.scene .stars');
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 60; i++) {
    const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    c.setAttribute('cx', (rnd() * 600).toFixed(1));
    c.setAttribute('cy', (rnd() * 230).toFixed(1));
    c.setAttribute('r', (0.5 + rnd() * 1.2).toFixed(2));
    if (i % 4 === 0) { c.classList.add('tw'); c.style.animationDelay = (rnd() * 3).toFixed(2) + 's'; }
    g.append(c);
  }
})();

// ---------- Torn edge between the strip and the envelope ----------
(() => {
  const n = 24, d = 8, pts = [];
  for (let i = 0; i <= n; i++) pts.push([(i / n * 100).toFixed(2) + '%', i % 2 === 0]);
  $('envStrip').style.clipPath =
    'polygon(0 0, 100% 0, ' + pts.slice().reverse().map(([x, down]) => `${x} calc(100% - ${down ? 0 : d}px)`).join(', ') + ')';
  $('envFront').style.clipPath =
    'polygon(' + pts.map(([x, down]) => `${x} ${down ? d : 0}px`).join(', ') + ', 100% 100%, 0 100%)';
})();

// ---------- Postcard follows the mouse a little ----------
if (!reduceMotion && matchMedia('(hover: hover)').matches) {
  stage.addEventListener('pointermove', e => {
    if (card.classList.contains('flipped')) return;
    const r = stage.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width * 2 - 1, y = (e.clientY - r.top) / r.height * 2 - 1;
    card.style.setProperty('--ry', (x * 7).toFixed(2) + 'deg');
    card.style.setProperty('--rx', (-y * 6).toFixed(2) + 'deg');
    card.style.setProperty('--px', x.toFixed(3));
    card.style.setProperty('--py', y.toFixed(3));
  });
  stage.addEventListener('pointerleave', resetTilt);
}
function resetTilt() { ['--rx', '--ry', '--px', '--py'].forEach(p => card.style.removeProperty(p)); }

// ---------- Each thought opens a reply box (sent to my inbox by Web3Forms) ----------
const WEB3FORMS_KEY = 'f8be6e98-0181-40bb-aa4a-a28c83e4b4a5'; // public on purpose: it can only send messages to me
const replyDlg = $('reply'), replyForm = $('replyForm'), replyStatus = $('replyStatus'), replySend = $('replySend');
let replyTo = '', closeTimer;

document.querySelectorAll('.questions li').forEach(li => {
  const thought = li.textContent.trim(), b = document.createElement('button');
  b.type = 'button';
  b.textContent = thought;
  b.addEventListener('click', () => openReply(thought));
  li.replaceChildren(b);
});

function openReply(thought) {
  clearTimeout(closeTimer);
  replyTo = thought;
  $('replyThought').textContent = thought;
  replyForm.reset();
  replyStatus.textContent = ''; replyStatus.className = 'reply-status';
  replySend.disabled = false;
  replyDlg.showModal();
  replyForm.message.focus();
}
$('replyCancel').addEventListener('click', () => replyDlg.close());
replyDlg.addEventListener('click', e => { if (e.target === replyDlg) replyDlg.close(); }); // click outside the card

replyForm.addEventListener('submit', async e => {
  e.preventDefault();
  if (replyForm.botcheck.checked) return;
  replySend.disabled = true;
  replyStatus.className = 'reply-status';
  replyStatus.textContent = 'sending…';
  const body = {
    access_key: WEB3FORMS_KEY,
    subject: 're: ' + replyTo,
    from_name: 'jarturog.github.io',
    thought: replyTo,
    message: replyForm.message.value,
  };
  if (replyForm.email.value) body.email = replyForm.email.value;
  try {
    const r = await fetch('https://api.web3forms.com/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await r.json();
    if (!data.success) throw new Error(data.message);
    replyStatus.className = 'reply-status ok';
    replyStatus.textContent = 'sent. thank you!';
    closeTimer = setTimeout(() => replyDlg.close(), 1600);
  } catch {
    replyStatus.className = 'reply-status err';
    replyStatus.textContent = "couldn't send it, please try again in a moment.";
    replySend.disabled = false;
  }
});

// ---------- Links fade in on scroll ----------
const io = new IntersectionObserver(es => es.forEach(e => {
  if (e.isIntersecting) { e.target.classList.add('seen'); io.unobserve(e.target); }
}), { threshold: 0.2 });
document.querySelectorAll('.reveal').forEach(el => io.observe(el));

// ---------- PDF rendering (pdf.js) ----------
let pdfPromise;
function loadScript(src) {
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = src; s.onload = res; s.onerror = rej;
    document.head.append(s);
  });
}
function getPdf() {
  return pdfPromise ??= loadScript(PDFJS + 'pdf.min.js').then(() => {
    pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS + 'pdf.worker.min.js';
    return pdfjsLib.getDocument(CV).promise;
  });
}
async function renderPage(pdf, n, cssWidth) {
  const page = await pdf.getPage(n);
  const base = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: cssWidth * (window.devicePixelRatio || 1) / base.width });
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
  return canvas;
}

// First page of the CV becomes the letter inside the envelope
setTimeout(async () => {
  try { letter.replaceChildren(await renderPage(await getPdf(), 1, letter.clientWidth || 300)); } catch {}
}, 1200);

let pagesState = 'none';
async function renderAllPages() {
  if (pagesState !== 'none') return;
  pagesState = 'loading';
  try {
    const pdf = await getPdf();
    const width = Math.min(pages.clientWidth || 860, 860);
    const out = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const div = document.createElement('div');
      div.className = 'page';
      div.append(await renderPage(pdf, i, width));
      out.push(div);
    }
    pages.replaceChildren(...out);
    pagesState = 'done';
  } catch {
    const div = document.createElement('div');
    div.className = 'page fallback';
    div.innerHTML = `<iframe src="${CV}" title="CV"></iframe><a href="${CV}" target="_blank" rel="noopener">Open the CV as a PDF</a>`;
    pages.replaceChildren(div);
    pagesState = 'none';
  }
}

// ---------- Open: flip → tear → pull out → read ----------
let busy = false, isOpen = false;

async function openLetter() {
  if (busy || isOpen) return;
  busy = true;
  renderAllPages();
  resetTilt();
  stage.classList.add('opened');
  card.classList.add('flipped');
  await wait(850);
  envelope.classList.add('shake');
  await wait(260);
  envelope.classList.add('torn');
  await wait(450);
  envelope.classList.add('out');
  await wait(900);
  showReader(letter.getBoundingClientRect());
  isOpen = true; busy = false;
}

function showReader(fromRect) {
  reader.hidden = false;
  document.body.classList.add('locked');
  readerScroll.scrollTop = 0;
  const first = pages.firstElementChild;
  if (fromRect && first && !reduceMotion) {
    // the letter grows from where it is into the first page
    const to = first.getBoundingClientRect();
    first.style.transition = 'none';
    first.style.transformOrigin = '0 0';
    first.style.transform = `translate(${fromRect.left - to.left}px, ${fromRect.top - to.top}px) scale(${fromRect.width / to.width})`;
    first.getBoundingClientRect();
    first.style.transition = '';
    first.style.transform = '';
  }
  requestAnimationFrame(() => reader.classList.add('in'));
  $('closeReader').focus({ preventScroll: true });
}

async function closeLetter() {
  if (!isOpen || busy) return;
  busy = true;
  reader.classList.remove('in');
  await wait(300);
  reader.hidden = true;
  document.body.classList.remove('locked');
  if (card.classList.contains('flipped')) {
    envelope.classList.remove('out');
    await wait(600);
    envelope.classList.remove('torn', 'shake');
    card.classList.remove('flipped');
    await wait(850);
    stage.classList.remove('opened');
  }
  isOpen = false; busy = false;
  card.focus({ preventScroll: true });
}

card.addEventListener('click', openLetter);
card.addEventListener('keydown', e => {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openLetter(); }
});
$('closeReader').addEventListener('click', closeLetter);
readerScroll.addEventListener('click', e => { if (e.target === readerScroll || e.target === pages) closeLetter(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeLetter(); });

// Corner button: play the animation if the postcard is on screen, otherwise open straight away
document.querySelector('.cv-fab').addEventListener('click', () => {
  if (busy || isOpen) return;
  const r = stage.getBoundingClientRect();
  if (r.top >= 0 && r.bottom <= innerHeight) return openLetter();
  renderAllPages();
  showReader(null);
  isOpen = true;
});

// ---------- "Updated" date from the PDF ----------
fetch(CV, { method: 'HEAD' }).then(r => {
  const lm = r.headers.get('Last-Modified');
  if (!lm) return;
  const t = '· updated ' + new Date(lm).toLocaleDateString('en-US', { year: 'numeric', month: 'long' });
  $('updated').textContent = t;
  $('updated2').textContent = t;
}).catch(() => {});

// ---------- Click the side margins to switch between light and dark ----------
const COLUMN_HALF = 360;   // half the width of the main column, px
const inMargin = e => innerWidth > 900 && Math.abs(e.clientX - innerWidth / 2) > COLUMN_HALF
  && !(e.target instanceof Element && e.target.closest('a, button, input, textarea, dialog, [role="button"], .reader'));
const isDark = () => document.documentElement.dataset.theme === 'dark';

function applyTheme(theme, remember) {
  document.documentElement.dataset.theme = theme;
  if (remember) try { sessionStorage.setItem('theme', theme); } catch {}
  dispatchEvent(new Event('themechange'));
}

// the new theme spreads out from the click in a growing circle
function switchThemeFrom(x, y) {
  const theme = isDark() ? 'light' : 'dark';
  hideHint();
  hintSeen = true; clearTimeout(hintTimer);   // they found the switch on their own
  try { localStorage.setItem('marginHintSeen', '1'); } catch {}
  if (reduceMotion) return applyTheme(theme, true);
  if (!document.startViewTransition) {   // older browsers: a plain fade
    document.body.classList.add('theme-fade');
    applyTheme(theme, true);
    return setTimeout(() => document.body.classList.remove('theme-fade'), 600);
  }
  // a bit past the farthest corner, so the edge leaves the screen still moving instead of stopping at it
  const radius = 1.25 * Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
  document.startViewTransition(() => applyTheme(theme, true)).ready.then(() => {
    document.documentElement.animate(
      { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
      { duration: 1100, easing: 'cubic-bezier(.35, 0, .3, 1)', pseudoElement: '::view-transition-new(root)' }
    );
  });
}

document.addEventListener('click', e => { if (inMargin(e)) switchThemeFrom(e.clientX, e.clientY); });
// over the margins the cursor becomes a moon (or a sun at night): that's what a click will bring
document.addEventListener('pointermove', e => {
  document.documentElement.classList.toggle('in-margin', inMargin(e));
}, { passive: true });
// until someone clicks, follow the system setting if it changes
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', e => {
  let chosen = null;
  try { chosen = sessionStorage.getItem('theme'); } catch {}
  if (!chosen) applyTheme(e.matches ? 'dark' : 'light', false);
});

// ---------- A one-time whisper in the margin, so people find the switch ----------
let hint = null;
function hideHint() {
  if (!hint) return;
  const h = hint;
  hint = null;
  h.classList.remove('show');
  setTimeout(() => h.remove(), 900);
}
// it appears once the cursor has rested on the margin for 5 seconds, right next to it
let hintSeen = false, hintTimer = 0;
try { hintSeen = !!localStorage.getItem('marginHintSeen'); } catch {}
function showHint(x, y) {
  if (innerWidth < 1160 || document.body.classList.contains('locked')) return;   // needs a wide margin, and no open CV
  hintSeen = true;
  try { localStorage.setItem('marginHintSeen', '1'); } catch {}
  const marginWidth = innerWidth / 2 - COLUMN_HALF;
  hint = document.createElement('p');
  hint.className = 'margin-hint';
  hint.setAttribute('aria-hidden', 'true');
  hint.textContent = isDark() ? 'psst… click out here for day ☀' : 'psst… click out here for night ☾';
  hint.style.width = (marginWidth - 60) + 'px';
  hint.style.left = (x < innerWidth / 2 ? marginWidth / 2 : innerWidth - marginWidth / 2) + 'px';
  hint.style.top = Math.min(y + 48, innerHeight - 60) + 'px';
  document.body.append(hint);
  requestAnimationFrame(() => requestAnimationFrame(() => hint && hint.classList.add('show')));
  setTimeout(hideHint, 8000);
}
document.addEventListener('pointermove', e => {
  if (hintSeen) return;
  clearTimeout(hintTimer);
  if (inMargin(e)) hintTimer = setTimeout(() => showHint(e.clientX, e.clientY), 5000);
}, { passive: true });
document.documentElement.addEventListener('pointerleave', () => clearTimeout(hintTimer));
