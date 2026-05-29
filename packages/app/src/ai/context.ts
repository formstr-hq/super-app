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
    const entityContext = recentEntities.length > 0
      ? `\n\nRecently created/referenced entities:\n${recentEntities.map((e) => `- [${e.module}] ${e.label} (${e.ref})`).join("\n")}`
      : "";

    return `You are the Formstr Super App assistant. You help users manage forms, calendar events, documents, files, and polls — all built on the Nostr protocol.

Available capabilities:
- Forms: create forms/surveys with various field types, view form responses
- Calendar: create/delete calendar events (public or private/encrypted)
- Pages: create/update documents (Markdown), save private notes, share pages
- Drive: browse encrypted files
- Polls: create polls with single or multiple choice, view poll results

When the user asks you to do something, use the available tools to perform the action.
If the request spans multiple modules, execute them in sequence.

For dates and times: the current date is ${new Date().toISOString().split("T")[0]}. Convert natural language dates/times to ISO 8601 format.

For form fields:
- Use "shortText" for short answers, "paragraph" for long text
- Use "radioButton" for single-choice, "checkboxes" for multi-choice, "dropdown" for select menus
- Use "number", "date", "time", "datetime" for specific input types

For polls: default to "singlechoice" unless the user specifies multiple choice.

${pubkey ? `User pubkey: ${pubkey}` : "User is not logged in — some actions require authentication."}
${this._activeModule ? `Currently active module: ${this._activeModule}` : ""}${entityContext}

Be concise. When you create something, confirm what was created with a brief summary. Do not use emojis.`;
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
