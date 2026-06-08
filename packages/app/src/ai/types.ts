export interface Message {
  id: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  toolCalls?: ToolCall[];
  toolCallId?: string;
  run?: RunStep[];
  timestamp: number;
}

export type ToolCallStatus = "pending" | "success" | "error";

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  status?: ToolCallStatus;
  resultMessage?: string;
}

export interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ToolParameter {
  type: string;
  description: string;
  enum?: string[];
  items?: ToolParameter;
  properties?: Record<string, ToolParameter>;
  required?: string[];
}

export interface GenerateOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

export interface StreamCallbacks {
  onToken: (token: string) => void;
  onToolCall?: (toolCall: ToolCall) => void;
  onToolResult?: (toolCallId: string, result: ActionResult) => void;
  onWarning?: (message: string) => void;
  onDone: () => void;
  onError: (error: Error) => void;
}

export interface LLMProvider {
  generate(
    messages: Message[],
    options?: GenerateOptions,
  ): Promise<{ content: string; toolCalls?: ToolCall[] }>;

  generateStream(
    messages: Message[],
    tools: ToolDefinition[],
    callbacks: StreamCallbacks,
    options?: GenerateOptions,
  ): Promise<void>;

  getAvailableModels(): Promise<string[]>;
  isAvailable(): Promise<boolean>;
}

export interface EntityRef {
  module: "forms" | "calendar" | "pages" | "drive" | "polls";
  ref: string;
  label: string;
  createdAt?: number;
  route?: string;
}

export interface ActionResult<T = unknown> {
  success: boolean;
  message?: string;
  data?: T;
  error?: string;
  ref?: string;
  entity?: EntityRef;
}

export type RunStepStatus = "running" | "success" | "error" | "declined";

export interface RunStep {
  id: string;
  toolName: string;
  module: EntityRef["module"] | null;
  status: RunStepStatus;
  resultText?: string;
  entity?: EntityRef;
}

export interface ConfirmRequest {
  /** matches the triggering tool call id */
  id: string;
  toolName: string;
  module: EntityRef["module"] | null;
  /** human-readable effect text (from the handler's requireConfirm message) */
  message: string;
}

export interface AgentCallbacks {
  onToken: (token: string) => void;
  /** clear the live streaming buffer (e.g. when switching from pre-tool chatter to tool execution) */
  onContentReset?: () => void;
  onStepStart?: (step: RunStep) => void;
  onStepUpdate?: (step: RunStep) => void;
  onEntity?: (entity: EntityRef) => void;
  /** resolve true to run a gated tool, false to decline */
  onConfirmRequired?: (req: ConfirmRequest) => Promise<boolean>;
  onWarning?: (message: string) => void;
  onDone: () => void;
  onError: (error: Error) => void;
}
