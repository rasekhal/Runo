import { WebSocketServer } from 'ws'
import { randomInt } from 'node:crypto'

const rooms = new Map()
const clients = new Map()
const colors = ['red', 'yellow', 'green', 'blue']
const values = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'SKIP', 'REVERSE', '+2']

function makeDeck() {
  const deck = []
  colors.forEach((color) => values.forEach((value, index) => { deck.push({ color, value }); if (index > 0) deck.push({ color, value }) }))
  for (let index = 0; index < 4; index += 1) { deck.push({ color: 'wild', value: 'WILD' }, { color: 'wild', value: '+4' }) }
  for (let index = deck.length - 1; index > 0; index -= 1) { const swap = randomInt(index + 1); [deck[index], deck[swap]] = [deck[swap], deck[index]] }
  return deck
}
function code() { let value; do value = Math.random().toString(36).slice(2, 7).toUpperCase(); while (rooms.has(value)); return value }
function send(client, message) { client.send(JSON.stringify(message)) }
function roomView(room, client) {
  const me = room.players.find((player) => player.client === client)
  return { code: room.code, status: room.status, round: room.round, deckCount: room.deck.length, topCard: room.topCard, activeColor: room.activeColor, deckPreview: room.settings.deckCardShows ? room.deck[room.deck.length - 1] : null, pendingDraw: room.pendingDraw, settings: room.settings, currentPlayer: room.players[room.turn]?.id, currentPlayerName: room.players[room.turn]?.name, me: me?.id, isHost: room.host === me?.id, unoCalled: me?.unoCalled || false, hand: me?.hand || [], players: room.players.map((player) => ({ id: player.id, name: player.name, cardCount: player.hand.length })) }
}
function broadcast(room) { room.players.forEach((player) => send(player.client, { type: 'room', room: roomView(room, player.client) })) }
function start(room) { room.deck = makeDeck(); room.players.forEach((player) => { player.hand = room.deck.splice(0, 7) }); room.topCard = room.deck.pop(); while (room.topCard.color === 'wild') { room.deck.unshift(room.topCard); room.topCard = room.deck.pop() } room.activeColor = room.topCard.color; room.pendingDraw = 0; room.turn = 0; room.round += 1; room.status = 'playing' }
function nextTurn(room) { room.turn = (room.turn + 1) % room.players.length }
function onMessage(client, message) {
  const { type } = message
  if (type === 'createRoom') { const room = { code: code(), status: 'waiting', players: [], host: client.id, turn: 0, round: 0, deck: [], topCard: null, activeColor: null, pendingDraw: 0, settings: { cardSuggestions: false, cardStacking: false, deckCardShows: false } }; rooms.set(room.code, room); join(client, room, message.username); return }
  if (type === 'joinRoom') { const room = rooms.get(message.code); if (!room) return send(client, { type: 'error', message: 'That room code does not exist.' }); if (room.status !== 'waiting') return send(client, { type: 'error', message: 'That game has already started.' }); if (room.players.length >= 6) return send(client, { type: 'error', message: 'That room is full.' }); join(client, room, message.username); return }
  const room = clients.get(client)?.room
  if (!room) return
  if (type === 'updateSettings') { if (room.host !== client.id || room.status !== 'waiting') return; room.settings = { ...room.settings, ...Object.fromEntries(Object.keys(room.settings).map((key) => [key, Boolean(message.settings?.[key])])) }; broadcast(room); return }
  if (type === 'startGame') { if (room.host !== client.id || room.players.length < 2) return; start(room); broadcast(room); return }
  if (type === 'drawCard') { if (!isTurn(room, client)) return; const player = room.players.find((entry) => entry.client === client); const hadPenalty = room.settings.cardStacking && room.pendingDraw > 0; const drawCount = room.settings.cardStacking ? Math.max(1, room.pendingDraw) : 1; for (let index = 0; index < drawCount; index += 1) { if (!room.deck.length) room.deck = makeDeck(); player.hand.push(room.deck.pop()) } room.pendingDraw = 0; advanceAfterDraw(room, hadPenalty); broadcast(room); return }
  if (type === 'yellUno') { const player = room.players.find((entry) => entry.client === client); if (!isTurn(room, client) || player.hand.length !== 1) return; player.unoCalled = true; broadcast(room); return }
  if (type === 'playCard') { playCard(room, client, message.index, message.color); return }
  if (type === 'leave') { remove(client); return }
}
function join(client, room, name) { const player = { id: client.id, name: String(name || 'Player').slice(0, 18), client, hand: [], unoCalled: false }; room.players.push(player); clients.set(client, { room }); broadcast(room) }
function isTurn(room, client) { return room.status === 'playing' && room.players[room.turn]?.client === client }
function playCard(room, client, index, chosenColor) { if (!isTurn(room, client)) return; const player = room.players.find((entry) => entry.client === client); const card = player.hand[index]; const isPenaltyCard = card?.value === '+2' || card?.value === '+4'; const canStack = room.settings.cardStacking && room.pendingDraw > 0 && isPenaltyCard; const canMatch = room.pendingDraw === 0 && (card?.color === 'wild' || card?.color === room.activeColor || card?.value === room.topCard.value); if (!card || (!canStack && !canMatch)) return; if (card.color === 'wild' && !colors.includes(chosenColor)) return; const isLastCard = player.hand.length === 1; player.hand.splice(index, 1); room.topCard = { ...card }; room.activeColor = card.color === 'wild' ? chosenColor : card.color; if (isLastCard && !player.unoCalled) { for (let draw = 0; draw < 3; draw += 1) { if (!room.deck.length) room.deck = makeDeck(); player.hand.push(room.deck.pop()) } } player.unoCalled = false; if (!player.hand.length) { room.status = 'waiting'; room.round += 1; room.players.forEach((entry) => { entry.hand = []; entry.unoCalled = false }); broadcast(room); return } if (room.settings.cardStacking && isPenaltyCard) room.pendingDraw += card.value === '+4' ? 4 : 2; advanceAfterCard(room, card, isPenaltyCard); broadcast(room) }
function advanceAfterCard(room, card, isPenaltyCard) { const getsAnotherTurn = room.players.length === 2 && (card.value === 'SKIP' || card.value === 'REVERSE' || (isPenaltyCard && !room.settings.cardStacking)); nextTurn(room); if (getsAnotherTurn) nextTurn(room) }
function advanceAfterDraw(room, hadPenalty) { nextTurn(room); if (room.players.length === 2 && hadPenalty) nextTurn(room) }
function remove(client) { const entry = clients.get(client); if (!entry) return; entry.room.players = entry.room.players.filter((player) => player.client !== client); clients.delete(client); if (!entry.room.players.length) rooms.delete(entry.room.code); else { entry.room.host = entry.room.players[0].id; broadcast(entry.room) } }

const wss = new WebSocketServer({ port: 3001 })
wss.on('connection', (client) => { client.id = Math.random().toString(36).slice(2); client.on('message', (data) => { try { onMessage(client, JSON.parse(data.toString())) } catch { send(client, { type: 'error', message: 'Could not understand that move.' }) } }); client.on('close', () => remove(client)) })
console.log('Flip 7 game server listening on ws://localhost:3001')