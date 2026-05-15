import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import type { ACPEvent } from '@agentctl/shared';

export interface ACPClientEvents {
  event: (event: ACPEvent) => void;
  rpcRequest: (request: { id: number | string; method: string; params: unknown }) => void;
  rpcResponse: (response: { id: number | string; result?: unknown; error?: unknown }) => void;
  error: (error: Error) => void;
  exit: (code: number | null) => void;
}

interface JsonRpcMessage {
  jsonrpc: '2.0';
  id?: number | string;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export class ACPClient extends EventEmitter {
  private buffer = '';
  private nextRequestId = 1;

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
          
          if (parsed.id !== undefined) {
            if (parsed.method) {
              // It's a request
              this.emit('rpcRequest', { id: parsed.id, method: parsed.method, params: parsed.params });
            } else {
              // It's a response
              this.emit('rpcResponse', { id: parsed.id, result: parsed.result, error: parsed.error });
            }
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

  async initialize(): Promise<unknown> {
    return this.call('initialize', {
      protocolVersion: 1,
      clientInfo: { name: 'agentctl', version: '1.0.0' },
    });
  }

  async call(method: string, params: unknown, timeoutMs = 5000): Promise<unknown> {
    const id = this.nextRequestId++;
    
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.off('rpcResponse', handler);
        const idStr = id.toString();
        const timeoutStr = timeoutMs.toString();
        reject(new Error("RPC call '" + method + "' (ID: " + idStr + ") timed out after " + timeoutStr + "ms"));
      }, timeoutMs);

      const handler = (response: { id: number | string; result?: unknown; error?: unknown }) => {
        if (response.id === id) {
          clearTimeout(timeout);
          this.off('rpcResponse', handler);
          if (response.error) {
            reject(response.error instanceof Error ? response.error : new Error(JSON.stringify(response.error)));
          } else {
            resolve(response.result);
          }
        }
      };

      this.on('rpcResponse', handler);
      
      this.send({
        jsonrpc: '2.0',
        id,
        method,
        params,
      });
    });
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
