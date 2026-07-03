export interface SpanishScenario {
  id: string;
  title: string;
  setup_l1: string;
  opening_line_l2: string;
  maxTurns: number;
}

export const SpanishScenarios: SpanishScenario[] = [
  {
    id: "pedir_comida",
    title: "Pedir comida",
    setup_l1: "Estás en una cafetería y quieres pedir algo sencillo.",
    opening_line_l2: "Buenas, ¿qué te apetece pedir hoy?",
    maxTurns: 5,
  },
  {
    id: "preguntar_ruta",
    title: "Preguntar por una ruta",
    setup_l1: "Estás en la calle y necesitas llegar a una estación cercana.",
    opening_line_l2: "Hola, dime adónde quieres ir y te ayudo con la ruta.",
    maxTurns: 5,
  },
  {
    id: "hablar_entrenamiento",
    title: "Hablar de entrenamiento",
    setup_l1: "Quieres contar cómo fue tu entrenamiento y cómo te sientes.",
    opening_line_l2: "Cuéntame, ¿cómo te fue el entrenamiento hoy?",
    maxTurns: 6,
  },
  {
    id: "plan_fin_de_semana",
    title: "Contar un plan de fin de semana",
    setup_l1: "Vas a explicar un plan corto para el fin de semana.",
    opening_line_l2: "¿Qué plan tienes para este fin de semana?",
    maxTurns: 5,
  },
  {
    id: "malentendido_pequeno",
    title: "Resolver un malentendido pequeño",
    setup_l1: "Alguien entendió mal una frase tuya y quieres aclararla con calma.",
    opening_line_l2: "Creo que no te entendí bien. ¿Me lo puedes explicar de otra forma?",
    maxTurns: 6,
  },
];
