import { polls } from "@formstr/app/services";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { ok, fail } from "../result";
import { requireConfirm } from "../safety";

import type { RegisterCtx } from "./shared";

export function registerPolls(server: McpServer, ctx: RegisterCtx): void {
  server.registerTool(
    "list_polls",
    { description: "List polls created by the user.", inputSchema: {} },
    async () => {
      const mine = await polls.fetchMyPolls();
      return ok(`You have ${mine.length} poll(s).`, {
        polls: mine.map((p) => ({
          id: p.id,
          question: p.content,
          pollType: p.pollType,
          createdAt: p.createdAt,
          endsAt: p.endsAt,
        })),
      });
    },
  );

  server.registerTool(
    "get_poll",
    {
      description: "Fetch a single poll (including option ids) by its event id.",
      inputSchema: { pollEventId: z.string() },
    },
    async ({ pollEventId }) => {
      const poll = await polls.fetchPoll(pollEventId);
      if (!poll) return fail("Poll not found.");
      return ok(`Poll "${poll.content}".`, {
        poll: {
          id: poll.id,
          question: poll.content,
          options: poll.options,
          pollType: poll.pollType,
          pubkey: poll.pubkey,
          createdAt: poll.createdAt,
          endsAt: poll.endsAt,
          hashtags: poll.hashtags,
        },
      });
    },
  );

  server.registerTool(
    "fetch_poll_results",
    {
      description: "Get current results/votes for a poll.",
      inputSchema: { pollEventId: z.string() },
    },
    async ({ pollEventId }) => {
      const results = await polls.fetchPollResults(pollEventId);
      const options = Array.from(results.results.entries()).map(([optionId, r]) => ({
        optionId,
        count: r.count,
        percentage: r.percentage,
      }));
      return ok(`Poll has ${results.totalVotes} vote(s).`, {
        totalVotes: results.totalVotes,
        options,
      });
    },
  );

  server.registerTool(
    "create_poll",
    {
      description: "Create a new poll/vote.",
      inputSchema: {
        question: z.string(),
        options: z.array(z.string()).min(2),
        pollType: z.enum(["singlechoice", "multiplechoice"]).optional(),
        endsAt: z.string().optional(),
        hashtags: z.array(z.string()).optional(),
      },
    },
    async (args) => {
      const poll = await polls.createPoll({
        question: args.question,
        options: args.options.map((label) => ({ label })),
        pollType: args.pollType ?? "singlechoice",
        endsAt: args.endsAt ? new Date(args.endsAt) : undefined,
        hashtags: args.hashtags,
      });
      return ok(`Created poll "${args.question}".`, { id: poll.id });
    },
  );

  // Read tools and constructive creates (above) are always available; only
  // destructive/outward actions below are gated behind --allow-writes.
  if (!ctx.allowWrites) return;

  server.registerTool(
    "submit_poll_response",
    {
      description: "Cast a vote on a poll on your identity. Requires confirm:true.",
      inputSchema: {
        pollEventId: z.string(),
        optionIds: z.array(z.string()).min(1),
        confirm: z.boolean().optional(),
      },
    },
    async ({ pollEventId, optionIds, confirm }) => {
      const blocked = requireConfirm(
        "submit_poll_response",
        { confirm },
        `votes on poll ${pollEventId}`,
      );
      if (blocked) return blocked;
      const poll = await polls.fetchPoll(pollEventId);
      if (!poll) return fail("Poll not found.");
      await polls.submitPollResponse(pollEventId, poll.pubkey, optionIds);
      return ok(`Voted on poll ${pollEventId}.`);
    },
  );
}
