export class WorkerPool {
  constructor(factory, size) {
    this.factory = factory;
    this.size = Math.max(1, size);
    this.entries = [];
    this.queue = [];
    this.closed = false;
    this.jobId = 0;
  }

  run(action, payload, { priority = 0, onProgress } = {}) {
    if (this.closed) {
      return Promise.reject(new Error('The conversion worker was stopped.'));
    }
    return new Promise((resolve, reject) => {
      this.queue.push({
        id: ++this.jobId,
        action,
        payload,
        priority,
        onProgress,
        resolve,
        reject,
      });
      this.queue.sort((a, b) => b.priority - a.priority);
      this.dispatch();
    });
  }

  dispatch() {
    if (this.closed) return;
    this.queue.sort((a, b) => b.priority - a.priority);

    while (this.queue.length > 0) {
      let entry = this.entries.find((candidate) => !candidate.busy);
      if (!entry && this.entries.length < this.size) {
        entry = this.createEntry();
        if (!entry) break;
      }
      if (!entry) break;

      const job = this.queue.shift();
      entry.busy = true;
      entry.job = job;
      try {
        entry.worker.postMessage({ id: job.id, action: job.action, payload: job.payload });
      } catch (error) {
        entry.busy = false;
        entry.job = null;
        job.reject(error);
        this.removeEntry(entry);
      }
    }
  }

  createEntry() {
    let worker;
    try {
      worker = this.factory();
    } catch (error) {
      const job = this.queue.shift();
      if (job) {
        const failure = new Error('The conversion engine could not start. Try reloading the page.');
        failure.code = 'WORKER_FAILED';
        failure.cause = error;
        job.reject(failure);
      }
      return null;
    }

    const entry = { worker, busy: false, job: null };
    worker.onmessage = (event) => {
      const message = event.data;
      if (!entry.job || !message || message.id !== entry.job.id) return;

      if (message.type === 'progress') {
        entry.job.onProgress?.(message.progress);
        return;
      }

      const job = entry.job;
      entry.busy = false;
      entry.job = null;

      if (message.type === 'done') {
        job.resolve(message.result);
      } else {
        const error = new Error(message.message || 'The conversion failed.');
        error.code = message.code || 'CONVERSION_FAILED';
        job.reject(error);
      }
      this.dispatch();
    };

    worker.onerror = (event) => {
      event.preventDefault?.();
      const job = entry.job;
      entry.busy = false;
      entry.job = null;
      this.removeEntry(entry);
      if (job) {
        const error = new Error(
          'The conversion engine stopped unexpectedly. Reload the page and try again.',
        );
        error.code = 'WORKER_FAILED';
        job.reject(error);
      }
      this.dispatch();
    };

    worker.onmessageerror = () => {
      const job = entry.job;
      entry.busy = false;
      entry.job = null;
      this.removeEntry(entry);
      if (job) job.reject(new Error('The conversion worker returned unreadable data.'));
      this.dispatch();
    };

    this.entries.push(entry);
    return entry;
  }

  removeEntry(entry) {
    entry.worker.terminate();
    this.entries = this.entries.filter((candidate) => candidate !== entry);
  }

  destroy() {
    this.closed = true;
    for (const entry of this.entries) {
      entry.worker.terminate();
      entry.job?.reject(new Error('The conversion was cancelled.'));
    }
    this.entries = [];
    for (const job of this.queue) {
      job.reject(new Error('The conversion was cancelled.'));
    }
    this.queue = [];
  }
}

export function imagePoolSize() {
  const cores = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 2 : 2;
  return Math.min(Math.max(cores - 1, 1), 4);
}

export function createImagePool() {
  return new WorkerPool(
    () => new Worker(new URL('./imageWorker.js', import.meta.url), { type: 'module' }),
    imagePoolSize(),
  );
}
