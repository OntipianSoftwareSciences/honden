import { createServer } from 'node:http'
import { WebSocketServer } from 'ws'

const port = Number(process.env.PORT || 3000)
const rooms = new Map()

const server = createServer((request, response) => {
  if (request.url === '/' || request.url?.startsWith('/health')) {
    response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' })
    response.end(
      'HonDen relay is listening. Messages pass through in memory and are never stored.\n',
    )
    return
  }
  response.writeHead(404).end()
})

const wss = new WebSocketServer({ server, maxPayload: 64 * 1024 })

wss.on('connection', (socket, request) => {
  let room = 'lobby'
  try {
    const base = `http://${request.headers.host || 'localhost'}`
    const url = new URL(request.url || '/', base)
    room = (url.searchParams.get('room') || 'lobby').slice(0, 128)
  } catch {
    room = 'lobby'
  }

  let peers = rooms.get(room)
  if (!peers) {
    peers = new Set()
    rooms.set(room, peers)
  }
  peers.add(socket)

  socket.on('message', (data, isBinary) => {
    for (const peer of peers) {
      if (peer !== socket && peer.readyState === 1) {
        peer.send(data, { binary: isBinary })
      }
    }
  })

  const leave = () => {
    peers.delete(socket)
    if (peers.size === 0 && rooms.get(room) === peers) rooms.delete(room)
  }
  socket.on('close', leave)
  socket.on('error', leave)
})

wss.on('error', (error) => {
  console.error('Relay error:', error.message)
})

server.listen(port, () => {
  console.log(`HonDen blind relay ready at ws://localhost:${port}`)
  console.log('Use ?room=<id> to join a room. No messages are stored on this server.')
})

function shutdown() {
  wss.close(() => server.close(() => process.exit(0)))
  setTimeout(() => process.exit(0), 2000).unref()
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
