import { WebSocketServer } from 'ws'
import { randomInt } from 'node:crypto'

const rooms = new Map()
const clients = new Map()
const colors = ['red', 'yellow', 'green', 'blue']
const values = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'SKIP', 'REVERSE', '+2']

function shuffle(deck) { for (let index = deck.length - 1; index > 0; index -= 1) { const swap = randomInt(index + 1); [deck[index], deck[swap]] = [deck[swap], deck[index]] } return deck }
function makeDeck() {
  const deck = []
  colors.forEach((color) => values.forEach((value, index) => { deck.push({ color, value }); if (index > 0) deck.push({ color, value }) }))
  for (let index = 0; index < 4; index += 1) { deck.push({ color: 'wild', value: 'WILD' }, { color: 'wild', value: '+4' }) }
  return shuffle(deck)
}
function code() { let value; do value = Math.random().toString(36).slice(2, 7).toUpperCase(); while (rooms.has(value)); return value }
function send(client, message) { if (client.readyState === 1) client.send(JSON.stringify(message)) }
function fail(client, message) { send(client, { type: 'error', message }) }
function roomView(room, client) {
  const me = room.players.find((player) => player.client === client)
  return { code: room.code, status: room.status, round: room.round, direction: room.direction, deckCount: room.deck.length, topCard: room.topCard, activeColor: room.activeColor, deckPreview: room.settings.deckCardShows ? room.deck[room.deck.length - 1] || null : null, pendingDraw: room.pendingDraw, settings: room.settings, currentPlayer: room.players[room.turn]?.id, currentPlayerName: room.players[room.turn]?.name, me: me?.id, isHost: room.host === me?.id, unoCalled: me?.unoCalled || false, lastUnoCall: room.lastUnoCall, winnerId: room.winnerId, winnerName: room.winnerName, hand: me?.hand || [], players: room.players.map((player) => ({ id: player.id, name: player.name, cardCount: player.hand.length })) }
}
function broadcast(room) { room.players.forEach((player) => send(player.client, { type: 'room', room: roomView(room, player.client) })) }
function drawOne(room) {
  if (!room.deck.length) { room.deck = room.discard.length ? shuffle(room.discard) : makeDeck(); room.discard = [] }
  return room.deck.pop()
}
function drawCards(room, player, count) { for (let index = 0; index < count; index += 1) { const card = drawOne(room); if (card) player.hand.push(card) } }
function start(room) {
  room.deck = makeDeck(); room.discard = []
  room.players.forEach((player) => { player.hand = room.deck.splice(0, 7); player.unoCalled = false })
  room.topCard = room.deck.pop()
  while (room.topCard.color === 'wild') { room.deck.unshift(room.topCard); room.topCard = room.deck.pop() }
  room.activeColor = room.topCard.color; room.pendingDraw = 0; room.direction = 1; room.turn = 0; room.round += 1
  room.status = 'playing'; room.winnerId = null; room.winnerName = null; room.lastUnoCall = null
  if (room.topCard.value === '+2') room.pendingDraw = 2
  if (room.topCard.value === 'REVERSE') room.direction = -1
  if (room.topCard.value === 'SKIP') nextTurn(room)
}
function nextTurn(room) { const count = room.players.length; if (!count) { room.turn = 0; return } room.turn = (room.turn + room.direction + count) % count }
function finish(room, winner) { room.status = 'finished'; room.winnerId = winner.id; room.winnerName = winner.name; room.pendingDraw = 0 }
function onMessage(client, message) {
  const { type } = message
  if (type === 'createRoom') { leaveRoom(client); const room = { code: code(), status: 'waiting', players: [], host: client.id, turn: 0, direction: 1, round: 0, deck: [], discard: [], topCard: null, activeColor: null, pendingDraw: 0, lastUnoCall: null, winnerId: null, winnerName: null, settings: { cardSuggestions: false, cardStacking: false, deckCardShows: false } }; rooms.set(room.code, room); join(client, room, message.username); return }
  if (type === 'joinRoom') { const room = rooms.get(String(message.code || '').trim().toUpperCase()); if (!room) return fail(client, 'That room code does not exist.'); if (room.status !== 'waiting') return fail(client, 'That game has already started.'); if (room.players.length >= 6) return fail(client, 'That room is full.'); leaveRoom(client); join(client, room, message.username); return }
  const room = clients.get(client)?.room
  if (!room) return
  if (type === 'updateSettings') { if (room.host !== client.id || room.status !== 'waiting') return; room.settings = { ...room.settings, ...Object.fromEntries(Object.keys(room.settings).map((key) => [key, Boolean(message.settings?.[key])])) }; broadcast(room); return }
  if (type === 'startGame') { if (room.host !== client.id || room.status === 'playing' || room.players.length < 2) return; start(room); broadcast(room); return }
  if (type === 'drawCard') { if (!isTurn(room, client)) return; const player = room.players.find((entry) => entry.client === client); drawCards(room, player, Math.max(1, room.pendingDraw)); room.pendingDraw = 0; player.unoCalled = false; if (room.lastUnoCall?.playerId === player.id) room.lastUnoCall = null; nextTurn(room); broadcast(room); return }
  if (type === 'yellUno') { const player = room.players.find((entry) => entry.client === client); if (!isTurn(room, client) || player.hand.length !== 1) return; player.unoCalled = true; room.lastUnoCall = { playerId: player.id, playerName: player.name, nonce: Date.now() }; broadcast(room); return }
  if (type === 'playCard') { playCard(room, client, message.index, message.color); return }
  if (type === 'leave') { leaveRoom(client); return }
}
function join(client, room, name) { const player = { id: client.id, name: String(name || 'Player').trim().slice(0, 18) || 'Player', client, hand: [], unoCalled: false }; room.players.push(player); clients.set(client, { room }); broadcast(room) }
function isTurn(room, client) { return room.status === 'playing' && room.players[room.turn]?.client === client }
function playCard(room, client, index, chosenColor) {
  if (!isTurn(room, client)) return
  const player = room.players.find((entry) => entry.client === client)
  const card = player.hand[Number(index)]
  if (!card) return
  const isPenaltyCard = card.value === '+2' || card.value === '+4'
  if (room.pendingDraw > 0) {
    if (!room.settings.cardStacking) return fail(client, `You must draw ${room.pendingDraw} cards first.`)
    if (!isPenaltyCard) return fail(client, 'Only a +2 or +4 can be stacked on a penalty.')
  } else if (card.color !== 'wild' && card.color !== room.activeColor && card.value !== room.topCard.value) return fail(client, 'That card does not match the color or value in play.')
  if (card.color === 'wild' && !colors.includes(chosenColor)) return fail(client, 'Pick a color for that wild card.')
  const isLastCard = player.hand.length === 1
  player.hand.splice(Number(index), 1)
  if (room.topCard) room.discard.push(room.topCard)
  room.topCard = { ...card }
  room.activeColor = card.color === 'wild' ? chosenColor : card.color
  if (isLastCard && !player.unoCalled) drawCards(room, player, 3)
  player.unoCalled = false
  if (!player.hand.length) { finish(room, player); broadcast(room); return }
  if (isPenaltyCard) room.pendingDraw += card.value === '+4' ? 4 : 2
  if (card.value === 'REVERSE') room.direction *= -1
  const skipsNext = card.value === 'SKIP' || (card.value === 'REVERSE' && room.players.length === 2)
  nextTurn(room)
  if (skipsNext) nextTurn(room)
  broadcast(room)
}
function leaveRoom(client) {
  const entry = clients.get(client)
  if (!entry) return
  const room = entry.room
  const index = room.players.findIndex((player) => player.client === client)
  const wasCurrent = index === room.turn
  const leaving = room.players[index]
  room.players.splice(index, 1)
  clients.delete(client)
  if (!room.players.length) { rooms.delete(room.code); return }
  if (leaving?.hand?.length) room.discard.push(...leaving.hand)
  if (room.lastUnoCall?.playerId === leaving?.id) room.lastUnoCall = null
  if (room.status === 'playing') {
    if (room.players.length < 2) finish(room, room.players[0])
    else if (wasCurrent) room.turn = (index - (room.direction === 1 ? 0 : 1) + room.players.length) % room.players.length
    else if (index < room.turn) room.turn -= 1
    room.turn %= room.players.length
  }
  room.host = room.players[0].id
  broadcast(room)
}

const port = Number(process.env.PORT) || 3001
const wss = new WebSocketServer({ port })
wss.on('connection', (client) => { client.id = Math.random().toString(36).slice(2); client.on('message', (data) => { try { onMessage(client, JSON.parse(data.toString())) } catch { fail(client, 'Could not understand that move.') } }); client.on('close', () => leaveRoom(client)) })
console.log(`UNO game server listening on ws://localhost:${port}`)
