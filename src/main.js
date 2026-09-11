import './style.css'

const app = document.querySelector('#app')
const state = { username: '', room: null, error: '', selectedColor: null }
const soundState = { context: null, lastTurn: null, lastUnoCall: null, lastPenalty: null, resultPlayed: false, toastTimer: null }
const CONNECTING_ERROR = 'Still connecting to the game server. Try again in a moment.'
const MODE_COPY = {
  roogulation: 'A +2 or +4 lands on the next player instantly and skips their turn. In a two-player game you play again.',
  regulation: 'A +2 or +4 lands on the next player instantly, then they take their turn as normal.'
}
const socketProtocol = window.location.protocol === 'https:' ? 'wss' : 'ws'
const socketUrl = import.meta.env.VITE_WS_URL || `${socketProtocol}://${window.location.hostname}:3001`
const socket = new WebSocket(socketUrl)

state.username = getCookie('runo_username')
renderCurrent()
socket.addEventListener('open', () => { if (state.error === CONNECTING_ERROR) { state.error = ''; renderCurrent() } })
socket.addEventListener('message', ({ data }) => {
  const message = JSON.parse(data)
  if (message.type === 'error') {
    state.error = message.message
    if (state.room?.status === 'playing') { playRejectSound(); clearTimeout(soundState.toastTimer); soundState.toastTimer = setTimeout(() => { state.error = ''; document.querySelector('.toast')?.classList.remove('show') }, 2600) }
    renderCurrent(); return
  }
  if (message.type !== 'room') return
  const room = message.room
  state.room = room
  state.error = ''
  if (room.status === 'playing') soundState.resultPlayed = false
  if (state.selectedColor !== null && (room.currentPlayer !== room.me || room.hand[state.selectedColor]?.color !== 'wild')) state.selectedColor = null
  if (room.lastUnoCall && room.lastUnoCall.nonce !== soundState.lastUnoCall) { soundState.lastUnoCall = room.lastUnoCall.nonce; playUnoSound() }
  if (room.lastPenalty && room.lastPenalty.nonce !== soundState.lastPenalty) { soundState.lastPenalty = room.lastPenalty.nonce; playDrawSound() }
  renderCurrent()
})
socket.addEventListener('close', () => { state.error = 'Connection lost. Refresh to reconnect.'; renderCurrent() })

function send(type, payload = {}) {
  if (socket.readyState !== WebSocket.OPEN) { state.error = socket.readyState === WebSocket.CONNECTING ? CONNECTING_ERROR : 'Connection lost. Refresh to reconnect.'; renderCurrent(); return }
  socket.send(JSON.stringify({ type, ...payload }))
}
function unlockAudio() { if (!soundState.context) { const AudioContext = window.AudioContext || window.webkitAudioContext; if (!AudioContext) return; soundState.context = new AudioContext() } if (soundState.context.state === 'suspended') soundState.context.resume() }
function playTone(frequency, duration, type = 'sine', volume = 0.045, offset = 0, glideTo = 0) {
  const context = soundState.context
  if (!context) return
  if (context.state === 'suspended') { context.resume().then(() => playTone(frequency, duration, type, volume, offset, glideTo)); return }
  if (context.state !== 'running') return
  const start = context.currentTime + offset
  const oscillator = context.createOscillator()
  const gain = context.createGain()
  oscillator.type = type
  oscillator.frequency.setValueAtTime(frequency, start)
  if (glideTo) oscillator.frequency.exponentialRampToValueAtTime(glideTo, start + duration)
  gain.gain.setValueAtTime(0.0001, start)
  gain.gain.exponentialRampToValueAtTime(volume, start + 0.012)
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration)
  oscillator.connect(gain); gain.connect(context.destination)
  oscillator.start(start); oscillator.stop(start + duration + 0.02)
}
function playTurnSound() { playTone(660, 0.12, 'sine', 0.035); playTone(880, 0.16, 'sine', 0.03, 0.1) }
function playRejectSound() { playTone(170, 0.13, 'square', 0.035); playTone(115, 0.16, 'square', 0.025, 0.08) }
function playPlaceSound() { playTone(330, 0.08, 'triangle', 0.04); playTone(520, 0.16, 'triangle', 0.035, 0.06) }
function playDrawSound() { playTone(240, 0.08, 'sine', 0.03); playTone(180, 0.13, 'sine', 0.025, 0.07) }
function playUnoSound() { playTone(230, 0.08, 'sine', 0.035); playTone(185, 0.09, 'sine', 0.032, 0.075); playTone(145, 0.13, 'sine', 0.03, 0.15); playTone(245, 0.16, 'triangle', 0.035, 0.26) }
function playWinSound() {
  ;[523.25, 659.25, 783.99, 1046.5].forEach((note, index) => playTone(note, 0.19, 'triangle', 0.05, index * 0.095))
  playTone(1318.51, 0.55, 'triangle', 0.045, 0.4)
  ;[523.25, 659.25, 783.99, 1046.5].forEach((note) => { playTone(note, 0.34, 'sine', 0.032, 0.56); playTone(note, 0.5, 'sine', 0.03, 0.88) })
  ;[1567.98, 1760, 2093, 2349.32, 1975.53].forEach((note, index) => playTone(note, 0.11, 'sine', 0.02, 1.0 + index * 0.075))
  playTone(880, 0.7, 'triangle', 0.03, 1.4)
}
function playLoseSound() {
  ;[392, 369.99, 349.23, 329.63].forEach((note, index) => playTone(note, 0.27, 'sawtooth', 0.033, index * 0.17))
  playTone(196, 0.75, 'sawtooth', 0.032, 0.66, 155.56)
  playTone(155.56, 0.85, 'sine', 0.03, 0.7)
}
function renderAuth() {
  app.innerHTML = `<main class="auth-layout">
    <section class="brand-panel"><div class="brand-mark"><span>U</span></div><p class="eyebrow">THE QUICK-FIRE CARD ROOM</p><h1>UNO</h1><p class="intro">A bright, chaotic card table for your favorite people. Pick a name, grab a room, and let the cards decide the rest.</p><div class="mini-stack"><i class="card red">7</i><i class="card yellow">↻</i><i class="card blue">+2</i></div></section>
    <section class="auth-panel"><div class="panel-kicker">WELCOME TO THE TABLE</div><h2>Who’s playing?</h2><p class="muted">Your username appears to everyone in the room.</p><form id="name-form"><label>Display name<input id="username" maxlength="18" required placeholder="e.g. Skyler" autofocus></label><button class="primary wide">Continue <span>→</span></button></form>${state.error ? `<p class="error">${escapeHtml(state.error)}</p>` : ''}<p class="footnote">No password. No fuss. Just cards.</p></section>
  </main>`
  document.querySelector('#name-form').addEventListener('submit', (event) => { event.preventDefault(); unlockAudio(); state.username = document.querySelector('#username').value.trim(); if (state.username) { setCookie('runo_username', state.username, 365); renderLobby() } })
}
function renderLobby() {
  app.innerHTML = `<main class="lobby-layout"><header class="topbar"><div class="wordmark"><span class="dot"></span> UNO</div><div class="profile"><span class="avatar">${initials(state.username)}</span>${escapeHtml(state.username)}</div></header><section class="lobby-content"><div class="lobby-heading"><div><p class="eyebrow">PRIVATE CARD ROOMS</p><h1>Ready when you are.</h1><p class="muted">Create a room for your crew or enter a code to jump in.</p></div><div class="spark">✦</div></div><div class="room-actions"><form class="room-card create" id="create-form"><div class="room-icon">✦</div><h3>Host a new game</h3><p>Make a room, share the code, and deal the first hand.</p><button class="primary">Create room <span>↗</span></button></form><form class="room-card join" id="join-form"><div class="room-icon">⌁</div><h3>Join your friends</h3><p>Have a room code? You’re one shuffle away.</p><label>Room code<input id="room-code" maxlength="5" placeholder="e.g. A7K2Q" required></label><button class="secondary">Join room <span>→</span></button></form></div>${state.error ? `<p class="error">${escapeHtml(state.error)}</p>` : ''}<div class="lobby-tip"><span>✎</span><div><strong>How it works</strong><br>Each room deals a fresh randomized deck. Call UNO before you play your last card, or draw three.</div></div></section></main>`
  document.querySelector('#create-form').addEventListener('submit', (event) => { event.preventDefault(); unlockAudio(); send('createRoom', { username: state.username }) })
  document.querySelector('#join-form').addEventListener('submit', (event) => { event.preventDefault(); unlockAudio(); send('joinRoom', { username: state.username, code: document.querySelector('#room-code').value.toUpperCase() }) })
}
function renderRoom() {
  const room = state.room
  soundState.lastTurn = null
  app.innerHTML = `<main class="room-layout"><header class="topbar"><div class="wordmark"><span class="dot"></span> UNO <span class="live-pill">● LIVE ROOM</span></div><button class="ghost" id="leave">Leave room</button></header><section class="waiting"><div class="waiting-copy"><p class="eyebrow">ROOM READY</p><h1>Bring your people<br><em>to the table.</em></h1><p class="muted">Share this code with anyone you want to play with.</p><div class="code-display"><span>${room.code}</span><button id="copy" title="Copy room code">▣</button></div><p class="copy-status" id="copy-status">Anyone with the code can join. If the host leaves, the game ends.</p></div><div class="players-card"><div class="card-title"><span>PLAYERS <b>${room.players.length}/6</b></span><span class="pulse">● open</span></div><div class="player-list">${room.players.map((player) => `<div class="player-row"><span class="avatar ${player.isHost ? 'host' : ''}">${initials(player.name)}</span><span>${escapeHtml(player.name)}${player.isHost ? '<small>HOST</small>' : ''}</span><span class="ready-dot">●</span></div>`).join('')}</div><div class="settings-panel"><div class="settings-heading"><span>GAME SETTINGS</span><small>${room.isHost ? 'HOST CONTROLS' : 'HOST CONFIGURED'}</small></div>${modeRow(room)}${settingRow('cardSuggestions', 'Card suggestions', 'Highlight only cards that can be played.', room)}${settingRow('cardStacking', 'Card stacking', 'Stack +2 and +4 penalties instead of drawing right away.', room)}${settingRow('deckCardShows', 'Deck card shows', 'Reveal the next card in the draw pile.', room)}</div>${room.isHost ? `<button class="primary wide" id="start" ${room.players.length < 2 ? 'disabled' : ''}>Start game <span>→</span></button>` : '<div class="waiting-note">Waiting for the host to start...</div>'}</div></section></main>`
  document.querySelector('#leave').addEventListener('click', () => { unlockAudio(); leaveToLobby() })
  document.querySelector('#copy').addEventListener('click', async () => { await navigator.clipboard?.writeText(room.code); document.querySelector('#copy-status').textContent = 'Room code copied to clipboard.' })
  document.querySelectorAll('[data-setting]').forEach((input) => input.addEventListener('change', () => send('updateSettings', { settings: { [input.dataset.setting]: input.checked } })))
  document.querySelectorAll('[data-mode]').forEach((button) => button.addEventListener('click', () => { unlockAudio(); send('updateSettings', { settings: { gameMode: button.dataset.mode } }) }))
  document.querySelector('#start')?.addEventListener('click', () => { unlockAudio(); send('startGame') })
}
function renderGame() {
  const room = state.room
  const top = room.topCard
  const mine = room.currentPlayer === room.me
  if (soundState.lastTurn !== room.currentPlayer) { if (mine) playTurnSound(); soundState.lastTurn = room.currentPlayer }
  const opponents = room.players.filter((player) => player.id !== room.me)
  app.innerHTML = `<main class="game-layout"><header class="topbar"><div class="wordmark"><span class="dot"></span> UNO <span class="game-code">ROOM ${room.code}</span><span class="mode-pill">${room.settings.gameMode === 'regulation' ? 'REGULATION' : 'ROOGULATION'}</span></div><div class="game-tools"><span class="turn-label">${mine ? 'YOUR TURN' : `${escapeHtml(room.currentPlayerName || '')}'S TURN`}</span><button class="ghost" id="leave">Exit</button></div></header><section class="table"><div class="table-head"><div><p class="eyebrow">ROUND ${room.round}</p><h1>${mine ? 'Make your move.' : `${escapeHtml(room.currentPlayerName || 'Someone')} is thinking...`}</h1></div><div class="turn-order"><span class="turn-direction" title="${room.direction === -1 ? 'Play is reversed' : 'Play goes clockwise'}">${room.direction === -1 ? '⟲' : '⟳'}</span>${room.players.map((player) => `<span class="turn-avatar ${player.id === room.currentPlayer ? 'active' : ''} ${player.left ? 'gone' : ''}" title="${escapeHtml(player.name)}${player.left ? ' (left)' : ''}">${initials(player.name)}</span>`).join('')}</div></div>${banners(room)}<div class="opponent-rail">${opponents.map((player) => opponentPanel(player, room)).join('')}</div><div class="play-zone"><div class="deck-stack">${deckButton(room)}<small class="deck-label">${room.deckCount} cards left</small></div><div class="top-card-wrap"><div class="card face ${top.color}"><strong>${top.value}</strong><span>${symbol(top.value)}</span><b>${top.value}</b></div><small class="active-color"><i class="${room.activeColor}"></i> ${room.activeColor} is active</small></div></div><div class="hand-area"><div class="hand-heading"><span>YOUR HAND <b>${room.hand.length}</b></span>${mine ? '<small>Choose a matching color or wild card</small>' : '<small>Hang tight for your turn</small>'}</div>${unoButton(room)}<div class="hand">${room.hand.map((card, index) => cardButton(card, index, room)).join('')}</div></div></section>${state.selectedColor !== null ? colorPicker() : ''}<div class="toast ${state.error ? 'show' : ''}">${escapeHtml(state.error || '')}</div></main>`
  document.querySelector('#leave').addEventListener('click', () => { unlockAudio(); leaveToLobby() })
  document.querySelector('#draw').addEventListener('click', () => { unlockAudio(); playDrawSound(); send('drawCard') })
  document.querySelector('#yell-uno')?.addEventListener('click', () => { unlockAudio(); send('yellUno') })
  document.querySelectorAll('[data-card]').forEach((button) => button.addEventListener('click', () => {
    unlockAudio()
    const index = Number(button.dataset.card)
    const card = room.hand[index]
    if (!canPlay(card, room)) { playRejectSound(); return }
    if (card.color === 'wild') { state.selectedColor = index; renderGame() }
    else { playPlaceSound(); send('playCard', { index }) }
  }))
  document.querySelectorAll('[data-color]').forEach((button) => button.addEventListener('click', () => { unlockAudio(); playPlaceSound(); const index = state.selectedColor; state.selectedColor = null; send('playCard', { index, color: button.dataset.color }) }))
  document.querySelector('#cancel-color')?.addEventListener('click', () => { state.selectedColor = null; renderGame() })
}
function banners(room) {
  const parts = []
  if (room.lastUnoCall) parts.push(`<div class="table-banner uno-call-banner"><strong>UNO!</strong> ${escapeHtml(room.lastUnoCall.playerName)} called it.</div>`)
  const penalty = room.lastPenalty
  if (penalty) {
    const who = penalty.playerId === room.me ? 'You' : escapeHtml(penalty.playerName)
    const verb = penalty.playerId === room.me ? 'drew' : 'drew'
    if (penalty.reason === 'uno') parts.push(`<div class="table-banner penalty-banner">${who} forgot to call UNO and ${verb} <strong>3 cards</strong>.</div>`)
    else if (penalty.reason === 'stack') parts.push(`<div class="table-banner penalty-banner">${who} ${verb} the stacked <strong>${penalty.amount} cards</strong>.</div>`)
    else parts.push(`<div class="table-banner penalty-banner">${escapeHtml(penalty.byName || '')} played a ${penalty.reason} — ${who.toLowerCase() === 'you' ? 'you' : who} ${verb} <strong>${penalty.amount} cards</strong>.</div>`)
  }
  if (room.pendingDraw) parts.push(`<div class="table-banner penalty-banner live">STACKED PENALTY <strong>${room.pendingDraw} cards</strong> · play another +2/+4 or draw them</div>`)
  return parts.length ? `<div class="banner-rail">${parts.join('')}</div>` : ''
}
function unoButton(room) {
  if (!room.canCallUno && !(room.unoCalled && room.hand.length === 1)) return ''
  const called = room.unoCalled
  return `<button class="uno-button ${called ? 'called' : ''}" id="yell-uno" ${called ? 'disabled' : ''}>${called ? 'UNO CALLED' : 'YELL UNO'}</button>`
}
function settingRow(key, title, description, room) { return `<label class="setting-row"><span><strong>${title}</strong><small>${description}</small></span><input type="checkbox" data-setting="${key}" ${room.settings[key] ? 'checked' : ''} ${room.isHost ? '' : 'disabled'}><i></i></label>` }
function modeRow(room) {
  const mode = room.settings.gameMode === 'regulation' ? 'regulation' : 'roogulation'
  const option = (value, label) => `<button type="button" class="${mode === value ? 'active' : ''}" data-mode="${value}" ${room.isHost ? '' : 'disabled'}>${label}</button>`
  return `<div class="setting-row mode-row"><span><strong>Game mode</strong><small>${MODE_COPY[mode]}</small></span><div class="mode-toggle">${option('roogulation', 'Roogulation')}${option('regulation', 'Regulation')}</div></div>`
}
function opponentPanel(player, room) {
  if (player.left) return `<div class="opponent-panel gone"><div class="opponent-label"><span class="avatar">${initials(player.name)}</span><div><strong>${escapeHtml(player.name)}</strong><small>Left the game — skipped</small></div></div></div>`
  const count = player.cardCount
  const step = Math.max(18, Math.min(58, Math.round(360 / Math.max(1, count - 1))))
  const backs = Array.from({ length: count }, () => '<i></i>').join('')
  return `<div class="opponent-panel ${room.currentPlayer === player.id ? 'active' : ''}"><div class="opponent-label"><span class="avatar">${initials(player.name)}</span><div><strong>${escapeHtml(player.name)}</strong><small>${count} ${count === 1 ? 'card' : 'cards'}${count === 1 ? ' · UNO' : ''}</small></div></div><div class="opponent-cards"><div class="opponent-cards-inner" style="--step:${step}px">${backs}</div></div></div>`
}
function deckButton(room) {
  const disabled = room.currentPlayer !== room.me ? 'disabled' : ''
  const drawText = room.pendingDraw ? `DRAW ${room.pendingDraw}` : 'DRAW'
  if (room.settings.deckCardShows && room.deckPreview) return `<button class="deck deck-preview ${room.deckPreview.color}" id="draw" ${disabled}><strong>${room.deckPreview.value}</strong><span>${symbol(room.deckPreview.value)}</span><b>${room.deckPreview.value}</b></button>`
  return `<button class="deck" id="draw" ${disabled}><span>UNO</span><b>7</b><small>${drawText}</small></button>`
}
function cardButton(card, index, room) {
  const playable = canPlay(card, room)
  const highlighted = room.settings.cardSuggestions ? playable : true
  return `<button class="card hand-card ${card.color} ${highlighted ? 'playable' : 'muted-card'}" data-card="${index}" ${room.currentPlayer !== room.me ? 'disabled' : ''}><strong>${card.value}</strong><span>${symbol(card.value)}</span><b>${card.value}</b></button>`
}
function colorPicker() { return `<div class="color-picker"><p>Choose a color</p><button data-color="red">RED</button><button data-color="yellow">YELLOW</button><button data-color="green">GREEN</button><button data-color="blue">BLUE</button><button class="cancel-color" id="cancel-color" title="Cancel">✕</button></div>` }
function canPlay(card, room) {
  if (!card) return false
  if (room.pendingDraw) return room.settings.cardStacking && (card.value === '+2' || card.value === '+4')
  return card.color === 'wild' || card.color === room.activeColor || card.value === room.topCard.value
}
function resultCopy(room) {
  const won = room.winnerId && room.winnerId === room.me
  if (room.endedReason === 'host-left') return { won: false, art: '🚪', title: 'The host left.', body: 'This table closed when the host walked away. Start a new room to play again.', badge: 'GAME ENDED' }
  if (won && room.endedReason === 'last-standing') return { won: true, art: '🎉', title: 'Last one standing!', body: 'Everyone else left the table, so the round is yours.', badge: 'WINNER' }
  if (won) return { won: true, art: '🎉', title: 'Shrimply brilliant!', body: 'You cleared your hand and ruled the table.', badge: 'WINNER' }
  if (!room.winnerName) return { won: false, art: '🥀', title: 'Game over.', body: 'The table emptied out before anyone could win.', badge: 'GAME ENDED' }
  return { won: false, art: '🥀', title: 'Tough break.', body: `${room.winnerName} took the win this round.`, badge: 'BETTER LUCK NEXT ROUND' }
}
function renderResult() {
  const room = state.room
  const result = resultCopy(room)
  unlockAudio()
  if (!soundState.resultPlayed) { if (result.won) playWinSound(); else playLoseSound(); soundState.resultPlayed = true }
  app.innerHTML = `<main class="result-screen ${result.won ? 'winner' : 'loser'}"><div class="result-card"><div class="result-art">${result.art}</div><p class="eyebrow">GAME OVER</p><h1>${result.title}</h1><p>${escapeHtml(result.body)}</p><div class="result-badge">${result.badge}</div><button class="primary" id="result-exit">Back to lobby <span>→</span></button></div></main>`
  document.querySelector('#result-exit').addEventListener('click', () => { unlockAudio(); leaveToLobby() })
}
function leaveToLobby() { soundState.resultPlayed = false; soundState.lastTurn = null; state.selectedColor = null; state.room = null; state.error = ''; send('leave'); renderLobby() }
function renderCurrent() {
  if (!state.username) renderAuth()
  else if (!state.room) renderLobby()
  else if (state.room.status === 'waiting') renderRoom()
  else if (state.room.status === 'finished') renderResult()
  else renderGame()
}
function initials(name) { return String(name || '').trim().split(/\s+/).filter(Boolean).map((part) => part[0]).join('').slice(0, 2).toUpperCase() || '?' }
function symbol(value) { return value === 'SKIP' ? '⊘' : value === 'REVERSE' ? '↻' : value === '+2' || value === '+4' ? '+' : value === 'WILD' ? '✦' : value }
function setCookie(name, value, days) { document.cookie = `${name}=${encodeURIComponent(value)}; max-age=${days * 86400}; path=/; SameSite=Lax` }
function getCookie(name) { const match = document.cookie.split('; ').find((entry) => entry.startsWith(`${name}=`)); return match ? decodeURIComponent(match.split('=').slice(1).join('=')) : '' }
function escapeHtml(value) { return String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char])) }
