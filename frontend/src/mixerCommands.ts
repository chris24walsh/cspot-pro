export type MixerCommand = {
  path: string;
  value: number | string;
  confirm_phantom: boolean;
  sequence: number;
};

/** Keep only the latest desired value per parameter while a request is in flight. */
export class MixerCommandQueue {
  private queued = new Map<string, MixerCommand>();
  private active: MixerCommand[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;
  constructor(private send: (commands: MixerCommand[]) => Promise<void>, private failed: (commands: MixerCommand[], error: unknown) => void) {}
  enqueue(command: MixerCommand, immediate = false) {
    if (this.disposed) return;
    this.queued.set(command.path, command);
    if (this.active.length) return;
    if (immediate) {
      if (this.timer) clearTimeout(this.timer);
      this.timer = null;
      void this.flush();
    } else if (!this.timer) {
      this.timer = setTimeout(() => {
        this.timer = null;
        void this.flush();
      }, 35);
    }
  }
  outstanding(path: string) {
    return this.queued.has(path) || this.active.some(command => command.path === path);
  }
  clear() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.queued.clear();
  }
  dispose() {
    this.clear();
    this.disposed = true;
  }
  private async flush() {
    if (this.disposed || this.active.length || !this.queued.size) return;
    const commands = [...this.queued.values()].slice(0, 32);
    for (const command of commands) this.queued.delete(command.path);
    this.active = commands;
    try {
      await this.send(commands);
    } catch (error) {
      if (!this.disposed) this.failed(commands, error);
    } finally {
      this.active = [];
      if (!this.disposed && this.queued.size) void this.flush();
    }
  }
}
