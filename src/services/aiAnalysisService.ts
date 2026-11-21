/**
 * Client-Side AI Analysis Service
 * Calls the server-side Gemini endpoint (/api/gemini/analyze-match)
 * ensuring no API keys are exposed to the client.
 * 
 * Strict Scientific Integrity:
 * No fake AI responses are ever fabricated or hardcoded.
 * In case of error or missing API key, propagates explicit error state.
 */

import { Match, MatchStatistics, Prediction, AIAnalysis } from '../types/football';
import { Language } from '../i18n/translations';

export async function requestMatchAnalysis(
  match: Match,
  statistics: MatchStatistics,
  analyticalModel: Prediction,
  language: Language = 'ar'
): Promise<AIAnalysis> {
  const response = await fetch('/api/gemini/analyze-match', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      match,
      statistics,
      analyticalModel,
      language,
    }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => null);
    const message = errorData?.error || `Server responded with status ${response.status}`;
    throw new Error(message);
  }

  const data: AIAnalysis = await response.json();
  return data;
}
