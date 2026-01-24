import { StructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { listDir } from "./_shared.js";

/**
 * Filesystem list tool using LangChain's StructuredTool interface.
 * Lists entries in a directory.
 */
class FileListTool extends StructuredTool {
  name = "filesystem_list";
  description = "List files and directories at a given path";

  schema = z.object({
    path: z.string().describe("Directory path to list"),
  });

  async _call({ path }) {
    return listDir(path);
  }
}

export default new FileListTool();
