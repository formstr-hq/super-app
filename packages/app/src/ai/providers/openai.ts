import { OpenAICompatibleProvider } from "./openaiCompatible";

export class OpenAIProvider extends OpenAICompatibleProvider {
  constructor(apiKey: string, defaultModel = "gpt-4o-mini") {
    super({ baseUrl: "https://api.openai.com/v1", apiKey, defaultModel });
  }

  async isAvailable(): Promise<boolean> {
    return Boolean(this.apiKey);
  }
}
