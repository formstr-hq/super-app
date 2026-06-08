import type { Message, EntityRef } from "./types";

export class ConversationContext {
  private history: Message[] = [];
  private entities: EntityRef[] = [];
  private _activeModule: EntityRef["module"] | null = null;

  addMessage(msg: Message): void {
    this.history.push(msg);
    // Keep history bounded to prevent unbounded growth
    if (this.history.length > 100) {
      // Keep system message + last 80 messages
      const system = this.history.filter((m) => m.role === "system");
      const recent = this.history.filter((m) => m.role !== "system").slice(-80);
      this.history = [...system, ...recent];
    }
  }

  registerEntity(entity: EntityRef): void {
    this.entities.push(entity);
    this._activeModule = entity.module;
    // Keep last 50 entities
    if (this.entities.length > 50) {
      this.entities = this.entities.slice(-50);
    }
  }

  getActiveEntity(module: EntityRef["module"]): EntityRef | null {
    for (let i = this.entities.length - 1; i >= 0; i--) {
      if (this.entities[i].module === module) return this.entities[i];
    }
    return null;
  }

  getRecentEntities(limit = 10): EntityRef[] {
    return this.entities.slice(-limit);
  }

  get activeModule(): EntityRef["module"] | null {
    return this._activeModule;
  }

  getMessages(): Message[] {
    return this.history;
  }

  getEntities(): EntityRef[] {
    return [...this.entities];
  }

  buildSystemPrompt(pubkey: string | null): string {
    const recentEntities = this.getRecentEntities(5);
    const entityContext =
      recentEntities.length > 0
        ? `\n\nRecently created/referenced entities:\n${recentEntities.map((e) => `- [${e.module}] ${e.label} (${e.ref})`).join("\n")}`
        : "";

    return `You are the Formstr Super App assistant. You help users manage forms, calendar events & scheduling, documents/pages, files, and polls — all built on the Nostr protocol.

You have a full set of tools spanning every module. Use them to take real actions, and chain multiple tool calls across modules in a single turn when a request needs it (e.g. create a poll, add a calendar event, then update a page). Read tools (list/get/fetch) and constructive creates run immediately; irreversible actions (delete, share, submit, rsvp, rename, move) will ask the user to confirm before running — call them normally and the app handles the confirmation.

For dates and times: the current date is ${new Date().toISOString().split("T")[0]}. Convert natural-language dates/times to ISO 8601.

For form fields: use "shortText" for short answers, "paragraph" for long text, "radioButton" for single-choice, "checkboxes" for multi-choice, "dropdown" for select menus, and "number"/"date"/"time"/"datetime" for typed inputs.

For polls: default to "singlechoice" unless the user asks for multiple choice.

${pubkey ? `User pubkey: ${pubkey}` : "User is not logged in — some actions require authentication."}
${this._activeModule ? `Currently active module: ${this._activeModule}` : ""}${entityContext}

Be concise. After you act, confirm what happened in one or two sentences. Do not use emojis.`;
  }

  reset(): void {
    this.history = [];
    this.entities = [];
    this._activeModule = null;
  }

  /** Rebuild context history from persisted messages (e.g. after page reload). */
  hydrateFromMessages(messages: Message[], entities?: EntityRef[]): void {
    // Only keep user/assistant messages — system and tool messages are regenerated
    this.history = messages.filter((m) => m.role === "user" || m.role === "assistant");
    if (this.history.length > 80) {
      this.history = this.history.slice(-80);
    }
    if (entities?.length) {
      this.entities = entities.slice(-50);
      this._activeModule = this.entities[this.entities.length - 1]?.module ?? null;
    }
  }
}
