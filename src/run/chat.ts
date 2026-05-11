import { createInterface } from "node:readline";
import type { Message } from "@mariozechner/pi-ai";
import type { SummarizeConfig } from "../config.js";
import { streamChatResponse } from "../daemon/chat.js";

export type ChatSource = {
  url: string;
  title: string | null;
  content: string;
};

function isExitCommand(input: string): boolean {
  const normalized = input.trim().toLowerCase();
  return normalized === "exit" || normalized === "quit" || normalized === ":q";
}

export async function runSourceChat(options: {
  env: Record<string, string | undefined>;
  fetchImpl: typeof fetch;
  configForCli: SummarizeConfig | null;
  stdin: NodeJS.ReadableStream;
  stdout: NodeJS.WritableStream;
  stderr: NodeJS.WritableStream;
  source: ChatSource;
  modelOverride: string | null;
}): Promise<void> {
  const { env, fetchImpl, configForCli, stdin, stdout, stderr, source, modelOverride } = options;
  const messages: Message[] = [];
  const rl = createInterface({
    input: stdin,
    output: stderr,
    prompt: "chat> ",
    terminal: Boolean((stderr as { isTTY?: boolean }).isTTY),
  });

  stderr.write("\nChat mode. Ask about the source; type exit or press Ctrl-D to quit.\n");
  rl.prompt();

  for await (const line of rl) {
    const question = line.trim();
    if (!question) {
      rl.prompt();
      continue;
    }
    if (isExitCommand(question)) break;

    messages.push({ role: "user", content: question, timestamp: Date.now() });
    let answer = "";
    try {
      await streamChatResponse({
        env,
        fetchImpl,
        configForCli,
        session: {
          id: "cli",
          lastMeta: {
            model: null,
            modelLabel: null,
            inputSummary: null,
            summaryFromCache: null,
          },
        },
        pageUrl: source.url,
        pageTitle: source.title,
        pageContent: source.content,
        messages,
        modelOverride,
        pushToSession: (event) => {
          if (event.event !== "content" || typeof event.data !== "string") return;
          answer += event.data;
          stdout.write(event.data);
        },
        emitMeta: () => {},
      });
      if (!answer.endsWith("\n")) stdout.write("\n");
      messages.push({
        role: "assistant",
        content: answer,
        timestamp: Date.now(),
      } as unknown as Message);
    } catch (error) {
      messages.pop();
      const message = error instanceof Error ? error.message : String(error);
      stderr.write(`Chat error: ${message}\n`);
    }
    rl.prompt();
  }

  rl.close();
}
