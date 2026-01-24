import { StructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { writeText } from "./_shared.js";

/**
 * Filesystem write tool using LangChain's StructuredTool interface.
 * Writes text content to disk.
 */
class FileWriteTool extends StructuredTool {
  name = "filesystem_write";
  description = "Write text content to a file on disk";

  schema = z.object({
    path: z.string().describe("File path to write"),
    content: z.string().describe("Content to write"),
  });

  async _call({ path, content }) {
    if (!content) {
      throw new Error("Content is required for write operation");
    }
    return writeText(path, content);
  }
}

export default new FileWriteTool();
