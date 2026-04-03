import { createTool, Agent } from "@convex-dev/agent";
import { z } from "zod";
import Exa from "exa-js";
import { components, internal } from "../_generated/api";
import { resolveLanguageModel } from "../agent/modelResolver";

const DELETE_RESEARCH_THREADS = true;

async function getExaApiKey(ctx: any): Promise<string | null> {
  const telegramChatId = await ctx.runQuery((internal as any).users.db.getChatIdForThread, { threadId: ctx.threadId });
  if (telegramChatId) {
    const res = await ctx.runQuery((internal as any).users.db.getProviderConfig, { telegramChatId });
    if (res.exaApiKey) return res.exaApiKey;
  }
  return null;
}

/**
 * Basic search tool using Exa.
 */
export const exa_search = createTool({
  description: "Search the web using Exa's neural search. Returns titles, URLs, and snippets.",
  inputSchema: z.object({
    query: z.string().describe("The search query."),
    numResults: z.number().optional().default(5).describe("Number of results (max 10)."),
  }),
  execute: async (ctx, args) => {
    const apiKey = await getExaApiKey(ctx);
    if (!apiKey) return "NOTE: Web search is currently disabled (Exa API key missing). I will answer using my internal knowledge and provided file context.";
    
    try {
      console.log(`[exa_search] Searching: "${args.query.slice(0, 80)}..." (${args.numResults} results)`);
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
  description: "Retrieve the full text content of one or more web pages by their URLs.",
  inputSchema: z.object({
    urls: z.array(z.string()).describe("List of URLs to fetch content from."),
  }),
  execute: async (ctx, args) => {
    const apiKey = await getExaApiKey(ctx);
    if (!apiKey) return "NOTE: Web search is currently disabled (Exa API key missing). I cannot retrieve specific web content.";

    try {
      console.log(`[exa_get_contents] Fetching ${args.urls.length} URL(s)`);
      const exa = new Exa(apiKey);
      const result = await exa.getContents(args.urls, { text: true });
      console.log(`[exa_get_contents] Got ${result.results.length} result(s)`);
      return result.results.map(r => ({
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
    if (!apiKey) return "NOTE: Web search is currently disabled (Exa API key missing). I cannot find similar pages.";

    try {
      console.log(`[exa_find_similar] Finding similar to: ${args.url} (${args.numResults} results)`);
      const exa = new Exa(apiKey);
      const result = await exa.findSimilar(args.url, { numResults: args.numResults });
      console.log(`[exa_find_similar] Got ${result.results.length} results`);
      return result.results;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[exa_find_similar] Error:`, msg);
      return `Error finding similar: ${msg}`;
    }
  },
});

const researchInstructions = (query: string, mode: "quick" | "deep", injectedContext?: string) =>
  `You are a professional research and analysis assistant. Your task is to provide a ${mode === "quick" ? "QUICK, CONCISE" : "THOROUGH, COMPREHENSIVE"} answer or analysis for: "${query}".\n\n` +
  (injectedContext ? `### INJECTED CONTEXT (FILE CONTENTS)\n${injectedContext}\n\n` : '') +
  `Use your search tools to find high-quality information if the injected context is insufficient. ` +
  `Be direct and ${mode === "quick" ? "focused" : "thorough"}. Cite sources with URLs.` +
  (mode === "quick"
    ? ` When you have a satisfactory answer, end your response with on its own line: NEEDS DEEP RESEARCH: yes/no - brief reason if yes. Also include: CONFIDENCE: high/medium/low`
    : ` At the end, include: CONFIDENCE: high/medium/low`);

async function runResearchAgent(ctx: any, query: string, mode: "quick" | "deep", languageModel: any, injectedContext?: string): Promise<string> {
  const maxSteps = mode === "quick" ? 7 : 28;
  console.log(`[research] Starting ${mode} research agent for: "${query.slice(0, 60)}..." (maxSteps=${maxSteps})`);

  const { thread } = await new Agent(components.agent, {
    name: "Research Assistant",
    languageModel: languageModel,
  }).createThread(ctx, {
    title: `Research: ${query}`,
  });

  const threadId = (thread as any).threadId;
  console.log(`[research] Created research thread: ${threadId}`);

  if (mode === "deep") {
    const lastSent = await ctx.runQuery(internal.users.db.getLastSearchingSent, { threadId: ctx.threadId });
    const debounceMs = 3000;
    if (!lastSent || Date.now() - lastSent > debounceMs) {
      await ctx.runAction(internal.sessions.actions.sendTelegramMessage, {
        threadId: ctx.threadId,
        message: `Analyzing & Searching...`,
      });
      await ctx.runMutation(internal.users.db.updateLastSearchingSent, { threadId: ctx.threadId });
    }
  }

  try {
    const researchAgent = new Agent(components.agent, {
      name: "Research Assistant",
      languageModel: languageModel,
      instructions: researchInstructions(query, mode, injectedContext),
      tools: {
        exa_search,
        exa_get_contents,
        exa_find_similar,
      },
      maxSteps,
    });

    const result = await researchAgent.generateText(ctx, { threadId }, {
      prompt: `Please start your research/analysis on: "${query}"`,
    });

    if (DELETE_RESEARCH_THREADS) {
      await researchAgent.deleteThreadAsync(ctx, { threadId });
    }

    const suffix = mode === "quick" && (result as any).finishReason === "maxSteps"
      ? `\n\n[research may be incomplete — consider using deep research for more]`
      : "";

    console.log(`[research] Completed ${mode} research for: "${query.slice(0, 60)}..."`);
    return `### Research/Analysis: "${query}"\n\n${result.text}${suffix}`;
  } catch (error: any) {
    console.error(`[research] Error during ${mode} research:`, error.message || String(error));
    return `Error during research: ${error.message || String(error)}`;
  }
}

/**
 * research — Delegate tasks to the Research Agent. Replaces ask_research_agent.
 * Can perform web research AND analyze files dynamically injected into its context.
 */
export const research = createTool({
  description: "Delegate tasks to the Research Agent. Use 'quick' for fast answers, 'deep' for thorough multi-step research. You can optionally inject files from uploaded files (by assignedName) or from a Jules session (by file paths).",
  inputSchema: z.object({
    query: z.string().describe("The research query, question, or analysis instruction."),
    mode: z.enum(["quick", "deep"]).optional().default("quick").describe("Quick for fast answers, deep for thorough research."),
    files: z.array(
      z.discriminatedUnion("type", [
        // Session files: single session, one or more file paths
        z.object({
          type: z.literal("session"),
          julesSessionId: z.string().describe("The Jules session ID."),
          filePaths: z.union([z.string(), z.array(z.string())]).describe("Single file path or array of file paths from this session."),
        }),
        // Uploaded files: by assignedName
        z.object({
          type: z.literal("uploaded"),
          names: z.array(z.string()).describe("Array of file assignedNames from your Registered Files list."),
        }),
      ])
    ).optional().describe("Files to inject into research context. Can mix session files and uploaded files."),
  }),
  execute: async (ctx, args) => {
    try {
      if (!ctx.threadId) throw new Error("Tool must be called within a thread context.");
      console.log(`[research] Starting research: "${args.query.slice(0, 80)}..." (mode=${args.mode})`);
      
      const foundFiles: { name: string; content: string }[] = [];
      const missingFiles: string[] = [];

    // Pre-validate and fetch all files
    if (args.files && args.files.length > 0) {
      for (const fileSpec of args.files) {
        if (fileSpec.type === "uploaded") {
          // Fetch uploaded files by assignedName
          for (const name of fileSpec.names) {
            try {
              const fileInfo = await ctx.runQuery((internal as any).files.db.getFileByAssignedName, { 
                threadId: ctx.threadId, 
                assignedName: name 
              });
              
              if (!fileInfo) {
                missingFiles.push(name);
                continue;
              }

              const response = await fetch(fileInfo.url);
              if (!response.ok) {
                missingFiles.push(`${name} (fetch failed: ${response.statusText})`);
                continue;
              }

              const content = await response.text();
              foundFiles.push({ name: fileInfo.name, content });
            } catch (err: any) {
              missingFiles.push(`${name} (error: ${err.message})`);
            }
          }
        } else if (fileSpec.type === "session") {
          // Fetch session files
          const paths = Array.isArray(fileSpec.filePaths) 
            ? fileSpec.filePaths 
            : [fileSpec.filePaths];

          const outputs = await ctx.runQuery(internal.sessions.db.getSessionOutputs, { 
            julesSessionId: fileSpec.julesSessionId 
          });

          // Build map of latest files from session outputs
          const sessionFiles = new Map<string, string>();
          for (const out of outputs) {
            if (out && out.type === 'changeSet' && out.extractedFiles) {
              for (const file of out.extractedFiles as any[]) {
                sessionFiles.set(file.path, file.content);
              }
            }
          }

          for (const path of paths) {
            const content = sessionFiles.get(path);
            if (content) {
              foundFiles.push({ name: path, content });
            } else {
              missingFiles.push(path);
            }
          }
        }
      }
    }

    // Build injected context from found files
    let injectedContext = "";
    for (const file of foundFiles) {
      injectedContext += `--- FILE: ${file.name} ---\n${file.content}\n\n`;
    }

    // Run research
    console.log(`[research] Running ${args.mode} research with ${foundFiles.length} file(s) in context`);
    const researchResult = await runResearchAgent(
      ctx, 
      args.query, 
      args.mode, 
      await resolveLanguageModel(ctx, ctx.threadId), 
      injectedContext.trim() || undefined
    );

    // Build response with warning if files are missing
    let response = researchResult;
    
    if (missingFiles.length > 0) {
      console.warn(`[research] ${missingFiles.length} file(s) missing: ${missingFiles.join(", ")}`);
      const warning = `\n\n⚠️ WARNING: The following files were not found and were skipped:\n${missingFiles.map(f => `- ${f}`).join("\n")}\n\nResearch completed with ${foundFiles.length} available file(s).`;
      response = warning + "\n\n" + response;
    }

    return response;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[research] Error:`, msg);
      return `Error during research: ${msg}`;
    }
  },
});
