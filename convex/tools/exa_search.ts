import { createTool, Agent } from "@convex-dev/agent";
import { z } from "zod";
import Exa from "exa-js";
import { components, internal } from "../_generated/api";
import { createAnthropic } from "@ai-sdk/anthropic";

const DELETE_RESEARCH_THREADS = false;

const anthropic = createAnthropic({
  baseURL: "https://opencode.ai/zen/go/v1/",
  apiKey: process.env.OPENCODE_GO_API_KEY,
});

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
    
    const exa = new Exa(apiKey);
    const result = await exa.search(args.query, {
      numResults: Math.min(args.numResults, 10),
      useAutoprompt: true,
    });
    return result.results;
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

    const exa = new Exa(apiKey);
    const result = await exa.getContents(args.urls, { text: true });
    return result.results.map(r => ({
      title: r.title,
      url: r.url,
      content: r.text ? r.text.substring(0, 5000) : "No content available.",
    }));
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

    const exa = new Exa(apiKey);
    const result = await exa.findSimilar(args.url, { numResults: args.numResults });
    return result.results;
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

async function runResearchAgent(ctx: any, query: string, mode: "quick" | "deep", injectedContext?: string): Promise<string> {
  const maxSteps = mode === "quick" ? 7 : 28;

  const model = anthropic("minimax-m2.5");
  const { thread } = await new Agent(components.agent, {
    name: "Research Assistant",
    languageModel: model,
  }).createThread(ctx, {
    title: `Research: ${query}`,
  });

  const threadId = (thread as any).threadId;

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
      languageModel: model,
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

    return `### Research/Analysis: "${query}"\n\n${result.text}${suffix}`;
  } catch (error: any) {
    return `Error during research: ${error.message || String(error)}`;
  }
}

/**
 * research — Delegate tasks to the Research Agent. Replaces ask_research_agent.
 * Can perform web research AND analyze files dynamically injected into its context.
 */
export const research = createTool({
  description: "Delegate tasks to the Research Agent. Use 'quick' for fast answers, 'deep' for thorough multi-step research. You can optionally pass IDs of user-uploaded files or paths from a Jules session to have the agent analyze those files.",
  inputSchema: z.object({
    query: z.string().describe("The research query, question, or analysis instruction."),
    mode: z.enum(["quick", "deep"]).optional().default("quick").describe("Quick for fast answers, deep for thorough research."),
    injectUploadedFileIds: z.array(z.string()).optional().describe("Array of uploaded file IDs to inject into the agent's context (get these from your Inbox/Registered list)."),
    injectSessionFiles: z.array(z.object({
      julesSessionId: z.string(),
      path: z.string()
    })).optional().describe("Array of files from a Jules session to inject. Provide the sessionId and the exact file path."),
  }),
  execute: async (ctx, args) => {
    if (!ctx.threadId) throw new Error("Tool must be called within a thread context.");
    
    let injectedContext = "";

    // 1. Fetch Uploaded Files
    if (args.injectUploadedFileIds && args.injectUploadedFileIds.length > 0) {
      for (const fileId of args.injectUploadedFileIds) {
        try {
          const { url, name } = await ctx.runQuery((internal as any).files.db.getFileTextContent, { fileId });
          const response = await fetch(url);
          if (!response.ok) throw new Error(`Fetch failed: ${response.statusText}`);
          const text = await response.text();
          injectedContext += `--- FILE: ${name} ---\n${text}\n\n`;
        } catch (err: any) {
          injectedContext += `--- FILE: ${fileId} ---\n[Error reading file: ${err.message}]\n\n`;
        }
      }
    }

    // 2. Fetch Session Files
    if (args.injectSessionFiles && args.injectSessionFiles.length > 0) {
      for (const sf of args.injectSessionFiles) {
        try {
          const outputs = await ctx.runQuery(internal.sessions.db.getSessionOutputs, { julesSessionId: sf.julesSessionId });
          let fileContent: string | undefined;
          for (let i = outputs.length - 1; i >= 0; i--) {
            const out = outputs[i];
            if (out && out.type === 'changeSet' && out.extractedFiles) {
              const file = (out.extractedFiles as any[]).find((f: any) => f.path === sf.path);
              if (file) {
                fileContent = file.content;
                break;
              }
            }
          }
          if (fileContent) {
            injectedContext += `--- SESSION FILE: ${sf.path} (Session: ${sf.julesSessionId}) ---\n${fileContent}\n\n`;
          } else {
            injectedContext += `--- SESSION FILE: ${sf.path} ---\n[Error: File not found in session]\n\n`;
          }
        } catch (err: any) {
          injectedContext += `--- SESSION FILE: ${sf.path} ---\n[Error reading session file: ${err.message}]\n\n`;
        }
      }
    }

    return runResearchAgent(ctx, args.query, args.mode, injectedContext.trim() || undefined);
  },
});
