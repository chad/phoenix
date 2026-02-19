import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';

export interface GameMessage {
  type: 'move' | 'join' | 'end' | 'disconnect' | 'state';
  gameId: string;
  playerId: string;
  data?: any;
  timestamp: number;
}

export interface PlayerConnection {
  playerId: string;
  gameId: string;
  ws: WebSocketConnection;
  lastPing: number;
}

export interface GameState {
  gameId: string;
  players: string[];
  status: 'waiting' | 'active' | 'ended';
  moves: any[];
  result?: {
    winner?: string;
    reason: string;
  };
}

interface WebSocketConnection {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  readyState: number;
  ping(): void;
  on(event: string, listener: (...args: any[]) => void): void;
}

const WEBSOCKET_MAGIC_STRING = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

export class RealTimeCommunication extends EventEmitter {
  private connections = new Map<string, PlayerConnection>();
  private gameConnections = new Map<string, Set<string>>();
  private server: ReturnType<typeof createServer>;
  private pingInterval: NodeJS.Timeout | null = null;

  constructor(port: number = 8080) {
    super();
    this.server = createServer();
    this.setupWebSocketServer();
    this.server.listen(port);
    this.startPingMonitoring();
  }

  private setupWebSocketServer(): void {
    this.server.on('upgrade', (request: IncomingMessage, socket: any, head: Buffer) => {
      const url = new URL(request.url || '', `http://${request.headers.host}`);
      const playerId = url.searchParams.get('playerId');
      const gameId = url.searchParams.get('gameId');

      if (!playerId || !gameId) {
        socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
        return;
      }

      const key = request.headers['sec-websocket-key'];
      if (!key) {
        socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
        return;
      }

      const acceptKey = createHash('sha1')
        .update(key + WEBSOCKET_MAGIC_STRING)
        .digest('base64');

      const responseHeaders = [
        'HTTP/1.1 101 Switching Protocols',
        'Upgrade: websocket',
        'Connection: Upgrade',
        `Sec-WebSocket-Accept: ${acceptKey}`,
        '\r\n'
      ].join('\r\n');

      socket.write(responseHeaders);

      const ws = this.createWebSocketConnection(socket);
      this.handleConnection(ws, playerId, gameId);
    });
  }

  private createWebSocketConnection(socket: any): WebSocketConnection {
    const connection: WebSocketConnection = {
      send: (data: string) => {
        if (socket.writable) {
          const buffer = Buffer.from(data);
          const frame = Buffer.allocUnsafe(2 + buffer.length);
          frame[0] = 0x81; // FIN + text frame
          frame[1] = buffer.length;
          buffer.copy(frame, 2);
          socket.write(frame);
        }
      },
      close: (code?: number, reason?: string) => {
        if (socket.writable) {
          socket.end();
        }
      },
      readyState: 1,
      ping: () => {
        if (socket.writable) {
          const frame = Buffer.from([0x89, 0x00]); // ping frame
          socket.write(frame);
        }
      },
      on: (event: string, listener: (...args: any[]) => void) => {
        if (event === 'message') {
          socket.on('data', (data: Buffer) => {
            if (data.length >= 2) {
              const opcode = data[0] & 0x0f;
              if (opcode === 0x01) { // text frame
                const payloadLength = data[1] & 0x7f;
                const maskStart = 2;
                const dataStart = maskStart + 4;
                if (data.length >= dataStart + payloadLength) {
                  const mask = data.slice(maskStart, dataStart);
                  const payload = Buffer.allocUnsafe(payloadLength);
                  for (let i = 0; i < payloadLength; i++) {
                    payload[i] = data[dataStart + i] ^ mask[i % 4];
                  }
                  listener(payload.toString());
                }
              } else if (opcode === 0x0a) { // pong frame
                listener();
              }
            }
          });
        } else if (event === 'pong') {
          socket.on('data', (data: Buffer) => {
            if (data.length >= 1 && (data[0] & 0x0f) === 0x0a) {
              listener();
            }
          });
        } else if (event === 'close' || event === 'error') {
          socket.on(event, listener);
        }
      }
    };

    return connection;
  }

  private handleConnection(ws: WebSocketConnection, playerId: string, gameId: string): void {
    const connectionId = this.generateConnectionId(playerId, gameId);
    
    // Remove existing connection if any
    this.removeConnection(connectionId);

    const connection: PlayerConnection = {
      playerId,
      gameId,
      ws,
      lastPing: Date.now()
    };

    this.connections.set(connectionId, connection);
    
    if (!this.gameConnections.has(gameId)) {
      this.gameConnections.set(gameId, new Set());
    }
    this.gameConnections.get(gameId)!.add(connectionId);

    ws.on('message', (data: string) => {
      try {
        const message: GameMessage = JSON.parse(data);
        this.handleMessage(connectionId, message);
      } catch (error) {
        ws.send(JSON.stringify({ error: 'Invalid message format' }));
      }
    });

    ws.on('pong', () => {
      connection.lastPing = Date.now();
    });

    ws.on('close', () => {
      this.handleDisconnection(connectionId);
    });

    ws.on('error', () => {
      this.handleDisconnection(connectionId);
    });

    // Notify about player joining
    this.broadcastToGame(gameId, {
      type: 'join',
      gameId,
      playerId,
      timestamp: Date.now()
    }, connectionId);

    this.emit('playerJoined', { gameId, playerId });
  }

  private handleMessage(connectionId: string, message: GameMessage): void {
    const connection = this.connections.get(connectionId);
    if (!connection) return;

    message.timestamp = Date.now();
    message.playerId = connection.playerId;
    message.gameId = connection.gameId;

    switch (message.type) {
      case 'move':
        this.handleMove(connection, message);
        break;
      case 'state':
        this.handleStateRequest(connection, message);
        break;
      default:
        connection.ws.send(JSON.stringify({ error: 'Unknown message type' }));
    }
  }

  private handleMove(connection: PlayerConnection, message: GameMessage): void {
    // Broadcast move to all other players in the game
    this.broadcastToGame(connection.gameId, message, this.generateConnectionId(connection.playerId, connection.gameId));
    this.emit('move', message);
  }

  private handleStateRequest(connection: PlayerConnection, message: GameMessage): void {
    this.emit('stateRequest', {
      gameId: connection.gameId,
      playerId: connection.playerId,
      respond: (state: GameState) => {
        connection.ws.send(JSON.stringify({
          type: 'state',
          gameId: connection.gameId,
          data: state,
          timestamp: Date.now()
        }));
      }
    });
  }

  private handleDisconnection(connectionId: string): void {
    const connection = this.connections.get(connectionId);
    if (!connection) return;

    this.removeConnection(connectionId);

    // Notify other players about disconnection
    this.broadcastToGame(connection.gameId, {
      type: 'disconnect',
      gameId: connection.gameId,
      playerId: connection.playerId,
      timestamp: Date.now()
    });

    this.emit('playerDisconnected', {
      gameId: connection.gameId,
      playerId: connection.playerId
    });
  }

  private removeConnection(connectionId: string): void {
    const connection = this.connections.get(connectionId);
    if (!connection) return;

    this.connections.delete(connectionId);
    
    const gameConnections = this.gameConnections.get(connection.gameId);
    if (gameConnections) {
      gameConnections.delete(connectionId);
      if (gameConnections.size === 0) {
        this.gameConnections.delete(connection.gameId);
      }
    }

    if (connection.ws.readyState === 1) {
      connection.ws.close();
    }
  }

  private broadcastToGame(gameId: string, message: GameMessage, excludeConnectionId?: string): void {
    const gameConnections = this.gameConnections.get(gameId);
    if (!gameConnections) return;

    const messageStr = JSON.stringify(message);

    for (const connectionId of gameConnections) {
      if (connectionId === excludeConnectionId) continue;
      
      const connection = this.connections.get(connectionId);
      if (connection && connection.ws.readyState === 1) {
        connection.ws.send(messageStr);
      }
    }
  }

  private startPingMonitoring(): void {
    this.pingInterval = setInterval(() => {
      const now = Date.now();
      const staleConnections: string[] = [];

      for (const [connectionId, connection] of this.connections) {
        if (now - connection.lastPing > 5000) {
          staleConnections.push(connectionId);
        } else if (connection.ws.readyState === 1) {
          connection.ws.ping();
        }
      }

      // Remove stale connections
      for (const connectionId of staleConnections) {
        this.handleDisconnection(connectionId);
      }
    }, 2500);
  }

  private generateConnectionId(playerId: string, gameId: string): string {
    return createHash('sha256').update(`${playerId}:${gameId}`).digest('hex').substring(0, 16);
  }

  public notifyMove(gameId: string, playerId: string, moveData: any): void {
    this.broadcastToGame(gameId, {
      type: 'move',
      gameId,
      playerId,
      data: moveData,
      timestamp: Date.now()
    });
  }

  public notifyGameJoin(gameId: string, gameState: GameState): void {
    this.broadcastToGame(gameId, {
      type: 'state',
      gameId,
      playerId: '',
      data: gameState,
      timestamp: Date.now()
    });
  }

  public notifyGameEnd(gameId: string, result: { winner?: string; reason: string }): void {
    this.broadcastToGame(gameId, {
      type: 'end',
      gameId,
      playerId: '',
      data: result,
      timestamp: Date.now()
    });
  }

  public getActiveConnections(gameId: string): number {
    return this.gameConnections.get(gameId)?.size || 0;
  }

  public isPlayerConnected(gameId: string, playerId: string): boolean {
    const connectionId = this.generateConnectionId(playerId, gameId);
    return this.connections.has(connectionId);
  }

  public close(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
    
    for (const connection of this.connections.values()) {
      connection.ws.close();
    }
    
    this.connections.clear();
    this.gameConnections.clear();
    this.server.close();
  }
}

export function createRealTimeCommunication(port?: number): RealTimeCommunication {
  return new RealTimeCommunication(port);
}

/** @internal Phoenix VCS traceability — do not remove. */
export const _phoenix = {
  iu_id: 'afe25dcfd068b869440fcfcf14db07eb17aebe3f03d9700ab321cbb847c7008c',
  name: 'Real-Time Communication',
  risk_tier: 'medium',
  canon_ids: [5 as const],
} as const;