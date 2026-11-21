// DOM user interface: title, HUD, minimap, dialogue, offers, journal, pause/settings, toasts.
export const $ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector(sel) as T;
const h = (tag: string, cls = '', html = '') => { const e = document.createElement(tag); if (cls) e.className = cls; if (html) e.innerHTML = html; return e; };
export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

export interface DialogueInfo { name: string; occupation: string; mood: string; relationship: number; knownAs: string | null; status: string; initials: string; color: string; aiLabel: string }
export interface OfferCard { id: string; title: string; detail: string; accept: string; decline?: string; onAccept: () => void; onDecline?: () => void }
export interface QuickAction { label: string; run: () => void; primary?: boolean }

const MOOD_EMOJI: Record<string, string> = { ecstatic: '🤩', happy: '😄', content: '🙂', neutral: '😐', tired: '🥱', annoyed: '😒', upset: '😟', angry: '😠', scared: '😨' };

export class UI {
  root: HTMLElement;
  onSend: (text: string) => void = () => {};
  onCloseDialogue: () => void = () => {};
  private bubblePool: HTMLElement[] = [];
  private toastsEl: HTMLElement;
  private dialogueOpen = false;
  private recognition: { start(): void; stop(): void; onresult: ((e: { results: { 0: { transcript: string } }[] }) => void) | null; onend: (() => void) | null; lang: string } | null = null;
  tts = false;

  constructor() {
    this.root = $('#ui');
    this.toastsEl = $('#toasts');
    const input = $<HTMLInputElement>('#dlg-input');
    $('#dlg-form').addEventListener('submit', (e) => { e.preventDefault(); const v = input.value.trim(); if (v) { input.value = ''; this.onSend(v); } });
    $('#dlg-close').addEventListener('click', () => this.onCloseDialogue());
    input.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); this.onCloseDialogue(); } });
    const SR = (window as unknown as { SpeechRecognition?: new () => UI['recognition']; webkitSpeechRecognition?: new () => UI['recognition'] });
    const Ctor = SR.SpeechRecognition ?? SR.webkitSpeechRecognition;
    const mic = $('#dlg-mic');
    if (Ctor) {
      mic.addEventListener('click', () => {
        if (!this.recognition) {
          this.recognition = new Ctor()!;
          this.recognition!.lang = 'en-US';
          this.recognition!.onresult = (e) => { const t = e.results[0][0].transcript; input.value = t; mic.classList.remove('on'); this.onSend(t); input.value = ''; };
          this.recognition!.onend = () => mic.classList.remove('on');
        }
        mic.classList.add('on');
        this.recognition!.start();
      });
    } else mic.style.display = 'none';
  }

  // ---- title -----------------------------------------------------------------
  showTitle(hasSave: boolean, onNew: () => void, onContinue: () => void, onSettings: () => void) {
    const t = $('#title');
    t.style.display = 'flex';
    document.body.classList.add('title-mode');
    const hide = () => document.body.classList.remove('title-mode');
    const cont = $<HTMLButtonElement>('#btn-continue');
    cont.style.display = hasSave ? '' : 'none';
    $('#btn-new').onclick = () => { t.style.display = 'none'; hide(); onNew(); };
    cont.onclick = () => { t.style.display = 'none'; hide(); onContinue(); };
    $('#btn-title-settings').onclick = () => { hide(); t.style.display = 'none'; onSettings(); };
  }
  setLoading(text: string | null) { const l = $('#loading'); l.style.display = text ? 'flex' : 'none'; if (text) $('#loading-text').textContent = text; }

  // ---- HUD -------------------------------------------------------------------
  hud(d: { clock: string; money: number; health: number; stamina: number; heat: number; objective: string; ai: string; cost: string; location: string; speed?: number; business?: string }) {
    $('#hud-clock').textContent = d.clock;
    $('#hud-money').textContent = `$${d.money.toLocaleString()}`;
    ($('#hud-health') as HTMLElement).style.width = `${Math.max(0, d.health)}%`;
    ($('#hud-stamina') as HTMLElement).style.width = `${d.stamina}%`;
    $('#hud-heat').innerHTML = d.heat > 0.05 ? '★'.repeat(Math.ceil(d.heat)) + '<span class="dim">' + '★'.repeat(5 - Math.ceil(d.heat)) + '</span>' : '';
    $('#hud-objective').innerHTML = d.objective;
    $('#hud-objective').style.display = d.objective ? '' : 'none';
    $('#hud-ai').innerHTML = d.ai;
    $('#hud-cost').textContent = d.cost;
    $('#hud-location').textContent = d.location;
    const sp = $('#hud-speed');
    sp.style.display = d.speed !== undefined ? '' : 'none';
    if (d.speed !== undefined) sp.innerHTML = `${Math.round(Math.abs(d.speed) * 3.6 * 0.621)}<small> mph</small>`;
  }
  prompt(html: string | null) { const p = $('#prompt'); p.style.display = html ? '' : 'none'; if (html) p.innerHTML = html; }

  toast(text: string, kind: 'info' | 'good' | 'bad' | 'ai' = 'info', ms = 4200) {
    const t = h('div', `toast ${kind}`, text);
    this.toastsEl.appendChild(t);
    setTimeout(() => t.classList.add('out'), ms);
    setTimeout(() => t.remove(), ms + 500);
    while (this.toastsEl.children.length > 5) this.toastsEl.firstElementChild?.remove();
  }

  bigMessage(title: string, sub: string, ms = 3000) {
    const b = $('#big');
    b.innerHTML = `<div class="big-title">${title}</div><div class="big-sub">${sub}</div>`;
    b.classList.add('show');
    setTimeout(() => b.classList.remove('show'), ms);
  }

  // ---- bubbles / name tags ---------------------------------------------------
  bubbles(list: { x: number; y: number; text?: string; name?: string; scale: number; talking?: boolean }[]) {
    const host = $('#bubbles');
    while (this.bubblePool.length < list.length) { const e = h('div', 'bubble'); host.appendChild(e); this.bubblePool.push(e); }
    this.bubblePool.forEach((e, i) => {
      const b = list[i];
      if (!b) { e.style.display = 'none'; return; }
      e.style.display = '';
      e.style.transform = `translate(${b.x}px, ${b.y}px) translate(-50%, -100%) scale(${b.scale})`;
      const html = (b.text ? `<div class="say">${esc(b.text)}</div>` : '') + (b.name ? `<div class="tag">${esc(b.name)}</div>` : '');
      if (e.dataset.h !== html) { e.innerHTML = html; e.dataset.h = html; }
    });
  }

  // ---- dialogue --------------------------------------------------------------
  get isDialogueOpen() { return this.dialogueOpen; }
  openDialogue(info: DialogueInfo, history: { role: 'player' | 'npc'; text: string }[], npcFirst: string) {
    this.dialogueOpen = true;
    $('#dialogue').classList.add('open');
    this.updateDialogueHeader(info);
    const log = $('#dlg-log');
    log.innerHTML = '';
    for (const m of history.slice(-10)) this.addMessage(m.role, m.text, npcFirst, '', true);
    if (history.length) log.appendChild(h('div', 'sep', '— earlier —'));
    this.setOffers([]);
    setTimeout(() => $<HTMLInputElement>('#dlg-input').focus(), 30);
  }
  updateDialogueHeader(info: DialogueInfo) {
    $('#dlg-avatar').textContent = info.initials;
    ($('#dlg-avatar') as HTMLElement).style.background = info.color;
    $('#dlg-name').textContent = info.name;
    $('#dlg-occ').textContent = info.occupation;
    $('#dlg-status').textContent = info.status;
    $('#dlg-mood').innerHTML = `${MOOD_EMOJI[info.mood] ?? '🙂'} ${info.mood}`;
    $('#dlg-known').textContent = info.knownAs ? `Knows you as “${info.knownAs}”` : 'Doesn’t know your name';
    const rel = info.relationship;
    const bar = $('#dlg-rel-bar') as HTMLElement;
    bar.style.width = `${Math.abs(rel) / 2}%`;
    bar.style.left = rel >= 0 ? '50%' : `${50 - Math.abs(rel) / 2}%`;
    bar.style.background = rel >= 0 ? 'var(--good)' : 'var(--bad)';
    $('#dlg-rel-label').textContent = `Relationship ${rel > 0 ? '+' : ''}${rel}`;
    $('#dlg-ai').innerHTML = info.aiLabel;
  }
  addMessage(role: 'player' | 'npc' | 'system', text: string, npcFirst: string, meta = '', silent = false) {
    const log = $('#dlg-log');
    const m = h('div', `msg ${role}`);
    m.innerHTML = role === 'system' ? `<span>${text}</span>` : `<b>${role === 'player' ? 'You' : esc(npcFirst)}</b><span>${esc(text)}</span>${meta ? `<i>${meta}</i>` : ''}`;
    log.appendChild(m);
    log.scrollTop = log.scrollHeight;
    if (role === 'npc' && !silent && this.tts && 'speechSynthesis' in window) {
      const u = new SpeechSynthesisUtterance(text);
      const voices = speechSynthesis.getVoices();
      if (voices.length) u.voice = voices[npcFirst.length % voices.length];
      u.rate = 1.05;
      speechSynthesis.cancel();
      speechSynthesis.speak(u);
    }
  }
  setThinking(on: boolean) { $('#dlg-thinking').style.display = on ? '' : 'none'; $<HTMLInputElement>('#dlg-input').disabled = on; if (!on) $<HTMLInputElement>('#dlg-input').focus(); }
  setSuggestions(list: string[]) {
    const s = $('#dlg-suggest');
    s.innerHTML = '';
    for (const t of list) { const b = h('button', 'chip', esc(t)); b.onclick = () => this.onSend(t); s.appendChild(b); }
  }
  setQuickActions(list: QuickAction[]) {
    const q = $('#dlg-quick');
    q.innerHTML = '';
    for (const a of list) { const b = h('button', a.primary ? 'qa primary' : 'qa', esc(a.label)); b.onclick = a.run; q.appendChild(b); }
  }
  setOffers(cards: OfferCard[]) {
    const host = $('#dlg-offers');
    host.innerHTML = '';
    for (const c of cards) {
      const e = h('div', 'offer', `<div class="offer-title">${esc(c.title)}</div><div class="offer-detail">${esc(c.detail)}</div>`);
      const row = h('div', 'offer-row');
      const a = h('button', 'qa primary', esc(c.accept)); a.onclick = () => { c.onAccept(); e.remove(); };
      const d = h('button', 'qa', esc(c.decline ?? 'No thanks')); d.onclick = () => { c.onDecline?.(); e.remove(); };
      row.append(a, d); e.appendChild(row); host.appendChild(e);
    }
    host.scrollIntoView?.({ block: 'nearest' });
  }
  addOffer(c: OfferCard) {
    const host = $('#dlg-offers');
    const e = h('div', 'offer', `<div class="offer-title">${esc(c.title)}</div><div class="offer-detail">${esc(c.detail)}</div>`);
    const row = h('div', 'offer-row');
    const a = h('button', 'qa primary', esc(c.accept)); a.onclick = () => { c.onAccept(); e.remove(); };
    const d = h('button', 'qa', esc(c.decline ?? 'No thanks')); d.onclick = () => { c.onDecline?.(); e.remove(); };
    row.append(a, d); e.appendChild(row); host.appendChild(e);
  }
  closeDialogue() {
    this.dialogueOpen = false;
    $('#dialogue').classList.remove('open');
    $<HTMLInputElement>('#dlg-input').blur();
    if ('speechSynthesis' in window) speechSynthesis.cancel();
  }

  // ---- panels ----------------------------------------------------------------
  showPanel(id: 'pause' | 'journal' | null) {
    for (const p of ['pause', 'journal']) $('#' + p).classList.toggle('open', p === id);
  }
  panelOpen() { return $('#pause').classList.contains('open') || $('#journal').classList.contains('open'); }
  setJournal(html: string) { $('#journal-body').innerHTML = html; }
  setCosts(html: string) { $('#cost-body').innerHTML = html; }
  fade(on: boolean) { $('#fade').classList.toggle('on', on); }
}
