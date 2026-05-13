import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import type { ACPEvent } from '@agentctl/shared';

export interface ACPClientEvents {
  event: (event: ACPEvent) => void;
  rpcRequest: (request: { id: number | string; method: string; params: unknown }) => void;
  error: (error: Error) => void;
  exit: (code: number | null) => void;
}

interface JsonRpcMessage {
  jsonrpc: '2.0';
  id?: number | string;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: unknown;
}

export class ACPClient extends EventEmitter {
  private buffer = '';

  constructor(private child: ChildProcess) {
    super();
    
    this.child.stdout?.on('data', (chunk: Buffer) => { this.handleData(chunk); });
    this.child.stderr?.on('data', (chunk: Buffer) => {
      this.emit('error', new Error(`Agent stderr: ${chunk.toString()}`));
    });
    this.child.on('exit', (code) => { this.emit('exit', code); });
    this.child.on('error', (err) => { this.emit('error', err); });
  }

  override on<U extends keyof ACPClientEvents>(event: U, listener: ACPClientEvents[U]): this {
    return super.on(event, listener);
  }

  override emit<U extends keyof ACPClientEvents>(event: U, ...args: Parameters<ACPClientEvents[U]>): boolean {
    return super.emit(event, ...args);
  }

  private handleData(chunk: Buffer) {
    this.buffer += chunk.toString('utf8');
    const lines = this.buffer.split('\n');
    
    // Keep the last incomplete line in the buffer
    this.buffer = lines.pop() ?? '';

    for (const line of lines) {
      if (line.trim()) {
        try {
          const parsed = JSON.parse(line) as JsonRpcMessage;
          
          // If it has an id, it's a request or response - emit as RPC
          if (parsed.id !== undefined && parsed.method) {
            this.emit('rpcRequest', { id: parsed.id, method: parsed.method, params: parsed.params });
          } else {
            // Otherwise treat as ACP event (notification)
            this.emit('event', parsed as unknown as ACPEvent);
          }
        } catch {
          this.emit('error', new Error(`Failed to parse JSON: ${line}`));
        }
      }
    }
  }

  send(message: unknown) {
    if (this.child.stdin && !this.child.stdin.destroyed) {
      this.child.stdin.write(JSON.stringify(message) + '\n');
    }
  }

  sendResponse(id: number | string, result: unknown) {
    this.send({
      jsonrpc: '2.0',
      id,
      result,
    });
  }

  sendError(id: number | string, error: { code: number; message: string }) {
    this.send({
      jsonrpc: '2.0',
      id,
      error,
    });
  }

  kill() {
    this.child.kill();
  }
}
