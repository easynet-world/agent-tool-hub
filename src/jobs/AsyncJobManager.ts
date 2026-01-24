import { v4 as uuidv4 } from "uuid";
import { EventEmitter } from "eventemitter3";

/**
 * Job status in the lifecycle.
 */
export type JobStatus = "queued" | "running" | "completed" | "failed";

/**
 * A job record representing an async tool invocation.
 */
export interface Job {
  jobId: string;
  toolName: string;
  requestId: string;
  taskId: string;
  status: JobStatus;
  createdAt: number; // epoch ms
  updatedAt: number;
  result?: unknown;
  error?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Options for submitting a job.
 */
export interface SubmitJobOptions {
  toolName: string;
  requestId: string;
  taskId: string;
  metadata?: Record<string, unknown>;
}

/**
 * Job store interface for pluggable backends.
 */
export interface JobStore {
  set(jobId: string, job: Job): Promise<void>;
  get(jobId: string): Promise<Job | undefined>;
  list(filter?: { toolName?: string; status?: JobStatus }): Promise<Job[]>;
  delete(jobId: string): Promise<void>;
}

/**
 * In-memory job store (default, for PoC and testing).
 */
export class InMemoryJobStore implements JobStore {
  private readonly jobs = new Map<string, Job>();

  async set(jobId: string, job: Job): Promise<void> {
    this.jobs.set(jobId, job);
  }

  async get(jobId: string): Promise<Job | undefined> {
    return this.jobs.get(jobId);
  }

  async list(filter?: { toolName?: string; status?: JobStatus }): Promise<Job[]> {
    let results = [...this.jobs.values()];
    if (filter?.toolName) {
      results = results.filter((j) => j.toolName === filter.toolName);
    }
    if (filter?.status) {
      results = results.filter((j) => j.status === filter.status);
    }
    return results;
  }

  async delete(jobId: string): Promise<void> {
    this.jobs.delete(jobId);
  }

  get size(): number {
    return this.jobs.size;
  }

  clear(): void {
    this.jobs.clear();
  }
}

/**
 * Async Job Manager: unified async task handling for tools.
 * Provides submit/poll/getResult pattern.
 */
export class AsyncJobManager {
  private readonly store: JobStore;
  private readonly emitter = new EventEmitter();
  private readonly ttlMs: number;
  private cleanupTimer?: ReturnType<typeof setInterval>;

  constructor(options: { store?: JobStore; ttlMs?: number } = {}) {
    this.store = options.store ?? new InMemoryJobStore();
    this.ttlMs = options.ttlMs ?? 3600_000; // 1 hour default TTL
    this.startCleanup();
  }

  /**
   * Submit a new async job.
   */
  async submit(options: SubmitJobOptions): Promise<Job> {
    const now = Date.now();
    const job: Job = {
      jobId: uuidv4(),
      toolName: options.toolName,
      requestId: options.requestId,
      taskId: options.taskId,
      status: "queued",
      createdAt: now,
      updatedAt: now,
      metadata: options.metadata,
    };

    await this.store.set(job.jobId, job);
    this.emitter.emit("submitted", job);
    return job;
  }

  /**
   * Update job status to running.
   */
  async markRunning(jobId: string): Promise<Job | undefined> {
    const job = await this.store.get(jobId);
    if (!job) return undefined;

    job.status = "running";
    job.updatedAt = Date.now();
    await this.store.set(jobId, job);
    this.emitter.emit("running", job);
    return job;
  }

  /**
   * Complete a job with a result.
   */
  async complete(jobId: string, result: unknown): Promise<Job | undefined> {
    const job = await this.store.get(jobId);
    if (!job) return undefined;

    job.status = "completed";
    job.result = result;
    job.updatedAt = Date.now();
    await this.store.set(jobId, job);
    this.emitter.emit("completed", job);
    return job;
  }

  /**
   * Fail a job with an error message.
   */
  async fail(jobId: string, error: string): Promise<Job | undefined> {
    const job = await this.store.get(jobId);
    if (!job) return undefined;

    job.status = "failed";
    job.error = error;
    job.updatedAt = Date.now();
    await this.store.set(jobId, job);
    this.emitter.emit("failed", job);
    return job;
  }

  /**
   * Get current job status.
   */
  async getStatus(jobId: string): Promise<JobStatus | undefined> {
    const job = await this.store.get(jobId);
    return job?.status;
  }

  /**
   * Get the full job record.
   */
  async getJob(jobId: string): Promise<Job | undefined> {
    return this.store.get(jobId);
  }

  /**
   * Get the result of a completed job.
   */
  async getResult(jobId: string): Promise<unknown | undefined> {
    const job = await this.store.get(jobId);
    if (!job || job.status !== "completed") return undefined;
    return job.result;
  }

  /**
   * List jobs with optional filter.
   */
  async list(filter?: {
    toolName?: string;
    status?: JobStatus;
  }): Promise<Job[]> {
    return this.store.list(filter);
  }

  /**
   * Subscribe to job events.
   */
  on(
    event: "submitted" | "running" | "completed" | "failed",
    listener: (job: Job) => void,
  ): () => void {
    this.emitter.on(event, listener);
    return () => this.emitter.off(event, listener);
  }

  /**
   * Stop cleanup timer.
   */
  dispose(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }
  }

  private startCleanup(): void {
    // Run cleanup every TTL/2 interval
    const interval = Math.max(this.ttlMs / 2, 60_000);
    this.cleanupTimer = setInterval(() => void this.cleanup(), interval);
    if (typeof this.cleanupTimer === "object" && "unref" in this.cleanupTimer) {
      this.cleanupTimer.unref();
    }
  }

  private async cleanup(): Promise<void> {
    const now = Date.now();
    const all = await this.store.list();
    for (const job of all) {
      if (
        (job.status === "completed" || job.status === "failed") &&
        now - job.updatedAt > this.ttlMs
      ) {
        await this.store.delete(job.jobId);
      }
    }
  }
}
