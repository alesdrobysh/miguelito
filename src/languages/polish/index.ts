import path from "path";
import type { LanguageConfig } from "../LanguageConfig.js";

export const PolishLanguage: LanguageConfig = {
  id: "polish",
  name: "Polish",
  errorCategories: [
    "case", "aspect", "gender", "agreement",
    "preposition", "spelling", "word_choice", "word_order", "other",
  ],
  morphologyCategories: ["case", "aspect", "gender", "agreement"],
  calibrationThresholds: {
    morphology: 0.75,
    idiomaticity: 0.70,
  },
  calibrationText: {
    morphologyLow:
      "używaj swobodnie częstych form; wprowadzaj odmianę przez przypadki, gdy pojawia się naturalnie.",
    morphologyFocus: (pct) =>
      `trafność użytkownika w kontekstach obowiązkowych: ${pct}% — wyraźnie modeluj poprawne końcówki przypadków, dobór aspektu i zgodę; używaj kontrastujących par aspektowych, żeby pokazać wzorce.`,
    morphologyNormal:
      "używaj swobodnie mianownika, biernika i dopełniacza; wprowadzaj narzędnik i miejscownik kontekstowo.",
    idiomaticityLow:
      "używaj naturalnej polszczyzny; unikaj dosłownych tłumaczeń z angielskiego.",
    idiomaticityFocus: (pct) =>
      `naturalność: ${pct}% — wybieraj wyrażenia idiomatyczne; wyraźnie modeluj rodzime brzmienie i delikatnie zaznaczaj kalki z angielskiego.`,
    idiomaticityNormal:
      "używaj naturalnej, idiomatycznej polszczyzny; stawiaj rodzime wyrażenia ponad dosłowne tłumaczenia.",
  },
  promptText: {
    languageBlock:
      "## Język\nJesteś tutorem języka polskiego. Odpowiadaj po polsku: CAŁA widoczna odpowiedź ma być po polsku. Osoba ucząca się uczy się polskiego.\n\n",
    postHistoryReminder:
      "Przypomnienie: jesteś tutorem języka polskiego. Odpowiadaj WYŁĄCZNIE po polsku. NIGDY nie pokazuj nazw trybów, znaczników systemowych, stanu wewnętrznego ani metakomentarzy — osoba ucząca się ma widzieć tylko naturalną polszczyznę. Pisz krótko (1-3 zdania). Sprawdź `## Profil ucznia`, żeby odpowiednio użyć imienia.",
    learnerProfileConfigured: (name, goal, correctionStyle) =>
      `\n\n## Profil ucznia\nImię: ${name} | Cel: ${goal} | Styl poprawiania: ${correctionStyle}`,
    learnerProfileUnconfigured:
      "\n\n## Profil ucznia\nJeszcze nieskonfigurowany — rozpocznij onboarding, gdy użytkownik wyśle /start.",
    conversationState: (turnCount, lastModes, moodHint, topicsTouched) =>
      `\n\n## Stan rozmowy\nLiczba tur: ${turnCount}\nOstatnie tryby: ${lastModes}\nWskazówka nastroju: ${moodHint}\nPoruszone tematy: ${topicsTouched}\n`,
    currentLearnerProfile: ({ words, errorInfo, weakAreas }) => {
      const lines: string[] = ["\n\n## Aktualny profil ucznia"];
      if (weakAreas.length > 0) lines.push(`**Słabsze obszary**: ${weakAreas.join(", ")}`);
      if (words.length > 0) lines.push(`**Słowa do wplecenia**: ${words.join(", ")}`);
      if (errorInfo) lines.push(`**Błąd do utrwalenia**: "${errorInfo.user_text}" → "${errorInfo.correct}" (${errorInfo.category})`);
      return lines.join("\n");
    },
    dreamMemory: (content) => `\n\n## Pamięć ze snu\n${content}`,
  },
  interestsHeader: "Co wiem o tej osobie",
  prompts: {
    morning:
      "Sprawdź `## Profil ucznia`, żeby użyć imienia. Sprawdź `## Aktualny profil ucznia` i `Słowa do wplecenia`. Wyślij jedną krótką wiadomość po polsku (1-3 zdania). Jeśli są słowa do wplecenia, użyj jednego naturalnie i zakończ luźnym haczykiem. Jeśli ich nie ma, zacznij od ciekawego pytania albo krótkiej notki kulturowej. Nigdy nie pokazuj nazw trybów, znaczników systemowych ani stanu wewnętrznego. Tylko naturalny tekst po polsku.",
    evening:
      "Sprawdź `## Profil ucznia`, żeby użyć imienia. Sprawdź `## Aktualny profil ucznia` i `Słowa do wplecenia`. Wyślij jedną krótką wiadomość po polsku (1-3 zdania) z refleksyjnym pytaniem. Jeśli są słowa do wplecenia, użyj jednego naturalnie. Nigdy nie pokazuj nazw trybów, znaczników systemowych ani stanu wewnętrznego. Tylko naturalny tekst po polsku.",
    dream: `Jesteś tutorem języka polskiego. Właśnie zakończyłeś dzisiejsze rozmowy.
Zaktualizuj długoterminowy profil pamięci ucznia, włączając dzisiejsze obserwacje do istniejącego profilu.

Zasady:
1. Deduplikuj — jeśli fakt już istnieje, wzmocnij go albo doprecyzuj zamiast powtarzać.
2. Aktualizuj nieaktualne fakty, gdy nowe informacje im przeczą.
3. Zachowaj limit 400 słów łącznie.
4. Pisz zwartą, rzeczową prozą — bez nagłówków i wypunktowań.
5. Jeśli dzisiaj nie doszło nic nowego, zwróć istniejący profil bez zmian.

Skup się na: postępach w słownictwie, trwałych wzorcach błędów (zwłaszcza przypadek i aspekt), mocnych stronach, tematach zainteresowań, skutecznych sposobach nauczania oraz osobowości/preferencjach ucznia.`,
    readLink: (title, text) =>
      `Jesteś asystentem nauki języka polskiego.\n\nArtykuł: "${title}"\n\nTekst: ${text}\n\nZadania:\n1. Napisz streszczenie 3-5 zdaniami w prostym, przystępnym języku polskim.\n2. Wyodrębnij 3-5 ciekawych polskich słów lub wyrażeń z tekstu. Dla każdego podaj krótkie wyjaśnienie po polsku (1 zdanie).\n\nOdpowiedz TYLKO w JSON:\n{"summary": "...", "words": [{"word": "...", "explanation": "..."}]}`,
    readingSuggest: (title, text) =>
      `Jesteś asystentem nauki języka polskiego.\n\nArtykuł: "${title}"\n\nTekst: ${text}\n\nZadania:\n1. Napisz streszczenie 2-3 zdaniami w prostym, przystępnym języku polskim.\n2. Wyodrębnij 1-2 ciekawe polskie słowa lub wyrażenia z tekstu. Dla każdego podaj krótkie wyjaśnienie po polsku (1 zdanie).\n\nOdpowiedz TYLKO w JSON:\n{"summary": "...", "words": [{"word": "...", "explanation": "..."}]}`,
  },
  soulPath: path.resolve(__dirname, "soul.md"),
};
