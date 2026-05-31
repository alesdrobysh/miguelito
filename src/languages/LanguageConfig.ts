export interface LanguageConfig {
  id: string;
  name: string;
  errorCategories: readonly string[];
  morphologyCategories: readonly string[];
  calibrationThresholds: {
    morphology: number;
    idiomaticity: number;
  };
  calibrationText: {
    morphologyLow: string;
    morphologyFocus: (pct: number) => string;
    morphologyNormal: string;
    idiomaticityLow: string;
    idiomaticityFocus: (pct: number) => string;
    idiomaticityNormal: string;
  };
  productPolicy: {
    name: string;
    mission: string;
    inputPolicy: string;
    correctionPolicy: string;
    toolPolicy: string;
    visibleSummary: string;
  };
  promptText: {
    languageBlock: string;
    postHistoryReminder: string;
    learnerProfileConfigured: (name: string, goal: string) => string;
    learnerProfileUnconfigured: string;
    conversationState: (turnCount: number, lastModes: string, moodHint: string, topicsTouched: string) => string;
    currentLearnerProfile: (args: {
      words?: string[];
      receptiveWords?: string[];
      productiveWords?: string[];
      errorInfo: { user_text: string; correct: string; category: string } | null;
      weakAreas: string[];
    }) => string;
    dreamMemory: (content: string) => string;
  };
  interestsHeader: string;
  prompts: {
    morning: string;
    evening: string;
    dream: string;
    readLink: (title: string, text: string) => string;
    readingSuggest: (title: string, text: string) => string;
  };
  frequency?: {
    source: string;
    topWords: readonly string[];
    lemmatize?: (word: string) => string;
  };
  soulPath: string;
}
