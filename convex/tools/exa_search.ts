import { createTool, Agent } from "@convex-dev/agent";
import { z } from "zod";
import Exa from "exa-js";
import { components, internal } from "../_generated/api";
import { resolveLanguageModel } from "../agent/modelResolver";

const DELETE_RESEARCH_THREADS = true;

async function getExaApiKey(ctx: any): Promise<string | null> {
  const telegramChatId = await ctx.runQuery(
    (internal as any).users.db.getChatIdForThread,
    { threadId: ctx.threadId },
  );
  if (telegramChatId) {
    const res = await ctx.runQuery(
      (internal as any).users.db.getProviderConfig,
      { telegramChatId },
    );
    if (res.exaApiKey) return res.exaApiKey;
  }
  return null;
}

/**
 * Basic search tool using Exa.
 */
export const exa_search = createTool({
  description:
    "Search the web using Exa's neural search. Returns titles, URLs, and snippets.",
  inputSchema: z.object({
    query: z.string().describe("The search query."),
    numResults: z
      .number()
      .optional()
      .default(5)
      .describe("Number of results (max 10)."),
  }),
  execute: async (ctx, args) => {
    const apiKey = await getExaApiKey(ctx);
    if (!apiKey)
      return "NOTE: Web search is currently disabled (Exa API key missing). I will answer using my internal knowledge and provided file context.";

    try {
      console.log(
        `[exa_search] Searching: "${args.query.slice(0, 80)}..." (${args.numResults} results)`,
      );
      const exa = new Exa(apiKey);
      const result = await exa.search(args.query, {
        numResults: Math.min(args.numResults, 10),
        useAutoprompt: true,
      });
      console.log(`[exa_search] Got ${result.results.length} results`);
      return result.results;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[exa_search] Error:`, msg);
      return `Error searching: ${msg}`;
    }
  },
});

/**
 * Retrieve full text content for specific URLs.
 */
export const exa_get_contents = createTool({
  description:
    "Retrieve the full text content of one or more web pages by their URLs.",
  inputSchema: z.object({
    urls: z.array(z.string()).describe("List of URLs to fetch content from."),
  }),
  execute: async (ctx, args) => {
    const apiKey = await getExaApiKey(ctx);
    if (!apiKey)
      return "NOTE: Web search is currently disabled (Exa API key missing). I cannot retrieve specific web content.";

    try {
      console.log(`[exa_get_contents] Fetching ${args.urls.length} URL(s)`);
      const exa = new Exa(apiKey);
      const result = await exa.getContents(args.urls, { text: true });
      console.log(`[exa_get_contents] Got ${result.results.length} result(s)`);
      return result.results.map((r) => ({
        title: r.title,
        url: r.url,
        content: r.text ? r.text.substring(0, 5000) : "No content available.",
      }));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[exa_get_contents] Error:`, msg);
      return `Error fetching contents: ${msg}`;
    }
  },
});

/**
 * Find similar pages to a given URL.
 */
export const exa_find_similar = createTool({
  description: "Find web pages similar to a given URL.",
  inputSchema: z.object({
    url: z.string().describe("The URL to find similarities for."),
    numResults: z.number().optional().default(5).describe("Number of results."),
  }),
  execute: async (ctx, args) => {
    const apiKey = await getExaApiKey(ctx);
    if (!apiKey)
      return "NOTE: Web search is currently disabled (Exa API key missing). I cannot find similar pages.";

    try {
      console.log(
        `[exa_find_similar] Finding similar to: ${args.url} (${args.numResults} results)`,
      );
      const exa = new Exa(apiKey);
      const result = await exa.findSimilar(args.url, {
        numResults: args.numResults,
      });
      console.log(`[exa_find_similar] Got ${result.results.length} results`);
      return result.results;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[exa_find_similar] Error:`, msg);
      return `Error finding similar: ${msg}`;
    }
  },
});

const researchInstructions = (
  query: string,
  availablePaths: string,
) =>
  `You are a professional research and analysis assistant. Your task is to provide a thorough answer or analysis for: "${query}".\n\n` +
  `### LOCAL FILES\n${availablePaths}\n\n` +
  `Use vfs_ls to browse directories and vfs_read to read file contents. ` +
  `Read the files mentioned in the task above. ` +
  `Use exa_search for web research when local files are insufficient. ` +
  `Be direct and thorough. Cite sources with URLs when using web results.\n` +
  `At the end, include: CONFIDENCE: high/medium/low`;

/**
 * Create VFS tools scoped to a specific thread ID.
 * These are injected into the research sub-agent.
 */
function createResearchVfsTools(parentThreadId: string) {
  const researchVfsLs = createTool({
    description: "List files in the virtual file system.",
    inputSchema: z.object({
      path: z.string().optional().default("/").describe("Directory to list."),
    }),
    execute: async (ctx, args) => {
      const entries = await ctx.runQuery(internal.vfs.db.listThreadVfs, {
        threadId: parentThreadId,
        vfsPath: args.path,
        depth: 1,
      });

      if (entries.length === 0) {
        return `No files found at '${args.path}'.`;
      }

      let output = "";
      for (const entry of entries) {
        const type = entry.isDirectory ? "[dir] " : "[file]";
        output += `  ${type} ${entry.path}\n`;
      }
      return output.trim();
    },
  });

  const researchVfsRead = createTool({
    description: "Read a file from the virtual file system.",
    inputSchema: z.object({
      path: z.string().describe("VFS path to the file."),
    }),
    execute: async (ctx, args) => {
      const resolved = await ctx.runQuery(internal.vfs.resolver.resolveVfsRead, {
        threadId: parentThreadId,
        vfsPath: args.path,
      });

      if (!resolved) {
        return `File not found: ${args.path}`;
      }

      const content = await ctx.runAction(internal.vfs.actions.fetchContent, {
        storageId: resolved.storageId as any,
      });

      return `[FILE: ${args.path}]\n${content}`;
    },
  });

  return { researchVfsLs, researchVfsRead };
}

async function runResearchAgent(
  ctx: any,
  query: string,
  parentThreadId: string,
  languageModel: any,
): Promise<string> {
  const maxSteps = 50;
  console.log(
    `[research] Starting research agent for: "${query.slice(0, 60)}..." (maxSteps=${maxSteps})`,
  );

  const { thread } = await new Agent(components.agent, {
    name: "Research Assistant",
    languageModel: languageModel,
  }).createThread(ctx, {
    title: `Research: ${query}`,
  });

  const threadId = (thread as any).threadId;
  console.log(`[research] Created research thread: ${threadId}`);

  // List all files from parent thread for the research agent's context
  const entries = await ctx.runQuery(internal.vfs.db.listThreadVfs, {
    threadId: parentThreadId,
    vfsPath: "/",
    depth: 1,
  });
  const availablePaths = entries.map((e: any) => `- ${e.path}`).join("\n")
    || "No local files available.";

  const vfsTools = createResearchVfsTools(parentThreadId);

  try {
    const researchAgent = new Agent(components.agent, {
      name: "Research Assistant",
      languageModel: languageModel,
      instructions: researchInstructions(query, availablePaths),
      tools: {
        exa_search,
        exa_get_contents,
        exa_find_similar,
        ...vfsTools,
      },
      maxSteps,
    });

    const result = await researchAgent.generateText(
      ctx,
      { threadId },
      {
        prompt: `Please start your research/analysis on: "${query}"`,
      },
    );

    if (DELETE_RESEARCH_THREADS) {
      await researchAgent.deleteThreadAsync(ctx, { threadId });
    }

    console.log(
      `[research] Completed research for: "${query.slice(0, 60)}..."`,
    );
    return `### Research/Analysis: "${query}"\n\n${result.text}`;
  } catch (error: any) {
    console.error(
      `[research] Error during research:`,
      error.message || String(error),
    );
    return `Error during research: ${error.message || String(error)}`;
  }
}

/**
 * research — Spawn a research sub-agent with web search and local file access via VFS.
 * Tell the agent which files to check in the query string — it has full VFS access.
 */
export const research = createTool({
  description:
    "Spawn a research sub-agent that can analyze local files (via VFS) and search the web (via Exa). The agent has access to all thread files. Mention specific file paths in your query if needed.",
  inputSchema: z.object({
    query: z
      .string()
      .describe("The research query. Mention specific file paths (e.g. '/sessions/fix-auth/files/src/login.ts') if you want the agent to read them."),
  }),
  execute: async (ctx, args) => {
    try {
      if (!ctx.threadId)
        throw new Error("Tool must be called within a thread context.");
      console.log(
        `[research] Starting research: "${args.query.slice(0, 80)}..."`,
      );

      const model = await resolveLanguageModel(ctx, ctx.threadId, ctx.userId);
      return await runResearchAgent(
        ctx,
        args.query,
        ctx.threadId,
        model,
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[research] Error:`, msg);
      return `Error during research: ${msg}`;
    }
  },
});
