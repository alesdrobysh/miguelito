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
  interestsHeader: string;
  prompts: {
    morning: string;
    evening: string;
    dream: string;
    readLink: (title: string, text: string) => string;
    readingSuggest: (title: string, text: string) => string;
  };
  soulPath: string;
}
