/* =========================================================
   HANGMAN — PARTY EDITION
   All logic lives in this single script, executed by the
   host page. It renders TWO kinds of audience surfaces:
     1) An always-on <iframe> preview inside the host page
        itself, so the whole game can be tested on one screen.
     2) A genuine second browser window (popup) that gets
        built and updated the same way, for the real event.
   Both are just "documents" we hand to the same render
   functions — there is no cross-window messaging involved,
   so there's nothing that can silently fail to "arrive".
========================================================= */

const DEFAULT_CATEGORIES = {
  "Movies": ["THE GODFATHER","JURASSIC PARK","STAR WARS","TITANIC","THE LION KING"],
  "Animals": ["ELEPHANT","GIRAFFE","PENGUIN","KANGAROO","OCTOPUS"],
  "Countries": ["AUSTRALIA","BRAZIL","JAPAN","CANADA","EGYPT"],
  "Food & Drink": ["SPAGHETTI","CHOCOLATE CAKE","PINEAPPLE PIZZA","LEMONADE","SUSHI"],
  "Sports": ["BASKETBALL","SWIMMING","TENNIS","GYMNASTICS","SOCCER"]
};
const PART_ORDER = ["base","post","beam","rope","head","torso","armL","armR","legL","legR"];
const STORAGE_KEY = "hangman_party_categories_v2";

/* =========================================================
   TXT IMPORT / EXPORT
========================================================= */
const EXAMPLE_TXT = `# Hangman word list
# Separate each category with a blank line. Lines starting with # are ignored.

Category: Movies
The Godfather
Jurassic Park
Star Wars
Titanic
The Lion King

Category: Animals
Elephant
Giraffe
Penguin
Kangaroo
Octopus

Category: Countries
Australia
Brazil
Japan
Canada
Egypt
`;

function parseCategoriesTxt(text){
  const errors = [];
  const blocks = text.replace(/\r\n/g,"\n").split(/\n\s*\n+/).map(b=>b.trim()).filter(Boolean);
  const categories = {};
  blocks.forEach((block, bi) => {
    const rawLines = block.split("\n").map(l=>l.trim()).filter(l => l && !l.startsWith("#"));
    if(rawLines.length < 2){
      errors.push(`Block ${bi+1}: needs a category line and at least one phrase — skipped.`);
      return;
    }
    let name = rawLines[0];
    const catMatch = name.match(/^category\s*:\s*(.*)$/i);
    if(catMatch) name = catMatch[1].trim();
    const phrases = rawLines.slice(1).map(l => l.toUpperCase());
    if(!name || phrases.length === 0){
      errors.push(`Block ${bi+1}: missing category name or phrases — skipped.`);
      return;
    }
    categories[name] = (categories[name] || []).concat(phrases);
  });
  return {categories, errors};
}

function categoriesToTxt(categories){
  return Object.keys(categories).map(name =>
    `Category: ${name}\n` + categories[name].join("\n")
  ).join("\n\n") + "\n";
}

function downloadTextFile(filename, text){
  const blob = new Blob([text], {type:"text/plain"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(()=>URL.revokeObjectURL(url), 1000);
}

/* =========================================================
   AUDIENCE DOCUMENT TEMPLATE
   (CSS + HTML injected into the iframe and the popup window)
========================================================= */
const AUDIENCE_CSS = `
:root{
  --navy-deep:#0A0E27; --navy-panel:#121a3d; --navy-panel2:#0e1533; --navy-line:#28315c;
  --gold:#E8B94A; --gold-bright:#FFD966; --red:#E63946; --red-deep:#8f1630;
  --cream:#F5EFE0; --text-dim:#9AA3C7; --green:#3DDC84;
  --font-display:'Arial Black', Impact, 'Haettenschweiler', 'Franklin Gothic Bold', sans-serif;
  --font-body:'Segoe UI', Tahoma, Geneva, sans-serif;
}
*{box-sizing:border-box;}
html,body{margin:0;padding:0;width:100%;height:100%;overflow:hidden;
  background:radial-gradient(ellipse at 50% -10%, #1c2557 0%, var(--navy-deep) 60%);
  color:var(--cream);font-family:var(--font-body);}
body{display:flex;align-items:center;justify-content:center;position:relative;}
.marquee-border{position:absolute;inset:14px;border:3px solid var(--gold);border-radius:18px;pointer-events:none;
  box-shadow:0 0 0 1px rgba(232,185,74,.25), inset 0 0 40px rgba(232,185,74,.08);z-index:1;}
.bulb{position:absolute;width:9px;height:9px;border-radius:50%;background:var(--gold-bright);
  box-shadow:0 0 8px 3px rgba(255,217,102,.9);animation:blink 1.6s infinite;}
@keyframes blink{0%,100%{opacity:1;}50%{opacity:.25;}}

.aud-wrap{width:100%;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:5vh 4vw;gap:20px;position:relative;z-index:2;}

.aud-idle{text-align:center;animation:idleFloat 3s ease-in-out infinite;}
@keyframes idleFloat{0%,100%{transform:translateY(0);}50%{transform:translateY(-8px);}}
.aud-idle .big{font-family:var(--font-display);font-size:min(9vw,90px);color:var(--gold-bright);letter-spacing:4px;text-shadow:0 0 30px rgba(232,185,74,.4);}
.aud-idle .sub{color:var(--text-dim);font-size:20px;margin-top:10px;letter-spacing:2px;text-transform:uppercase;}

.aud-category{font-family:var(--font-body);font-size:clamp(16px,2.4vw,26px);color:var(--gold);letter-spacing:3px;
  text-transform:uppercase;font-weight:700;opacity:0;transform:translateY(-6px);transition:all .4s ease;}
.aud-category.show{opacity:.9;transform:translateY(0);}

.stage-and-word{display:flex;align-items:center;justify-content:center;gap:6vw;width:100%;flex:1;min-height:0;}
.stage-wrap{flex:0 0 auto;transition:transform .12s;}
.stage-wrap svg{width:min(28vw,360px);height:auto;filter:drop-shadow(0 0 18px rgba(232,185,74,.12));}
.svg-part{fill:none;stroke:var(--cream);stroke-width:7;stroke-linecap:round;stroke-linejoin:round;
  opacity:0;transition:stroke-dashoffset 0.6s cubic-bezier(.4,.1,.2,1), opacity 0.1s ease;}
.svg-part.revealed{opacity:1;}
.svg-part.rope-part{stroke:var(--gold);}
.svg-part.figure-part{stroke:var(--gold-bright);}

.word-wrap{display:flex;flex-direction:column;gap:16px;align-items:center;max-width:56vw;}
.word-row{display:flex;flex-wrap:wrap;gap:14px;justify-content:center;}
.letter-tile{min-width:44px;height:58px;border-bottom:5px solid var(--gold);display:flex;align-items:center;justify-content:center;
  font-family:var(--font-display);font-size:34px;color:var(--cream);position:relative;}
.letter-tile.space{border-bottom:none;min-width:24px;}
.letter-tile .fill{opacity:0;transform:translateY(14px) scale(.6) rotateX(60deg);transition:opacity .3s ease, transform .35s cubic-bezier(.34,1.56,.64,1);}
.letter-tile.shown .fill{opacity:1;transform:translateY(0) scale(1) rotateX(0);}
.letter-tile.punct{border-bottom:none;color:var(--gold-bright);}

.guessed-panel{display:flex;gap:10px;flex-wrap:wrap;justify-content:center;max-width:70vw;}
.guessed-letter{width:34px;height:34px;border-radius:7px;display:flex;align-items:center;justify-content:center;
  font-weight:700;font-size:16px;background:var(--navy-panel2);border:1px solid var(--navy-line);color:var(--text-dim);
  animation:chipIn .3s cubic-bezier(.34,1.56,.64,1);}
@keyframes chipIn{from{transform:scale(0);opacity:0;}to{transform:scale(1);opacity:1;}}
.guessed-letter.wrong{background:var(--red-deep);border-color:var(--red);color:#ffd3d6;text-decoration:line-through;}
.guessed-letter.correct{background:rgba(61,220,132,.15);border-color:var(--green);color:var(--green);}

.end-overlay{position:absolute;inset:0;display:none;align-items:center;justify-content:center;flex-direction:column;
  background:rgba(10,14,39,.92);z-index:10;gap:18px;text-align:center;padding:40px;}
.end-overlay.show{display:flex;animation:overlayIn .4s ease;}
@keyframes overlayIn{from{opacity:0;}to{opacity:1;}}
.end-overlay .headline{font-family:var(--font-display);font-size:min(11vw,110px);letter-spacing:3px;}
.end-overlay.win .headline{color:var(--gold-bright);text-shadow:0 0 40px rgba(255,217,102,.6);animation:winpulse 1.2s ease-in-out infinite;}
.end-overlay.lose .headline{color:var(--red);text-shadow:0 0 30px rgba(230,57,70,.5);}
@keyframes winpulse{0%,100%{transform:scale(1);}50%{transform:scale(1.06);}}
.end-overlay .revealphrase{font-family:var(--font-display);font-size:clamp(24px,4vw,48px);color:var(--cream);letter-spacing:2px;max-width:80vw;}
.end-overlay .revealcat{color:var(--text-dim);font-size:16px;letter-spacing:2px;text-transform:uppercase;}

.confetti{position:absolute;top:-10px;width:10px;height:16px;opacity:.9;animation:fall linear forwards;z-index:30;}
@keyframes fall{to{transform:translateY(110vh) rotate(720deg);opacity:.2;}}

.shakeit{animation:shakeAnim .4s;}
@keyframes shakeAnim{0%,100%{transform:translateX(0);}20%{transform:translateX(-10px);}40%{transform:translateX(10px);}60%{transform:translateX(-6px);}80%{transform:translateX(6px);}}

.timer-widget{position:absolute;top:26px;right:26px;z-index:6;display:flex;flex-direction:column;align-items:center;gap:4px;opacity:.18;transition:opacity .3s ease;}
.timer-widget.armed{opacity:1;}
.timer-ring-wrap{position:relative;width:84px;height:84px;}
.timer-ring-wrap svg{width:100%;height:100%;transform:rotate(-90deg);}
.timer-ring-bg{fill:none;stroke:var(--navy-line);stroke-width:6;}
.timer-ring-fg{fill:none;stroke:var(--gold);stroke-width:6;stroke-linecap:round;transition:stroke-dashoffset .2s linear, stroke .3s ease;}
.timer-num{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-family:var(--font-display);font-size:19px;color:var(--cream);}
.timer-widget.warning .timer-ring-fg{stroke:var(--red);}
.timer-widget.warning .timer-num{color:var(--red);animation:timerPulse .6s ease-in-out infinite;}
@keyframes timerPulse{0%,100%{transform:scale(1);}50%{transform:scale(1.15);}}
.timer-widget.done{animation:timerDoneFlash .7s ease 3;}
@keyframes timerDoneFlash{0%,100%{opacity:1;}50%{opacity:.15;}}

@media (prefers-reduced-motion: reduce){ *{animation-duration:.01ms !important; transition-duration:.01ms !important;} }
`;

const AUDIENCE_BODY = `
<div class="marquee-border"></div>
<div id="bulbs"></div>
<div class="timer-widget" id="timerWidget">
  <div class="timer-ring-wrap">
    <svg viewBox="0 0 100 100">
      <circle class="timer-ring-bg" cx="50" cy="50" r="44"></circle>
      <circle class="timer-ring-fg" id="timerRingFg" cx="50" cy="50" r="44"></circle>
    </svg>
    <div class="timer-num" id="timerNum">0:30</div>
  </div>
</div>
<div class="aud-wrap">
  <div class="aud-idle" id="audIdle">
    <div class="big">HANGMAN</div>
    <div class="sub">Get ready to play...</div>
  </div>
  <div id="audPlaying" style="display:none;width:100%;height:100%;flex-direction:column;align-items:center;justify-content:center;gap:22px;">
    <div class="aud-category" id="audCategory"></div>
    <div class="stage-and-word">
      <div class="stage-wrap">
        <svg viewBox="0 0 240 260">
          <path id="part-base" class="svg-part rope-part" d="M30 240 H150"/>
          <path id="part-post" class="svg-part rope-part" d="M60 240 V30"/>
          <path id="part-beam" class="svg-part rope-part" d="M60 30 H170"/>
          <path id="part-rope" class="svg-part rope-part" d="M170 30 V55"/>
          <circle id="part-head" class="svg-part figure-part" cx="170" cy="78" r="22"/>
          <path id="part-torso" class="svg-part figure-part" d="M170 100 V160"/>
          <path id="part-armL" class="svg-part figure-part" d="M170 115 L140 145"/>
          <path id="part-armR" class="svg-part figure-part" d="M170 115 L200 145"/>
          <path id="part-legL" class="svg-part figure-part" d="M170 160 L145 205"/>
          <path id="part-legR" class="svg-part figure-part" d="M170 160 L195 205"/>
        </svg>
      </div>
      <div class="word-wrap">
        <div id="wordRows"></div>
        <div class="guessed-panel" id="guessedPanel"></div>
      </div>
    </div>
  </div>
</div>
<div class="end-overlay" id="endOverlay">
  <div class="headline" id="endHeadline">YOU GOT IT!</div>
  <div class="revealcat" id="endCat"></div>
  <div class="revealphrase" id="endPhrase"></div>
</div>
`;

/* =========================================================
   AUDIO (played from the host laptop's own speakers, since
   that's what's plugged into the projector/TV anyway)
========================================================= */
let audioCtx = null;
function playTone(freq, duration, type, delay = 0){
  try{
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = type; osc.frequency.value = freq;
    osc.connect(gain); gain.connect(audioCtx.destination);
    const t0 = audioCtx.currentTime + delay;
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(0.25, t0 + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    osc.start(t0); osc.stop(t0 + duration + 0.05);
  }catch(e){}
}
function sfxCorrect(){ playTone(660,0.12,"sine"); playTone(880,0.16,"sine",0.1); }
function sfxWrong(){ playTone(140,0.35,"sawtooth"); }
function sfxWin(){ [523,659,784,1046].forEach((f,i)=>playTone(f,0.25,"triangle",i*0.12)); }
function sfxLose(){ playTone(180,0.6,"sawtooth"); playTone(120,0.7,"sawtooth",0.15); }
function sfxTimeUp(){ [1046,1046,1046].forEach((f,i)=>playTone(f,0.13,"square",i*0.22)); }

/* =========================================================
   AUDIENCE RENDERING (works on ANY document — the iframe's
   or the popup's — since both get built from the same
   AUDIENCE_BODY/AUDIENCE_CSS above)
========================================================= */
function buildAudienceDocument(doc){
  doc.open();
  doc.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Hangman — Audience Display</title>
    <style>${AUDIENCE_CSS}</style></head><body>${AUDIENCE_BODY}</body></html>`);
  doc.close();
  placeBulbs(doc);

  // The decorative marquee bulbs are positioned in absolute pixels based on
  // the window size at build time. Without this, going fullscreen (or the
  // popup being resized/dragged to another monitor) leaves them clustered
  // in the original small area while the CSS border itself scales up —
  // making the lit outline look like a static square stuck in the middle.
  const win = doc.defaultView;
  let resizeTimer = null;
  const recalc = () => { clearTimeout(resizeTimer); resizeTimer = win.setTimeout(() => placeBulbs(doc), 100); };
  win.addEventListener("resize", recalc);
  doc.addEventListener("fullscreenchange", recalc);
  doc.addEventListener("webkitfullscreenchange", recalc);
}

function placeBulbs(doc){
  const container = doc.getElementById("bulbs");
  if(!container) return;
  container.innerHTML = "";
  const w = (doc.documentElement.clientWidth || doc.defaultView.innerWidth || 1280) - 28;
  const h = (doc.documentElement.clientHeight || doc.defaultView.innerHeight || 720) - 28;
  const perim = 2*w + 2*h;
  const n = 60;
  for(let i=0;i<n;i++){
    const b = doc.createElement("div");
    b.className = "bulb";
    const t = i / n;
    const d = t * perim;
    let x, y;
    if(d < w){ x = 14+d; y = 14; }
    else if(d < w+h){ x = 14+w; y = 14+(d-w); }
    else if(d < 2*w+h){ x = 14+w-(d-w-h); y = 14+h; }
    else { x = 14; y = 14+h-(d-2*w-h); }
    b.style.left = x+"px"; b.style.top = y+"px";
    b.style.animationDelay = (t*1.6)+"s";
    container.appendChild(b);
  }
}

function spawnConfetti(doc){
  const colors = ["#E8B94A","#FFD966","#E63946","#3DDC84","#F5EFE0"];
  for(let i=0;i<70;i++){
    const c = doc.createElement("div");
    c.className = "confetti";
    c.style.left = Math.random()*100+"vw";
    c.style.background = colors[Math.floor(Math.random()*colors.length)];
    c.style.animationDuration = (2+Math.random()*1.5)+"s";
    c.style.animationDelay = (Math.random()*0.6)+"s";
    doc.body.appendChild(c);
    setTimeout(()=>c.remove(), 4000);
  }
}

function alphaChars(str){ return str.toUpperCase().split("").filter(c => /[A-Z]/.test(c)); }

function renderWordOnDoc(doc, state){
  const wrap = doc.getElementById("wordRows");
  if(!wrap) return;
  wrap.innerHTML = "";
  if(!state.selectedPhrase) return;
  const forceAll = state.status === "shown";
  const words = state.selectedPhrase.split(" ");
  const row = doc.createElement("div");
  row.className = "word-row";
  words.forEach((word, wi) => {
    word.split("").forEach(ch => {
      const tile = doc.createElement("div");
      if(/[A-Z]/.test(ch)){
        const isShown = forceAll || state.guessed.includes(ch);
        tile.className = "letter-tile" + (isShown ? " shown" : "");
        tile.innerHTML = `<span class="fill">${ch}</span>`;
      } else {
        tile.className = "letter-tile punct shown";
        tile.innerHTML = `<span class="fill" style="opacity:1;">${ch}</span>`;
      }
      row.appendChild(tile);
    });
    if(wi < words.length-1){
      const space = doc.createElement("div");
      space.className = "letter-tile space";
      row.appendChild(space);
    }
  });
  wrap.appendChild(row);
}

function renderGuessedOnDoc(doc, state){
  const panel = doc.getElementById("guessedPanel");
  if(!panel) return;
  panel.innerHTML = "";
  state.guessed.slice().sort().forEach(letter => {
    const chip = doc.createElement("div");
    chip.className = "guessed-letter " + (state.wrong.includes(letter) ? "wrong" : "correct");
    chip.textContent = letter;
    panel.appendChild(chip);
  });
}

function renderHangmanOnDoc(doc, state){
  const wrongCount = state.wrong.length;
  const partsToShow = state.status === "idle" ? 0 : Math.min(10, Math.ceil((wrongCount / Math.max(1,state.maxWrong)) * 10));
  PART_ORDER.forEach((part, idx) => {
    const el = doc.getElementById("part-"+part);
    if(!el) return;
    const keepVisibleOnEnd = state.status !== "playing" && state.status !== "idle" && idx < 4;
    const shouldShow = idx < partsToShow || keepVisibleOnEnd;
    if(shouldShow && !el.classList.contains("revealed")){
      const len = el.getTotalLength ? el.getTotalLength() : 100;
      el.style.strokeDasharray = len;
      el.style.strokeDashoffset = len;
      el.classList.add("revealed");
      const win = doc.defaultView;
      win.requestAnimationFrame(()=>{ win.requestAnimationFrame(()=>{ el.style.strokeDashoffset = 0; }); });
    } else if(!shouldShow && el.classList.contains("revealed")){
      el.classList.remove("revealed");
      el.style.strokeDashoffset = el.getTotalLength ? el.getTotalLength() : 100;
    }
  });
}

function showEndOverlayOnDoc(doc, state){
  const overlay = doc.getElementById("endOverlay");
  const headline = doc.getElementById("endHeadline");
  const cat = doc.getElementById("endCat");
  const phrase = doc.getElementById("endPhrase");
  const won = state.status === "won";
  overlay.className = "end-overlay show " + (won ? "win" : "lose");
  headline.textContent = won ? "YOU GOT IT!" : "OUT OF GUESSES!";
  cat.textContent = state.selectedCategory ? "Category: " + state.selectedCategory : "";
  phrase.textContent = state.selectedPhrase || "";
  if(won) spawnConfetti(doc);
}
function hideEndOverlayOnDoc(doc){
  const overlay = doc.getElementById("endOverlay");
  if(overlay) overlay.className = "end-overlay";
}

function formatTime(seconds){
  seconds = Math.max(0, Math.ceil(seconds));
  const m = Math.floor(seconds/60);
  const s = seconds % 60;
  return m + ":" + String(s).padStart(2,"0");
}

const TIMER_CIRCUMFERENCE = 2 * Math.PI * 44;

function updateTimerOnDoc(doc, state){
  const widget = doc.getElementById("timerWidget");
  const ring = doc.getElementById("timerRingFg");
  const num = doc.getElementById("timerNum");
  if(!widget || !ring || !num) return;
  const duration = Math.max(1, state.timer.duration);
  const remaining = Math.max(0, state.timer.remaining);
  const frac = Math.min(1, remaining / duration);
  ring.style.strokeDasharray = TIMER_CIRCUMFERENCE;
  ring.style.strokeDashoffset = TIMER_CIRCUMFERENCE * (1 - frac);
  num.textContent = formatTime(remaining);
  const armed = state.timer.running || remaining < duration;
  widget.classList.toggle("armed", armed);
  widget.classList.toggle("warning", state.timer.running && remaining <= 10 && remaining > 0);
}

function flashTimerDoneOnDoc(doc){
  const widget = doc.getElementById("timerWidget");
  if(!widget) return;
  widget.classList.remove("done");
  void widget.offsetWidth;
  widget.classList.add("done");
  setTimeout(()=>widget.classList.remove("done"), 2200);
}

let lastEventPlayedId = { preview: null, popup: null };

function renderAudienceOnDoc(doc, state, key){
  const idle = doc.getElementById("audIdle");
  const playing = doc.getElementById("audPlaying");
  if(!idle || !playing) return;

  updateTimerOnDoc(doc, state);

  if(state.status === "idle" || !state.selectedPhrase){
    idle.style.display = "flex";
    playing.style.display = "none";
    hideEndOverlayOnDoc(doc);
    if(state.lastEvent && state.lastEvent.id !== lastEventPlayedId[key]){
      lastEventPlayedId[key] = state.lastEvent.id;
      if(state.lastEvent.type === "timerEnd"){ sfxTimeUp(); flashTimerDoneOnDoc(doc); }
    }
    return;
  }

  idle.style.display = "none";
  playing.style.display = "flex";

  const catEl = doc.getElementById("audCategory");
  const showCat = state.showCategoryHint && state.selectedCategory;
  catEl.textContent = showCat ? state.selectedCategory : "";
  catEl.classList.toggle("show", !!showCat);

  renderWordOnDoc(doc, state);
  renderGuessedOnDoc(doc, state);
  renderHangmanOnDoc(doc, state);

  if(state.status === "won" || state.status === "lost" || state.status === "revealed"){
    showEndOverlayOnDoc(doc, state);
  } else {
    hideEndOverlayOnDoc(doc);
  }

  if(state.lastEvent && state.lastEvent.id !== lastEventPlayedId[key]){
    lastEventPlayedId[key] = state.lastEvent.id;
    const t = state.lastEvent.type;
    const stageWrap = doc.querySelector(".stage-wrap");
    if(t === "correct") sfxCorrect();
    else if(t === "wrong"){
      sfxWrong();
      if(stageWrap){ stageWrap.classList.remove("shakeit"); void stageWrap.offsetWidth; stageWrap.classList.add("shakeit"); }
    }
    else if(t === "won") sfxWin();
    else if(t === "lost") sfxLose();
    else if(t === "timerEnd"){ sfxTimeUp(); flashTimerDoneOnDoc(doc); }
  }
}

/* =========================================================
   RENDER TARGET REGISTRY
   previewFrame (iframe, always present) + popup (optional)
========================================================= */
const previewFrame = document.getElementById("previewFrame");
let popupWin = null;

function renderAllAudience(state){
  try{
    if(previewFrame && previewFrame.contentDocument){
      renderAudienceOnDoc(previewFrame.contentDocument, state, "preview");
    }
  }catch(e){}
  try{
    if(popupWin && !popupWin.closed){
      renderAudienceOnDoc(popupWin.document, state, "popup");
    }
  }catch(e){}
}

/* =========================================================
   GAME STATE + HOST LOGIC
========================================================= */
function loadCategories(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    if(raw) return JSON.parse(raw);
  }catch(e){}
  return JSON.parse(JSON.stringify(DEFAULT_CATEGORIES));
}
function saveCategories(){
  try{ localStorage.setItem(STORAGE_KEY, JSON.stringify(state.categories)); }catch(e){}
}

let state = {
  categories: loadCategories(),
  maxWrong: 6,
  showCategoryHint: true,
  selectedCategory: null,
  selectedPhrase: null,
  guessed: [],
  wrong: [],
  status: "idle", // idle | playing | won | lost | revealed
  timer: { duration: 30, remaining: 30, running: false, startedAt: null },
  lastEvent: null
};

function checkWin(){
  if(!state.selectedPhrase) return false;
  const letters = new Set(alphaChars(state.selectedPhrase));
  for(const l of letters){ if(!state.guessed.includes(l)) return false; }
  return true;
}

function selectPhrase(cat, phrase){
  state.selectedCategory = cat;
  state.selectedPhrase = phrase;
  state.status = "idle";
  state.guessed = [];
  state.wrong = [];
  renderHost(); renderAllAudience(state);
}

function startRound(){
  if(!state.selectedPhrase) return;
  state.status = "playing";
  state.guessed = [];
  state.wrong = [];
  state.lastEvent = {type:"start", id: Date.now()};
  renderHost(); renderAllAudience(state);
}

function resetRound(){
  state.guessed = [];
  state.wrong = [];
  state.status = state.selectedPhrase ? "playing" : "idle";
  state.lastEvent = {type:"reset", id: Date.now()};
  renderHost(); renderAllAudience(state);
}

function revealEnd(){
  if(!state.selectedPhrase) return;
  state.status = "revealed";
  state.lastEvent = {type: (checkWin() ? "won" : "revealed"), id: Date.now()};
  renderHost(); renderAllAudience(state);
}

function revealWordOnly(){
  if(!state.selectedPhrase) return;
  state.status = "won";
  state.lastEvent = {type:"won", id: Date.now()};
  renderHost(); renderAllAudience(state);
}

function guessLetter(letter){
  letter = letter.toUpperCase();
  if(state.status !== "playing") return;
  if(!/[A-Z]/.test(letter)) return;
  if(state.guessed.includes(letter)) return;
  state.guessed.push(letter);
  const inPhrase = alphaChars(state.selectedPhrase).includes(letter);
  if(inPhrase){
    state.lastEvent = {type:"correct", id: Date.now(), letter};
    if(checkWin()){
      state.status = "won";
      state.lastEvent = {type:"won", id: Date.now()};
    }
  } else {
    state.wrong.push(letter);
    state.lastEvent = {type:"wrong", id: Date.now(), letter};
    if(state.wrong.length >= state.maxWrong){
      state.status = "lost";
      state.lastEvent = {type:"lost", id: Date.now()};
    }
  }
  renderHost(); renderAllAudience(state);
}

/* ---------- Timer ---------- */
function startOrResumeTimer(){
  if(state.timer.running) return;
  if(state.timer.remaining <= 0) state.timer.remaining = state.timer.duration;
  state.timer.startedAt = Date.now() - ((state.timer.duration - state.timer.remaining) * 1000);
  state.timer.running = true;
  renderHost(); renderAllAudience(state);
}
function pauseTimer(){
  if(!state.timer.running) return;
  const elapsed = (Date.now() - state.timer.startedAt) / 1000;
  state.timer.remaining = Math.max(0, state.timer.duration - elapsed);
  state.timer.running = false;
  renderHost(); renderAllAudience(state);
}
function resetTimer(){
  state.timer.running = false;
  state.timer.remaining = state.timer.duration;
  state.timer.startedAt = null;
  renderHost(); renderAllAudience(state);
}
function setTimerDuration(sec){
  sec = Math.max(5, Math.min(600, sec || 30));
  state.timer.duration = sec;
  if(!state.timer.running) state.timer.remaining = sec;
  renderHost(); renderAllAudience(state);
}
function timerTick(){
  if(state.timer.running){
    const elapsed = (Date.now() - state.timer.startedAt) / 1000;
    const remaining = state.timer.duration - elapsed;
    if(remaining <= 0){
      state.timer.running = false;
      state.timer.remaining = 0;
      state.lastEvent = {type:"timerEnd", id: Date.now()};
      renderHost(); renderAllAudience(state);
      return;
    }
    state.timer.remaining = remaining;
  }
  renderHostTimerReadout();
  try{ if(previewFrame && previewFrame.contentDocument) updateTimerOnDoc(previewFrame.contentDocument, state); }catch(e){}
  try{ if(popupWin && !popupWin.closed) updateTimerOnDoc(popupWin.document, state); }catch(e){}
}
function renderHostTimerReadout(){
  const el = document.getElementById("hostTimerReadout");
  if(el) el.textContent = formatTime(state.timer.remaining);
  const startBtn = document.getElementById("btnTimerStart");
  const pauseBtn = document.getElementById("btnTimerPause");
  if(startBtn) startBtn.disabled = state.timer.running;
  if(pauseBtn) pauseBtn.disabled = !state.timer.running;
  const durInput = document.getElementById("timerDurationInput");
  if(durInput) durInput.disabled = state.timer.running;
}

/* ---------- Host rendering ---------- */
function renderCategoryBrowser(){
  const el = document.getElementById("categoryBrowser");
  el.innerHTML = "";
  Object.keys(state.categories).forEach(cat => {
    const block = document.createElement("div");
    block.className = "category-block";
    const title = document.createElement("div");
    title.className = "category-title";
    title.textContent = cat;
    block.appendChild(title);
    const list = document.createElement("div");
    list.className = "phrase-list";
    state.categories[cat].forEach(phrase => {
      const chip = document.createElement("button");
      chip.className = "phrase-chip" + (state.selectedPhrase === phrase && state.selectedCategory === cat ? " selected" : "");
      chip.textContent = phrase;
      chip.onclick = () => selectPhrase(cat, phrase);
      list.appendChild(chip);
    });
    block.appendChild(list);
    el.appendChild(block);
  });
}

function renderCatManage(){
  const sel = document.getElementById("phraseCategorySelect");
  sel.innerHTML = Object.keys(state.categories).map(c => `<option value="${c}">${c}</option>`).join("");
  const list = document.getElementById("catManageList");
  list.innerHTML = "";
  Object.keys(state.categories).forEach(cat => {
    const row = document.createElement("div");
    const count = state.categories[cat].length;
    row.innerHTML = `<span>${cat} (${count})</span>`;
    const del = document.createElement("button");
    del.textContent = "Delete category";
    del.onclick = () => {
      delete state.categories[cat];
      saveCategories();
      renderHost();
    };
    row.appendChild(del);
    list.appendChild(row);
  });
}

function renderHost(){
  renderCategoryBrowser();
  renderCatManage();
  renderHostTimerReadout();

  document.getElementById("selCategory").textContent = state.selectedCategory || "— none selected —";
  document.getElementById("selPhrase").textContent = state.selectedPhrase || "— none selected —";
  document.getElementById("btnStartRound").disabled = !state.selectedPhrase;

  const banner = document.getElementById("roundBanner");
  banner.className = "round-banner " + state.status;
  const bannerText = {
    idle: "Round idle — pick a phrase to begin",
    playing: "Round in progress",
    won: "Audience won this round! 🎉",
    lost: "Audience ran out of guesses",
    revealed: "Round ended early — phrase revealed",
    shown: "Word revealed to audience — round still open"
  };
  banner.textContent = bannerText[state.status] || "";

  document.getElementById("statCorrect").textContent = state.guessed.length - state.wrong.length;
  document.getElementById("statWrong").textContent = state.wrong.length;
  document.getElementById("statRemaining").textContent = Math.max(0, state.maxWrong - state.wrong.length);
  document.getElementById("wrongList").textContent = state.wrong.length ? state.wrong.join(", ") : "none";

  document.querySelectorAll(".kb-key").forEach(btn => {
    const letter = btn.dataset.letter;
    btn.classList.remove("correct","wrong");
    btn.disabled = state.status !== "playing" || state.guessed.includes(letter);
    if(state.guessed.includes(letter)){
      btn.classList.add(state.wrong.includes(letter) ? "wrong" : "correct");
    }
  });
}

function buildKeyboard(){
  const grid = document.getElementById("kbGrid");
  "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").forEach(letter => {
    const btn = document.createElement("button");
    btn.className = "kb-key";
    btn.textContent = letter;
    btn.dataset.letter = letter;
    btn.onclick = () => guessLetter(letter);
    grid.appendChild(btn);
  });
}

/* =========================================================
   INIT + WIRING
========================================================= */
function setConn(ok){
  const pill = document.getElementById("connStatus");
  const txt = document.getElementById("connText");
  pill.classList.toggle("connected", ok);
  txt.textContent = ok ? "Second screen connected" : "Second screen not launched";
}

function init(){
  buildKeyboard();
  renderHost();
  buildAudienceDocument(previewFrame.contentDocument);
  renderAllAudience(state);
  setInterval(timerTick, 200);

  document.getElementById("btnLaunch").onclick = () => {
    if(popupWin && !popupWin.closed){
      popupWin.focus();
      return;
    }
    popupWin = window.open("", "hangmanAudience", "width=1280,height=720,menubar=no,toolbar=no,location=no,status=no");
    if(!popupWin){
      alert("Your browser blocked the popup. Please allow popups for this page and click Launch again.");
      return;
    }
    buildAudienceDocument(popupWin.document);
    renderAllAudience(state);
    setConn(true);
    const poll = setInterval(() => {
      if(!popupWin || popupWin.closed){ setConn(false); popupWin = null; clearInterval(poll); }
    }, 800);
  };

  document.getElementById("btnPreviewFullscreen").onclick = () => {
    if(previewFrame.requestFullscreen) previewFrame.requestFullscreen();
    else if(previewFrame.webkitRequestFullscreen) previewFrame.webkitRequestFullscreen();
  };

  document.getElementById("btnTimerStart").onclick = startOrResumeTimer;
  document.getElementById("btnTimerPause").onclick = pauseTimer;
  document.getElementById("btnTimerReset").onclick = resetTimer;
  document.getElementById("timerDurationInput").onchange = e => {
    setTimerDuration(parseInt(e.target.value,10));
  };

  document.getElementById("btnToggleSettings").onclick = () => {
    document.getElementById("settingsPanel").classList.toggle("open");
  };
  document.getElementById("maxWrongInput").onchange = (e) => {
    let v = parseInt(e.target.value, 10);
    if(isNaN(v) || v < 1) v = 1;
    if(v > 12) v = 12;
    state.maxWrong = v;
    e.target.value = v;
    renderHost(); renderAllAudience(state);
  };
  document.getElementById("showHintInput").onchange = (e) => {
    state.showCategoryHint = e.target.checked;
    renderAllAudience(state);
  };
  document.getElementById("btnAddCategory").onclick = () => {
    const input = document.getElementById("newCategoryName");
    const name = input.value.trim();
    if(!name) return;
    if(!state.categories[name]) state.categories[name] = [];
    input.value = "";
    saveCategories();
    renderHost();
  };
  document.getElementById("btnAddPhrase").onclick = () => {
    const cat = document.getElementById("phraseCategorySelect").value;
    const input = document.getElementById("newPhraseText");
    const phrase = input.value.trim().toUpperCase();
    if(!cat || !phrase) return;
    state.categories[cat].push(phrase);
    input.value = "";
    saveCategories();
    renderHost();
  };
  document.getElementById("btnUseCustom").onclick = () => {
    const input = document.getElementById("customPhraseInput");
    const phrase = input.value.trim().toUpperCase();
    if(!phrase) return;
    selectPhrase("Custom", phrase);
    input.value = "";
  };
  document.getElementById("btnStartRound").onclick = startRound;
  document.getElementById("btnResetRound").onclick = resetRound;
  document.getElementById("btnRevealOnly").onclick = revealWordOnly;
  document.getElementById("btnRevealEnd").onclick = revealEnd;

  document.getElementById("btnToggleFormatHelp").onclick = () => {
    document.getElementById("formatHelpBody").classList.toggle("open");
  };
  document.getElementById("btnDownloadExample").onclick = () => {
    downloadTextFile("hangman-wordlist-example.txt", EXAMPLE_TXT);
  };
  document.getElementById("btnExportTxt").onclick = () => {
    downloadTextFile("hangman-wordlist.txt", categoriesToTxt(state.categories));
  };

  let pendingImport = null;
  const importModal = document.getElementById("importModal");
  const txtInput = document.getElementById("txtImportInput");

  txtInput.onchange = (e) => {
    const file = e.target.files[0];
    if(!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const { categories, errors } = parseCategoriesTxt(String(reader.result));
      pendingImport = categories;
      const names = Object.keys(categories);
      const totalPhrases = names.reduce((s,n)=>s+categories[n].length,0);
      const summary = document.getElementById("importSummary");
      const errBox = document.getElementById("importErrors");
      if(names.length === 0){
        summary.textContent = "No valid categories could be read from this file — nothing to import.";
        document.getElementById("btnImportReplace").disabled = true;
        document.getElementById("btnImportAdd").disabled = true;
      } else {
        summary.textContent = `Found ${names.length} categor${names.length===1?"y":"ies"} with ${totalPhrases} phrases total. What would you like to do?`;
        document.getElementById("btnImportReplace").disabled = false;
        document.getElementById("btnImportAdd").disabled = false;
      }
      errBox.innerHTML = errors.length ? ("⚠ " + errors.join("<br>⚠ ")) : "";
      importModal.classList.add("show");
    };
    reader.readAsText(file);
    txtInput.value = "";
  };

  document.getElementById("btnImportReplace").onclick = () => {
    if(!pendingImport || !Object.keys(pendingImport).length) return;
    state.categories = pendingImport;
    state.selectedCategory = null;
    state.selectedPhrase = null;
    saveCategories();
    importModal.classList.remove("show");
    renderHost(); renderAllAudience(state);
  };
  document.getElementById("btnImportAdd").onclick = () => {
    if(!pendingImport || !Object.keys(pendingImport).length) return;
    Object.keys(pendingImport).forEach(name => {
      state.categories[name] = (state.categories[name] || []).concat(pendingImport[name]);
    });
    saveCategories();
    importModal.classList.remove("show");
    renderHost(); renderAllAudience(state);
  };
  document.getElementById("btnImportCancel").onclick = () => {
    importModal.classList.remove("show");
  };

  window.addEventListener("keydown", (e) => {
    const tag = document.activeElement.tagName;
    if(tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
    if(/^[a-zA-Z]$/.test(e.key)) guessLetter(e.key);
  });
}

if(document.readyState === "loading"){
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
