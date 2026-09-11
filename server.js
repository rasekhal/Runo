import { WebSocketServer } from 'ws'
import { randomInt } from 'node:crypto'

const rooms = new Map()
const clients = new Map()
const colors = ['red', 'yellow', 'green', 'blue']
const values = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'SKIP', 'REVERSE', '+2']
const MODES = ['roogulation', 'regulation']
const DEFAULT_SETTINGS = { gameMode: 'roogulation', cardSuggestions: false, cardStacking: false, deckCardShows: false }

function shuffle(deck) { for (let index = deck.length - 1; index > 0; index -= 1) { const swap = randomInt(index + 1); [deck[index], deck[swap]] = [deck[swap], deck[index]] } return deck }
function makeDeck() {
  const deck = []
  colors.forEach((color) => values.forEach((value, index) => { deck.push({ color, value }); if (index > 0) deck.push({ color, value }) }))
  for (let index = 0; index < 4; index += 1) { deck.push({ color: 'wild', value: 'WILD' }, { color: 'wild', value: '+4' }) }
  return shuffle(deck)
}
function code() { let value; do value = Math.random().toString(36).slice(2, 7).toUpperCase(); while (rooms.has(value)); return value }
function send(client, message) { if (client && client.readyState === 1) client.send(JSON.stringify(message)) }
function fail(client, message) { send(client, { type: 'error', message }) }
function nonce() { return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}` }
function seated(room) { return room.players.filter((player) => !player.left) }
function canCallUno(room, player) {
  if (!player || player.left || player.unoCalled || room.status !== 'playing') return false
  if (player.hand.length === 1) return true
  return player.hand.length === 2 && room.players[room.turn] === player
}
function roomView(room, client) {
  const me = room.players.find((player) => player.client === client)
  const current = room.players[room.turn]
  return {
    code: room.code, status: room.status, round: room.round, direction: room.direction, endedReason: room.endedReason,
    deckCount: room.deck.length, topCard: room.topCard, activeColor: room.activeColor,
    deckPreview: room.settings.deckCardShows ? room.deck[room.deck.length - 1] || null : null,
    pendingDraw: room.pendingDraw, settings: room.settings,
    currentPlayer: current && !current.left ? current.id : null,
    currentPlayerName: current && !current.left ? current.name : null,
    me: me?.id, isHost: room.host === me?.id, unoCalled: me?.unoCalled || false, canCallUno: canCallUno(room, me),
    lastUnoCall: room.lastUnoCall, lastPenalty: room.lastPenalty,
    winnerId: room.winnerId, winnerName: room.winnerName, hand: me?.hand || [],
    players: room.players.map((player) => ({ id: player.id, name: player.name, cardCount: player.hand.length, left: player.left, isHost: room.host === player.id }))
  }
}
function broadcast(room) { room.players.forEach((player) => { if (player.client) send(player.client, { type: 'room', room: roomView(room, player.client) }) }) }
function drawOne(room) {
  if (!room.deck.length) { room.deck = room.discard.length ? shuffle(room.discard) : makeDeck(); room.discard = [] }
  return room.deck.pop()
}
function drawCards(room, player, count) { for (let index = 0; index < count; index += 1) { const card = drawOne(room); if (card) player.hand.push(card) } }
function start(room) {
  room.players = room.players.filter((player) => player.client)
  room.deck = makeDeck(); room.discard = []
  room.players.forEach((player) => { player.hand = room.deck.splice(0, 7); player.unoCalled = false; player.left = false })
  room.topCard = room.deck.pop()
  while (room.topCard.color === 'wild') { room.deck.unshift(room.topCard); room.topCard = room.deck.pop() }
  room.activeColor = room.topCard.color; room.pendingDraw = 0; room.direction = 1; room.turn = 0; room.round += 1
  room.status = 'playing'; room.winnerId = null; room.winnerName = null; room.endedReason = null
  room.lastUnoCall = null; room.lastPenalty = null
  if (room.topCard.value === '+2') {
    if (room.settings.cardStacking) room.pendingDraw = 2
    else {
      const first = room.players[0]
      drawCards(room, first, 2)
      room.lastPenalty = { playerId: first.id, playerName: first.name, byName: 'The deal', amount: 2, reason: '+2', nonce: nonce() }
      if (room.settings.gameMode !== 'regulation') advance(room, 1)
    }
  }
  if (room.topCard.value === 'REVERSE') room.direction = -1
  if (room.topCard.value === 'SKIP') advance(room, 1)
}
function stepFrom(room, from, steps) {
  const count = room.players.length
  if (!count || !seated(room).length) return from
  let index = from
  for (let moved = 0; moved < steps;) { index = ((index + room.direction) % count + count) % count; if (!room.players[index].left) moved += 1 }
  return index
}
function advance(room, steps) { room.turn = stepFrom(room, room.turn, steps) }
function finish(room, winner, reason) {
  room.status = 'finished'; room.endedReason = reason
  room.winnerId = winner?.id || null; room.winnerName = winner?.name || null
  room.pendingDraw = 0
}
function onMessage(client, message) {
  const { type } = message
  if (type === 'createRoom') {
    leaveRoom(client)
    const room = { code: code(), status: 'waiting', players: [], host: client.id, turn: 0, direction: 1, round: 0, deck: [], discard: [], topCard: null, activeColor: null, pendingDraw: 0, lastUnoCall: null, lastPenalty: null, winnerId: null, winnerName: null, endedReason: null, settings: { ...DEFAULT_SETTINGS } }
    rooms.set(room.code, room); join(client, room, message.username); return
  }
  if (type === 'joinRoom') {
    const room = rooms.get(String(message.code || '').trim().toUpperCase())
    if (!room) return fail(client, 'That room code does not exist.')
    if (room.status !== 'waiting') return fail(client, 'That game has already started.')
    if (room.players.length >= 6) return fail(client, 'That room is full.')
    leaveRoom(client); join(client, room, message.username); return
  }
  const room = clients.get(client)?.room
  if (!room) return
  if (type === 'updateSettings') {
    if (room.host !== client.id || room.status === 'playing') return
    const incoming = message.settings || {}
    const next = { ...room.settings }
    for (const key of ['cardSuggestions', 'cardStacking', 'deckCardShows']) if (key in incoming) next[key] = Boolean(incoming[key])
    if ('gameMode' in incoming && MODES.includes(incoming.gameMode)) next.gameMode = incoming.gameMode
    room.settings = next; broadcast(room); return
  }
  if (type === 'startGame') { if (room.host !== client.id || room.status === 'playing' || room.players.filter((player) => player.client).length < 2) return; start(room); broadcast(room); return }
  if (type === 'drawCard') { drawTurn(room, client); return }
  if (type === 'yellUno') {
    const player = room.players.find((entry) => entry.client === client)
    if (!canCallUno(room, player)) return
    player.unoCalled = true
    room.lastUnoCall = { playerId: player.id, playerName: player.name, nonce: nonce() }
    broadcast(room); return
  }
  if (type === 'playCard') { playCard(room, client, message.index, message.color); return }
  if (type === 'leave') { leaveRoom(client); return }
}
function join(client, room, name) {
  const player = { id: client.id, name: String(name || 'Player').trim().slice(0, 18) || 'Player', client, hand: [], unoCalled: false, left: false }
  room.players.push(player); clients.set(client, { room }); broadcast(room)
}
function isTurn(room, client) { const current = room.players[room.turn]; return room.status === 'playing' && current && !current.left && current.client === client }
function drawTurn(room, client) {
  if (!isTurn(room, client)) return
  const player = room.players.find((entry) => entry.client === client)
  room.lastPenalty = null
  const penalty = room.pendingDraw
  drawCards(room, player, Math.max(1, penalty))
  room.pendingDraw = 0
  player.unoCalled = false
  if (room.lastUnoCall?.playerId === player.id) room.lastUnoCall = null
  if (penalty > 0) room.lastPenalty = { playerId: player.id, playerName: player.name, amount: penalty, reason: 'stack', nonce: nonce() }
  advance(room, 1)
  broadcast(room)
}
function playCard(room, client, index, chosenColor) {
  if (!isTurn(room, client)) return
  const player = room.players.find((entry) => entry.client === client)
  const cardIndex = Number(index)
  const card = player.hand[cardIndex]
  if (!card) return
  const isPenaltyCard = card.value === '+2' || card.value === '+4'
  if (room.pendingDraw > 0) {
    if (!room.settings.cardStacking) return fail(client, `You must draw ${room.pendingDraw} cards first.`)
    if (!isPenaltyCard) return fail(client, 'Only a +2 or +4 can be stacked on a penalty.')
  } else if (card.color !== 'wild' && card.color !== room.activeColor && card.value !== room.topCard.value) {
    return fail(client, 'That card does not match the color or value in play.')
  }
  if (card.color === 'wild' && !colors.includes(chosenColor)) return fail(client, 'Pick a color for that wild card.')
  room.lastPenalty = null
  const wasLastCard = player.hand.length === 1
  player.hand.splice(cardIndex, 1)
  if (room.topCard) room.discard.push(room.topCard)
  room.topCard = { ...card }
  room.activeColor = card.color === 'wild' ? chosenColor : card.color
  if (wasLastCard && !player.unoCalled) {
    drawCards(room, player, 3)
    room.lastPenalty = { playerId: player.id, playerName: player.name, amount: 3, reason: 'uno', nonce: nonce() }
  }
  if (player.hand.length > 1) player.unoCalled = false
  if (room.lastUnoCall?.playerId === player.id && player.hand.length !== 1) room.lastUnoCall = null
  if (!player.hand.length) { finish(room, player, 'win'); broadcast(room); return }
  const from = room.players.indexOf(player)
  if (card.value === 'REVERSE') room.direction *= -1
  let steps = card.value === 'SKIP' || (card.value === 'REVERSE' && seated(room).length === 2) ? 2 : 1
  if (isPenaltyCard) {
    const amount = card.value === '+4' ? 4 : 2
    if (room.settings.cardStacking) { room.pendingDraw += amount; steps = 1 }
    else {
      const targetIndex = stepFrom(room, from, 1)
      const target = room.players[targetIndex]
      if (target && target !== player) {
        drawCards(room, target, amount)
        target.unoCalled = false
        if (room.lastUnoCall?.playerId === target.id) room.lastUnoCall = null
        room.lastPenalty = { playerId: target.id, playerName: target.name, byName: player.name, amount, reason: card.value, nonce: nonce() }
      }
      steps = room.settings.gameMode === 'regulation' ? 1 : 2
    }
  }
  room.turn = stepFrom(room, from, steps)
  broadcast(room)
}
function leaveRoom(client) {
  const entry = clients.get(client)
  if (!entry) return
  const room = entry.room
  clients.delete(client)
  const index = room.players.findIndex((player) => player.client === client)
  if (index === -1) return
  const player = room.players[index]
  player.client = null
  if (room.lastUnoCall?.playerId === player.id) room.lastUnoCall = null
  const dropHand = () => { if (player.hand.length) { room.discard.push(...player.hand); player.hand = [] } player.unoCalled = false }
  const drained = () => { if (!room.players.some((entry) => entry.client)) { rooms.delete(room.code); return true } return false }

  if (room.host === player.id && room.status !== 'finished') {
    player.left = true; dropHand()
    finish(room, null, 'host-left')
    if (drained()) return
    broadcast(room); return
  }
  if (room.status === 'playing') {
    player.left = true; dropHand()
    const remaining = seated(room)
    if (remaining.length === 1) finish(room, remaining[0], 'last-standing')
    else if (!remaining.length) finish(room, null, 'empty')
    else if (room.turn === index) { room.pendingDraw = 0; room.turn = stepFrom(room, index, 1) }
    if (drained()) return
    broadcast(room); return
  }
  room.players.splice(index, 1)
  if (drained()) return
  if (room.host === player.id) room.host = room.players.find((entry) => entry.client)?.id || room.players[0].id
  broadcast(room)
}

const port = Number(process.env.PORT) || 3001
const wss = new WebSocketServer({ port })
wss.on('connection', (client) => {
  client.id = Math.random().toString(36).slice(2)
  client.on('message', (data) => { try { onMessage(client, JSON.parse(data.toString())) } catch { fail(client, 'Could not understand that move.') } })
  client.on('close', () => leaveRoom(client))
})
console.log(`UNO game server listening on ws://localhost:${port}`)
