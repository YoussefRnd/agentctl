import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import type { ACPEvent } from '@agentctl/shared';

export interface ACPClientEvents {
  event: (event: ACPEvent) => void;
  error: (error: Error) => void;
  exit: (code: number | null) => void;
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
          const parsed = JSON.parse(line) as ACPEvent;
          this.emit('event', parsed);
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

  kill() {
    this.child.kill();
  }
}
