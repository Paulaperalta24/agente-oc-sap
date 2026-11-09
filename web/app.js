const sessionId = crypto.randomUUID();
const form = document.querySelector("#chat-form");
const input = document.querySelector("#message-input");
const messages = document.querySelector("#messages");
const thinking = document.querySelector("#thinking");
const confirmation = document.querySelector("#confirmation");
const sendButton = document.querySelector("#send-button");
const apiStatus = document.querySelector("#api-status");

const addMessage = (text, role, label) => {
  const message = document.createElement("article");
  message.className = `message ${role}`;
  message.innerHTML = `<p class="message-label">${label}</p><p></p>`;
  message.querySelector("p:last-child").textContent = text;
  messages.append(message);
  messages.scrollTop = messages.scrollHeight;
};

const addToolCall = (toolCall) => {
  const details = document.createElement("details");
  details.className = "tool-call";
  const summary = document.createElement("summary");
  summary.textContent = `Herramienta: ${toolCall.name}`;
  const content = document.createElement("pre");
  content.textContent = JSON.stringify({ argumentos: toolCall.args, resultado: toolCall.result }, null, 2);
  details.append(summary, content);
  messages.append(details);
  messages.scrollTop = messages.scrollHeight;
};

const setLoading = (isLoading) => {
  thinking.hidden = !isLoading;
  sendButton.disabled = isLoading;
  input.disabled = isLoading;
};

const sendMessage = async (text) => {
  addMessage(text, "user", "Tú");
  setLoading(true);
  confirmation.hidden = true;
  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId, message: text }),
    });
    const body = await response.json();
    if (!response.ok || body.ok === false) throw new Error(body.error || "La API no pudo procesar el mensaje.");
    for (const toolCall of body.toolCalls || []) addToolCall(toolCall);
    addMessage(body.reply || "No recibí una respuesta del agente.", "agent", "Agente OC");
    confirmation.hidden = !body.needsConfirmation;
  } catch (error) {
    addMessage(error instanceof Error ? error.message : "Error inesperado al procesar el mensaje.", "error", "Error de conexión");
  } finally {
    setLoading(false);
    input.focus();
  }
};

form.addEventListener("submit", (event) => {
  event.preventDefault();
  const text = input.value.trim();
  if (!text) return;
  input.value = "";
  void sendMessage(text);
});

document.querySelectorAll("[data-prompt]").forEach((button) => {
  button.addEventListener("click", () => {
    const prompt = button.dataset.prompt;
    if (prompt) void sendMessage(prompt);
  });
});

const checkHealth = async () => {
  try {
    const response = await fetch("/api/health");
    const health = await response.json();
    if (!health.ok) throw new Error();
    apiStatus.textContent = `API · ${health.model}`;
    apiStatus.className = "status ok";
  } catch {
    apiStatus.textContent = "API no disponible";
    apiStatus.className = "status error";
  }
};

void checkHealth();
