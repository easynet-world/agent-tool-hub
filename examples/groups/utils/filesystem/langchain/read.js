import { StructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { readText } from "./_shared.js";

/**
 * Filesystem read tool using LangChain's StructuredTool interface.
 * Reads a text file from disk.
 */
class FileReadTool extends StructuredTool {
  name = "filesystem_read";
  description = "Read a text file from disk";

  schema = z.object({
    path: z.string().describe("File path to read"),
  });

  async _call({ path }) {
    return readText(path);
  }
}

export default new FileReadTool();
