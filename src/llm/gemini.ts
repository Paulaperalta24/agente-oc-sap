import { GoogleGenAI } from "@google/genai"
import type { ChatMessage, LlmAdapter, ModelReply, ToolDefinition } from "./adapter.ts"

export class GeminiAdapter implements LlmAdapter {
  private readonly client: GoogleGenAI
  private readonly model: string

  constructor(apiKey = process.env.GEMINI_API_KEY, model = process.env.GEMINI_MODEL ?? "gemini-3.8-flash") {
    if (!apiKey) throw new Error("GEMINI_API_KEY no está configurada en el entorno del backend.")
    this.client = new GoogleGenAI({ apiKey })
    this.model = model
  }

  async enviar(messages: ChatMessage[], tools: ToolDefinition[]): Promise<ModelReply> {
    const response = await this.client.models.generateContent({
      model: this.model,
      contents: messages,
      config: {
        tools: [{ functionDeclarations: tools }],
      },
    })
    const content = response.candidates?.[0]?.content
    const functionCalls = response.functionCalls ?? []

    return {
      text: response.text ?? "",
      toolCalls: functionCalls.map((call) => ({
        id: call.id,
        name: call.name ?? "",
        args: (call.args ?? {}) as Record<string, unknown>,
      })),
      content: (content ?? { role: "model", parts: [{ text: response.text ?? "" }] }) as Record<string, unknown>,
    }
  }
}
