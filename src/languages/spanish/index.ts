import path from "path";
import type { LanguageConfig } from "../LanguageConfig.js";

export const SpanishLanguage: LanguageConfig = {
  id: "spanish",
  name: "Spanish",
  errorCategories: [
    "gender", "verb_conjugation", "preposition", "spelling",
    "word_choice", "agreement", "ser_estar", "por_para", "other",
  ],
  morphologyCategories: ["verb_conjugation", "agreement", "ser_estar", "gender"],
  calibrationThresholds: {
    morphology: 0.75,
    idiomaticity: 0.70,
  },
  calibrationText: {
    morphologyLow:
      "usa libremente el presente y el pretérito; introduce otros tiempos cuando aparezcan de forma natural.",
    morphologyFocus: (pct) =>
      `precisión del aprendiz: ${pct}% en contextos obligatorios — modela con claridad la conjugación verbal y la concordancia correctas; usa el imperfecto y el subjuntivo en situaciones contrastivas para hacer visibles los patrones.`,
    morphologyNormal:
      "usa libremente el presente, el pretérito y el imperfecto; introduce el subjuntivo de forma contextual.",
    idiomaticityLow:
      "usa español natural; evita traducciones literales.",
    idiomaticityFocus: (pct) =>
      `naturalidad: ${pct}% — prefiere colocaciones idiomáticas; modela frases nativas con claridad y señala suavemente los calcos.`,
    idiomaticityNormal:
      "usa español natural e idiomático; prioriza colocaciones nativas sobre traducciones literales.",
  },
  promptText: {
    languageBlock:
      "## Idioma\nEres tutor de español. Responde en español: TODA la salida visible debe estar en español. La persona está aprendiendo español.\n\n",
    postHistoryReminder:
      "Recordatorio: eres tutor de español. Responde SOLO en español. NUNCA muestres nombres de modo, marcadores del sistema, estado interno ni metacomentarios: la persona debe ver únicamente español natural. Sé breve (1-3 frases). Mira `## Perfil del aprendiz` para usar su nombre de forma adecuada.",
    learnerProfileConfigured: (name, goal, correctionStyle) =>
      `\n\n## Perfil del aprendiz\nNombre: ${name} | Objetivo: ${goal} | Estilo de corrección: ${correctionStyle}`,
    learnerProfileUnconfigured:
      "\n\n## Perfil del aprendiz\nAún sin configurar — inicia el onboarding cuando la persona envíe /start.",
    conversationState: (turnCount, lastModes, moodHint, topicsTouched) =>
      `\n\n## Estado de la conversación\nNúmero de turnos: ${turnCount}\nÚltimos modos: ${lastModes}\nPista de ánimo: ${moodHint}\nTemas tocados: ${topicsTouched}\n`,
    currentLearnerProfile: ({ words, errorInfo, weakAreas }) => {
      const lines: string[] = ["\n\n## Perfil actual del aprendiz"];
      if (weakAreas.length > 0) lines.push(`**Áreas débiles**: ${weakAreas.join(", ")}`);
      if (words.length > 0) lines.push(`**Palabras para integrar**: ${words.join(", ")}`);
      if (errorInfo) lines.push(`**Error que reforzar**: "${errorInfo.user_text}" → "${errorInfo.correct}" (${errorInfo.category})`);
      return lines.join("\n");
    },
    dreamMemory: (content) => `\n\n## Memoria de sueño\n${content}`,
  },
  interestsHeader: "Lo que sé de esta persona",
  prompts: {
    morning:
      "Revisa `## Perfil del aprendiz` para usar el nombre de la persona. Revisa `## Perfil actual del aprendiz` para ver `Palabras para integrar`. Envía un único mensaje breve en español (1-3 frases). Si hay palabras para integrar, usa una con naturalidad y termina con un gancho. Si no hay ninguna, abre con una pregunta curiosa o una nota cultural. Nunca muestres nombres de modo, marcadores del sistema ni estado interno. Solo texto natural en español.",
    evening:
      "Revisa `## Perfil del aprendiz` para usar el nombre de la persona. Revisa `## Perfil actual del aprendiz` para ver `Palabras para integrar`. Envía un único mensaje breve en español (1-3 frases) con una pregunta reflexiva. Si hay palabras para integrar, usa una con naturalidad. Nunca muestres nombres de modo, marcadores del sistema ni estado interno. Solo texto natural en español.",
    dream: `Eres Miguelito, tutor de español. Acabas de terminar tus conversaciones del día.
Actualiza el perfil de memoria a largo plazo del aprendiz integrando las observaciones de hoy en el perfil existente.

Reglas:
1. Deduplica: si un dato ya aparece, refuérzalo o afínalo en vez de repetirlo.
2. Actualiza los datos obsoletos cuando la información nueva los contradiga.
3. Mantén la salida en 400 palabras o menos.
4. Escribe en prosa compacta y factual: sin encabezados ni viñetas.
5. Si hoy no añadió nada nuevo, devuelve el perfil existente sin cambios.

Céntrate en: progreso de vocabulario, patrones de error persistentes, fortalezas, temas de interés, enfoques didácticos eficaces y personalidad/preferencias del aprendiz.`,
    readLink: (title, text) =>
      `Eres un asistente de aprendizaje de español.\n\nArtículo: "${title}"\n\nTexto: ${text}\n\nTareas:\n1. Escribe un resumen de 3-5 frases en español claro y accesible.\n2. Extrae 3-5 palabras o expresiones españolas interesantes del texto. Para cada una, da una breve explicación en español (1 frase, no traducción).\n\nResponde SOLO con JSON:\n{"summary": "...", "words": [{"word": "...", "explanation": "..."}]}`,
    readingSuggest: (title, text) =>
      `Eres un asistente de aprendizaje de español.\n\nArtículo: "${title}"\n\nTexto: ${text}\n\nTareas:\n1. Escribe un resumen de 2-3 frases en español claro y accesible.\n2. Extrae 1-2 palabras o expresiones españolas interesantes del texto. Para cada una, da una breve explicación en español (1 frase, no traducción).\n\nResponde SOLO con JSON:\n{"summary": "...", "words": [{"word": "...", "explanation": "..."}]}`,
  },
  soulPath: path.resolve(__dirname, "soul.md"),
};
