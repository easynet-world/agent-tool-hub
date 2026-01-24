import { StructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { deletePath } from "./_shared.js";

/**
 * Filesystem delete tool using LangChain's StructuredTool interface.
 * Deletes a file or directory.
 */
class FileDeleteTool extends StructuredTool {
  name = "filesystem_delete";
  description = "Delete a file or directory from disk";

  schema = z.object({
    path: z.string().describe("File or directory path to delete"),
  });

  async _call({ path }) {
    return deletePath(path);
  }
}

export default new FileDeleteTool();
