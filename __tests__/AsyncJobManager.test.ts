import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { AsyncJobManager } from "../src/jobs/AsyncJobManager.js";

describe("AsyncJobManager", () => {
  let manager: AsyncJobManager;

  beforeEach(() => {
    manager = new AsyncJobManager({ ttlMs: 60_000 });
  });

  afterEach(() => {
    manager.dispose();
  });

  describe("submit", () => {
    it("should create a job with queued status", async () => {
      const job = await manager.submit({
        toolName: "test/tool",
        requestId: "req-1",
        taskId: "task-1",
      });

      expect(job.jobId).toBeDefined();
      expect(job.status).toBe("queued");
      expect(job.toolName).toBe("test/tool");
    });

    it("should store metadata", async () => {
      const job = await manager.submit({
        toolName: "test/tool",
        requestId: "req-1",
        taskId: "task-1",
        metadata: { workflow: "image-gen" },
      });

      expect(job.metadata).toEqual({ workflow: "image-gen" });
    });
  });

  describe("lifecycle", () => {
    it("should transition through states", async () => {
      const job = await manager.submit({
        toolName: "test/tool",
        requestId: "req-1",
        taskId: "task-1",
      });

      await manager.markRunning(job.jobId);
      expect(await manager.getStatus(job.jobId)).toBe("running");

      await manager.complete(job.jobId, { output: "done" });
      expect(await manager.getStatus(job.jobId)).toBe("completed");

      const result = await manager.getResult(job.jobId);
      expect(result).toEqual({ output: "done" });
    });

    it("should handle failure", async () => {
      const job = await manager.submit({
        toolName: "test/tool",
        requestId: "req-1",
        taskId: "task-1",
      });

      await manager.fail(job.jobId, "Connection timeout");
      const failed = await manager.getJob(job.jobId);
      expect(failed?.status).toBe("failed");
      expect(failed?.error).toBe("Connection timeout");
    });
  });

  describe("events", () => {
    it("should emit events on state changes", async () => {
      const events: string[] = [];
      manager.on("submitted", () => events.push("submitted"));
      manager.on("running", () => events.push("running"));
      manager.on("completed", () => events.push("completed"));

      const job = await manager.submit({
        toolName: "test/tool",
        requestId: "req-1",
        taskId: "task-1",
      });
      await manager.markRunning(job.jobId);
      await manager.complete(job.jobId, {});

      expect(events).toEqual(["submitted", "running", "completed"]);
    });
  });

  describe("list", () => {
    it("should list jobs by filter", async () => {
      await manager.submit({ toolName: "a", requestId: "r1", taskId: "t1" });
      await manager.submit({ toolName: "b", requestId: "r2", taskId: "t2" });

      const all = await manager.list();
      expect(all.length).toBe(2);

      const filtered = await manager.list({ toolName: "a" });
      expect(filtered.length).toBe(1);
    });
  });

  describe("getResult", () => {
    it("should return undefined for non-completed jobs", async () => {
      const job = await manager.submit({
        toolName: "test/tool",
        requestId: "req-1",
        taskId: "task-1",
      });

      expect(await manager.getResult(job.jobId)).toBeUndefined();
    });

    it("should return undefined for unknown jobId", async () => {
      expect(await manager.getResult("unknown-id")).toBeUndefined();
    });
  });
});
