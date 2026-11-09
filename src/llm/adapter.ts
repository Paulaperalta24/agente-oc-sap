export type ChatMessage = {
  role: "user" | "model"
  parts: Array<Record<string, unknown>>
}

export type ToolDefinition = {
  name: string
  description: string
  parametersJsonSchema: Record<string, unknown>
}

export type RequestedToolCall = {
  id?: string
  name: string
  args: Record<string, unknown>
}

export type ModelReply = {
  text: string
  toolCalls: RequestedToolCall[]
  content: Record<string, unknown>
}

export interface LlmAdapter {
  enviar(messages: ChatMessage[], tools: ToolDefinition[]): Promise<ModelReply>
}
