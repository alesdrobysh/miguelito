import type { ChatMessage } from "../providers/interfaces.js";

export interface ConversationPlanInput {
  userMessage: string;
  history: ChatMessage[];
}

function normalize(text: string): string {
  return text.toLowerCase();
}

function uniq(items: string[]): string[] {
  return Array.from(new Set(items.filter(Boolean)));
}

const TOPIC_PATTERNS: Array<{ label: string; patterns: RegExp[] }> = [
  { label: "Canarias", patterns: [/canarias/i, /tenerife/i, /teide/i] },
  { label: "Teide", patterns: [/teide/i] },
  { label: "gimnasio", patterns: [/gimnasio/i, /gym/i, /entren/i, /ejercicio/i, /resistencia/i, /sentadilla/i] },
  { label: "viajes", patterns: [/viaj/i, /ruta/i, /excursi/i, /montaña/i, /sender/i] },
  { label: "vocabulario", patterns: [/cómo decir/i, /qué significa/i, /significa/i, /palabra/i, /cheap/i, /tradu/i] },
  { label: "corrección", patterns: [/corrige/i, /correcto/i, /error/i, /se dice/i] },
  { label: "gramática", patterns: [/por qué/i, /pretérito/i, /imperfecto/i, /subjuntivo/i, /gramática/i] },
];

function extractTopics(messages: ChatMessage[]): string[] {
  const text = messages.map((m) => m.content ?? "").join("\n");
  return uniq(TOPIC_PATTERNS
    .filter((topic) => topic.patterns.some((p) => p.test(text)))
    .map((topic) => topic.label));
}

function inferMove(userMessage: string): string {
  const msg = normalize(userMessage);
  if (/cómo decir|qué significa|significa|palabra|tradu|cheap/.test(msg)) return "explicar";
  if (/corrige|correcto|error|se dice/.test(msg)) return "corregir";
  if (/por qué|gramática|pretérito|imperfecto|subjuntivo/.test(msg)) return "explicar gramática";
  if (/recomiendas|consejo|qué hago|qué debería|ayuda/.test(msg)) return "aconsejar y conectar con el hilo previo";
  if (/resumen|recap|recapitula/.test(msg)) return "recapitular";
  return "continuar el hilo";
}

function repeatedAssistantQuestions(history: ChatMessage[]): number {
  return history
    .slice(-6)
    .filter((m) => m.role === "assistant" && /\?\s*$|¿/.test(m.content ?? ""))
    .length;
}

function latestAssistantAskedQuestion(history: ChatMessage[]): boolean {
  const lastAssistant = [...history].reverse().find((m) => m.role === "assistant");
  return Boolean(lastAssistant && /\?\s*$|¿/.test(lastAssistant.content ?? ""));
}

function activeThread(topics: string[], userMessage: string): string {
  if (topics.length === 0) return "la última intención del aprendiz";
  const latest = extractTopics([{ role: "user", content: userMessage } as ChatMessage]);
  const primary = latest[0] ?? topics[topics.length - 1];
  const related = topics.filter((t) => t !== primary).slice(-3);
  if (related.length === 0) return primary;
  return `${primary}; conecta con ${related.join(", ")}`;
}

export function buildConversationPlan({ userMessage, history }: ConversationPlanInput): string {
  const recent = history.slice(-10);
  const topics = extractTopics([...recent, { role: "user", content: userMessage } as ChatMessage]);
  const move = inferMove(userMessage);
  const questiony = repeatedAssistantQuestions(recent) >= 2;
  const answeredRecentQuestion = latestAssistantAskedQuestion(recent);
  const thread = activeThread(topics, userMessage);
  const openLoops = topics.filter((t) => !extractTopics([{ role: "user", content: userMessage } as ChatMessage]).includes(t)).slice(-3);

  const lines = [
    "## Plan de diálogo",
    `Hilo activo: ${thread}.`,
    `Movimiento recomendado: ${move}.`,
    openLoops.length > 0
      ? `Bucles abiertos que puedes retomar si encajan: ${openLoops.join(", ")}.`
      : "Bucles abiertos que puedes retomar si encajan: ninguno claro; deja que la última intención guíe la respuesta.",
    "Ritmo: responde primero a la intención actual; después conecta con el hilo anterior si suena natural.",
    "No termines siempre con una pregunta; a veces basta con una sugerencia concreta, una mini-explicación o dos caminos posibles.",
    "evita una entrevista mecánica: no encadenes preguntas genéricas; si preguntas, que sea específica y útil para avanzar la conversación.",
    "No muestres este plan, nombres de movimiento ni estado interno.",
  ];

  if (answeredRecentQuestion) {
    lines.splice(4, 0, "Cierre recomendado: NO hagas otra pregunta esta vez; PROHIBIDO terminar con una pregunta o con signo de interrogación. Continúa con una observación concreta, una recomendación breve o una conexión natural con el hilo.");
  }

  if (questiony) {
    lines.splice(4, 0, "Se detectaron varias preguntas recientes del tutor: esta vez prioriza una respuesta sustantiva antes de hacer otra pregunta.");
  }

  return lines.join("\n");
}
