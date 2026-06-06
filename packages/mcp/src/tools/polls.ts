import { polls } from "@formstr/app/services";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { ok, fail } from "../result";
import { requireConfirm } from "../safety";

import type { RegisterCtx } from "./shared";

export function registerPolls(server: McpServer, ctx: RegisterCtx): void {
  // ── Read ──────────────────────────────────────────────
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
    "list_recent_polls",
    {
      description: "List recent public polls to discover/vote on.",
      inputSchema: { limit: z.number().optional() },
    },
    async ({ limit }: { limit?: number }) => {
      const recent = await polls.fetchRecentPolls(limit);
      return ok(`${recent.length} recent poll(s).`, {
        polls: recent.map((p) => ({
          id: p.id,
          question: p.content,
          pollType: p.pollType,
          pubkey: p.pubkey,
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
      const poll = await polls.fetchPoll(pollEventId);
      if (!poll) return fail("Poll not found.");
      const results = await polls.fetchPollResults(poll);
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

  // ── Constructive ──────────────────────────────────────
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

  // ── Gated (destructive / outward) ─────────────────────
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
      await polls.submitPollResponse(pollEventId, poll.pubkey, optionIds, poll.relays);
      return ok(`Voted on poll ${pollEventId}.`);
    },
  );

  server.registerTool(
    "delete_poll",
    {
      description: "Delete a poll you authored (NIP-09). Requires confirm:true.",
      inputSchema: { pollEventId: z.string(), confirm: z.boolean().optional() },
    },
    async ({ pollEventId, confirm }: { pollEventId: string; confirm?: boolean }) => {
      const blocked = requireConfirm("delete_poll", { confirm }, `deletes poll ${pollEventId}`);
      if (blocked) return blocked;
      const poll = await polls.fetchPoll(pollEventId);
      await polls.deletePoll(pollEventId, poll?.relays);
      return ok(`Deleted poll ${pollEventId}.`);
    },
  );

  server.registerTool(
    "clear_my_vote",
    {
      description: "Retract your own votes on a poll (NIP-09). Requires confirm:true.",
      inputSchema: { pollEventId: z.string(), confirm: z.boolean().optional() },
    },
    async ({ pollEventId, confirm }: { pollEventId: string; confirm?: boolean }) => {
      const blocked = requireConfirm(
        "clear_my_vote",
        { confirm },
        `clears your votes on ${pollEventId}`,
      );
      if (blocked) return blocked;
      const poll = await polls.fetchPoll(pollEventId);
      await polls.clearMyVotes(pollEventId, poll?.relays);
      return ok(`Cleared your votes on ${pollEventId}.`);
    },
  );
}
