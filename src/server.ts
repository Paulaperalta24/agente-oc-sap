import { appendFile, readFile } from "node:fs/promises"
import { join } from "node:path"
import { z } from "zod"
import { GeminiAdapter } from "./llm/gemini.ts"
import type { ChatMessage, ToolDefinition } from "./llm/adapter.ts"
import { construir_payload, crear, generar_evidencia, leer_paquete, validar } from "./tools/oc.ts"

type Session = {
  messages: ChatMessage[]
  pendingConfirmation: boolean
}

type ToolCallLog = {
  name: string
  args: Record<string, unknown>
  result: unknown
}

type Tool = {
  args: Record<string, z.ZodType>
  execute: (args: Record<string, unknown>, context: { directory: string; sessionId: string }) => Promise<string>
}

const directory = import.meta.dir ? join(import.meta.dir, "..") : process.cwd()
const prompt = await readFile(join(directory, "agent", "prompt.md"), "utf8")
const sessions = new Map<string, Session>()
const maxIterations = 8

const toolEntries = [
  ["oc_leer_paquete", leer_paquete],
  ["oc_validar", validar],
  ["oc_generar_evidencia", generar_evidencia],
  ["oc_construir_payload", construir_payload],
  ["oc_crear", crear],
] as const

const toJsonSchema = (args: Record<string, z.ZodType>): Record<string, unknown> => {
  try {
    return z.toJSONSchema(z.object(args), { unrepresentable: "any" }) as Record<string, unknown>
  } catch {
    return { type: "object", properties: {}, additionalProperties: true }
  }
}

const tools: ToolDefinition[] = toolEntries.map(([name, tool]) => ({
  name,
  description: tool.description,
  parametersJsonSchema: toJsonSchema(tool.args),
}))

const toolByName = new Map<string, Tool>(toolEntries.map(([name, tool]) => [name, tool as unknown as Tool]))
const json = (data: unknown, status = 200): Response => Response.json(data, { status })

const writeLog = async (entry: unknown): Promise<void> => {
  await appendFile(join(directory, "out", "log.jsonl"), `${JSON.stringify(entry)}\n`)
}

const executeTool = async (name: string, args: Record<string, unknown>, sessionId: string): Promise<unknown> => {
  const tool = toolByName.get(name)
  if (!tool) return { ok: false, error: `Herramienta desconocida: ${name}` }
  const parsed = z.object(tool.args).safeParse(args)
  if (!parsed.success) return { ok: false, error: parsed.error.issues.map((issue) => issue.message).join("; ") }
  return JSON.parse(await tool.execute(parsed.data, { directory, sessionId })) as unknown
}

const isConfirmation = (message: string): boolean => /\b(confirmo|confirmada|confirmar|sí|si|aprobar|aprobado)\b/i.test(message)
const userText = (text: string): ChatMessage => ({ role: "user", parts: [{ text }] })

const runAgent = async (sessionId: string, message: string) => {
  const session = sessions.get(sessionId) ?? { messages: [], pendingConfirmation: false }
  const model = new GeminiAdapter()
  const toolCalls: ToolCallLog[] = []
  const workingMessage = session.pendingConfirmation && isConfirmation(message)
    ? "La persona confirmó explícitamente las excepciones pendientes. Continúa el caso y usa confirmado: true al crear la OC si corresponde."
    : message
  session.messages.push(userText(workingMessage))

  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    const reply = await model.enviar([{ role: "user", parts: [{ text: prompt }] }, ...session.messages], tools)
    session.messages.push(reply.content as ChatMessage)

    if (reply.toolCalls.length === 0) {
      const needsConfirmation = /confirmación|confirma|confirmar/i.test(reply.text)
      session.pendingConfirmation = needsConfirmation
      sessions.set(sessionId, session)
      await writeLog({ ts: new Date().toISOString(), sessionId, message, toolCalls, reply: reply.text })
      return { reply: reply.text, toolCalls, needsConfirmation }
    }

    const results = await Promise.all(reply.toolCalls.map(async (call) => {
      const result = await executeTool(call.name, call.args, sessionId)
      const item = { name: call.name, args: call.args, result }
      toolCalls.push(item)
      return { name: call.name, id: call.id, response: { output: result } }
    }))
    session.messages.push({ role: "user", parts: results.map((result) => ({ functionResponse: result })) })
  }

  const reply = "Alcancé el límite de iteraciones de herramientas. Revisa los resultados mostrados y continúa con la información pendiente."
  session.messages.push({ role: "model", parts: [{ text: reply }] })
  sessions.set(sessionId, session)
  await writeLog({ ts: new Date().toISOString(), sessionId, message, toolCalls, reply })
  return { reply, toolCalls, needsConfirmation: false }
}

const server = Bun.serve({
  hostname: "0.0.0.0",
  port: Number(process.env.PORT ?? 3000),
  async fetch(request) {
    const url = new URL(request.url)
    if (request.method === "GET" && url.pathname === "/") return new Response(Bun.file(join(directory, "web", "index.html")), { headers: { "content-type": "text/html; charset=utf-8" } })
    if (request.method === "GET" && url.pathname === "/styles.css") return new Response(Bun.file(join(directory, "web", "styles.css")), { headers: { "content-type": "text/css; charset=utf-8" } })
    if (request.method === "GET" && url.pathname === "/app.js") return new Response(Bun.file(join(directory, "web", "app.js")), { headers: { "content-type": "text/javascript; charset=utf-8" } })
    if (request.method === "GET" && url.pathname === "/api/health") return json({ ok: true, provider: "gemini", model: process.env.GEMINI_MODEL ?? "gemini-3.8-flash" })
    if (request.method === "GET" && url.pathname.startsWith("/api/sessions/")) {
      const sessionId = url.pathname.split("/").at(-1) ?? ""
      const session = sessions.get(sessionId)
      return session ? json(session) : json({ ok: false, error: "Sesión no encontrada." }, 404)
    }
    if (request.method === "POST" && url.pathname === "/api/chat") {
      try {
        const body = await request.json() as { sessionId?: string; message?: string }
        if (!body.sessionId || !body.message) return json({ ok: false, error: "sessionId y message son obligatorios." }, 400)
        return json(await runAgent(body.sessionId, body.message))
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "No fue posible procesar el mensaje."
        return json({ ok: false, error: errorMessage }, 500)
      }
    }
    return json({ ok: false, error: "Ruta no encontrada." }, 404)
  },
})

console.log(`API disponible en http://localhost:${server.port}`)
