import { describe, expect, it } from "vitest";
import type { ChatMessage } from "../providers/interfaces.js";
import { buildConversationPlan } from "./ConversationPlanner.js";

describe("ConversationPlanner", () => {
  it("summarizes the active thread and open loops from recent dialogue", () => {
    const history: ChatMessage[] = [
      { role: "user", content: "Quiero viajar a Canarias y subir al Teide." },
      { role: "assistant", content: "¡Qué buen plan! Podemos hablar de rutas y preparación." },
      { role: "user", content: "También voy al gimnasio para mejorar mi resistencia." },
      { role: "assistant", content: "Eso conecta muy bien con las subidas largas." },
    ];

    const plan = buildConversationPlan({ userMessage: "¿Qué ejercicios me recomiendas?", history });

    expect(plan).toContain("## Plan de diálogo");
    expect(plan).toContain("Hilo activo");
    expect(plan).toContain("gimnasio");
    expect(plan).toContain("Canarias");
    expect(plan).toContain("Teide");
    expect(plan).toContain("conecta");
  });

  it("discourages generic question loops and chooses a concrete next move", () => {
    const history: ChatMessage[] = [
      { role: "assistant", content: "¿Qué hiciste hoy?" },
      { role: "user", content: "Fui al mercado." },
      { role: "assistant", content: "¿Y qué compraste?" },
      { role: "user", content: "Compré fruta." },
    ];

    const plan = buildConversationPlan({ userMessage: "No sé cómo decir 'cheap' en español.", history });

    expect(plan).toContain("Movimiento recomendado: explicar");
    expect(plan).toContain("No termines siempre con una pregunta");
    expect(plan).toContain("evita una entrevista mecánica");
  });

  it("tells the tutor not to ask another question after a recent tutor question was answered", () => {
    const history: ChatMessage[] = [
      { role: "user", content: "Quiero subir al Teide." },
      { role: "assistant", content: "¿Prefieres una ruta suave o intensa?" },
    ];

    const plan = buildConversationPlan({ userMessage: "Prefiero algo suave. No quiero sufrir todo el día.", history });

    expect(plan).toContain("Cierre recomendado: NO hagas otra pregunta");
    expect(plan).toContain("PROHIBIDO terminar con una pregunta");
    expect(plan).toContain("Continúa con una observación concreta");
  });
});
