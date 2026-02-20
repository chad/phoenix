import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';

export interface Player {
  id: string;
  connected: boolean;
  lastSeen: number;
}

export interface GameState {
  grid: number[][];
  players: Map<string, Player>;
  gameEndTime: number;
}

export interface ConnectionMessage {
  type: 'init' | 'player_update';
  data: {
    playerId?: string;
    grid?: number[][];
    players?: Array<{ id: string; connected: boolean }>;
    remainingTime?: number;
    playerCount?: number;
  };
}

export interface WebSocketFrame {
  fin: boolean;
  opcode: number;
  masked: boolean;
  payloadLength: number;
  maskingKey?: Buffer;
  payload: Buffer;
}

export class ConnectionHandler extends EventEmitter {
  private server: ReturnType<typeof createServer>;
  private connections = new Map<string, any>();
  private gameState: GameState;
  private cleanupInterval: NodeJS.Timeout;
  private port: number;

  constructor(port = 3000) {
    super();
    this.port = port;
    this.gameState = {
      grid: Array(10).fill(null).map(() => Array(10).fill(0)),
      players: new Map(),
      gameEndTime: Date.now() + 300000 // 5 minutes default
    };

    this.server = createServer((req, res) => this.handleHttpRequest(req, res));
    this.cleanupInterval = setInterval(() => this.cleanupDisconnectedPlayers(), 1000);
  }

  private handleHttpRequest(req: IncomingMessage, res: ServerResponse): void {
    if (req.method === 'GET' && req.url === '/') {
      this.serveGameUI(res);
    } else if (req.headers.upgrade === 'websocket') {
      this.handleWebSocketUpgrade(req, res);
    } else {
      res.writeHead(404);
      res.end('Not Found');
    }
  }

  private serveGameUI(res: ServerResponse): void {
    const html = `<!DOCTYPE html>
<html>
<head>
    <title>Phoenix VCS Game</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        #grid { display: grid; grid-template-columns: repeat(10, 30px); gap: 1px; }
        .cell { width: 30px; height: 30px; border: 1px solid #ccc; display: flex; align-items: center; justify-content: center; }
        #players { margin-top: 20px; }
        #timer { font-weight: bold; margin-bottom: 10px; }
    </style>
</head>
<body>
    <div id="timer">Time remaining: --:--</div>
    <div id="grid"></div>
    <div id="players">
        <h3>Players: <span id="player-count">0</span></h3>
        <div id="player-list"></div>
    </div>
    <script>
        const ws = new WebSocket('ws://localhost:${this.port}');
        let playerId = null;
        
        ws.onmessage = (event) => {
            const message = JSON.parse(event.data);
            if (message.type === 'init') {
                playerId = message.data.playerId;
                updateGrid(message.data.grid);
                updatePlayers(message.data.players);
                updateTimer(message.data.remainingTime);
            } else if (message.type === 'player_update') {
                document.getElementById('player-count').textContent = message.data.playerCount;
            }
        };
        
        function updateGrid(grid) {
            const gridEl = document.getElementById('grid');
            gridEl.innerHTML = '';
            grid.forEach(row => {
                row.forEach(cell => {
                    const cellEl = document.createElement('div');
                    cellEl.className = 'cell';
                    cellEl.textContent = cell || '';
                    gridEl.appendChild(cellEl);
                });
            });
        }
        
        function updatePlayers(players) {
            const listEl = document.getElementById('player-list');
            const countEl = document.getElementById('player-count');
            listEl.innerHTML = '';
            countEl.textContent = players.length;
            players.forEach(player => {
                const playerEl = document.createElement('div');
                playerEl.textContent = player.id + (player.connected ? ' (online)' : ' (offline)');
                listEl.appendChild(playerEl);
            });
        }
        
        function updateTimer(remainingMs) {
            const minutes = Math.floor(remainingMs / 60000);
            const seconds = Math.floor((remainingMs % 60000) / 1000);
            document.getElementById('timer').textContent = 
                'Time remaining: ' + minutes + ':' + seconds.toString().padStart(2, '0');
        }
    </script>
</body>
</html>`;

    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(html);
  }

  private handleWebSocketUpgrade(req: IncomingMessage, res: ServerResponse): void {
    const key = req.headers['sec-websocket-key'];
    if (!key) {
      res.writeHead(400);
      res.end('Bad Request');
      return;
    }

    const acceptKey = this.generateWebSocketAcceptKey(key);
    const responseHeaders = [
      'HTTP/1.1 101 Switching Protocols',
      'Upgrade: websocket',
      'Connection: Upgrade',
      `Sec-WebSocket-Accept: ${acceptKey}`,
      '', ''
    ].join('\r\n');

    res.socket?.write(responseHeaders);

    const playerId = this.generatePlayerId();
    const player: Player = {
      id: playerId,
      connected: true,
      lastSeen: Date.now()
    };

    this.gameState.players.set(playerId, player);
    this.connections.set(playerId, res.socket);

    res.socket?.on('data', (data: Buffer) => {
      this.handleWebSocketFrame(playerId, data);
    });

    res.socket?.on('close', () => {
      this.handlePlayerDisconnect(playerId);
    });

    res.socket?.on('error', () => {
      this.handlePlayerDisconnect(playerId);
    });

    this.sendInitialState(playerId, res.socket);
    this.broadcastPlayerUpdate();
  }

  private generateWebSocketAcceptKey(key: string): string {
    const magic = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
    return createHash('sha1').update(key + magic).digest('base64');
  }

  private generatePlayerId(): string {
    const chars = '0123456789abcdef';
    let result = '';
    for (let i = 0; i < 6; i++) {
      result += chars[Math.floor(Math.random() * chars.length)];
    }
    return result;
  }

  private handleWebSocketFrame(playerId: string, data: Buffer): void {
    const player = this.gameState.players.get(playerId);
    if (player) {
      player.lastSeen = Date.now();
    }
  }

  private handlePlayerDisconnect(playerId: string): void {
    const player = this.gameState.players.get(playerId);
    if (player) {
      player.connected = false;
      player.lastSeen = Date.now();
    }
    this.connections.delete(playerId);
    this.broadcastPlayerUpdate();
  }

  private sendInitialState(playerId: string, socket: any): void {
    const message: ConnectionMessage = {
      type: 'init',
      data: {
        playerId,
        grid: this.gameState.grid,
        players: Array.from(this.gameState.players.values()).map(p => ({
          id: p.id,
          connected: p.connected
        })),
        remainingTime: Math.max(0, this.gameState.gameEndTime - Date.now())
      }
    };

    this.sendWebSocketMessage(socket, JSON.stringify(message));
  }

  private broadcastPlayerUpdate(): void {
    const connectedCount = Array.from(this.gameState.players.values())
      .filter(p => p.connected).length;

    const message: ConnectionMessage = {
      type: 'player_update',
      data: {
        playerCount: connectedCount
      }
    };

    const messageStr = JSON.stringify(message);
    this.connections.forEach(socket => {
      this.sendWebSocketMessage(socket, messageStr);
    });
  }

  private sendWebSocketMessage(socket: any, message: string): void {
    const payload = Buffer.from(message, 'utf8');
    const frame = Buffer.allocUnsafe(2 + payload.length);
    
    frame[0] = 0x81; // FIN + text frame
    frame[1] = payload.length < 126 ? payload.length : 126;
    
    let offset = 2;
    if (payload.length >= 126) {
      frame.writeUInt16BE(payload.length, 2);
      offset = 4;
    }
    
    payload.copy(frame, offset);
    socket?.write(frame);
  }

  private cleanupDisconnectedPlayers(): void {
    const now = Date.now();
    let removed = false;

    for (const [playerId, player] of this.gameState.players.entries()) {
      if (!player.connected && now - player.lastSeen > 5000) {
        this.gameState.players.delete(playerId);
        removed = true;
      }
    }

    if (removed) {
      this.broadcastPlayerUpdate();
    }
  }

  public listen(): void {
    this.server.listen(this.port, () => {
      this.emit('listening', this.port);
    });
  }

  public close(): void {
    clearInterval(this.cleanupInterval);
    this.server.close();
    this.connections.clear();
  }

  public getPlayerCount(): number {
    return Array.from(this.gameState.players.values())
      .filter(p => p.connected).length;
  }

  public updateGameState(grid: number[][], gameEndTime: number): void {
    this.gameState.grid = grid;
    this.gameState.gameEndTime = gameEndTime;
  }
}

/** @internal Phoenix VCS traceability — do not remove. */
export const _phoenix = {
  iu_id: '287d727e4c54fc45b5ea5e2484392a34a4b0750386cdb6f88404dcff44b70aa3',
  name: 'Connection Handling',
  risk_tier: 'medium',
  canon_ids: [6 as const],
} as const;