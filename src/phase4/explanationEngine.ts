import { Match, MatchStatistics, Prediction } from '../types/football';
import {
  CalibrationStateLabel,
  DrawExperimentResult,
  ExplanationFactor,
  ExplanationPayload,
} from './phase4Types';
import { MarketAbstainAssessment } from './marketAbstainEngine';

/**
 * Generate structured, non-fabricated bilingual explanation strictly from computed values.
 * Every missing field explicitly reports "Not available" / "غير متاح".
 */
export function buildTransparentExplanation(params: {
  match: Match;
  stats: MatchStatistics;
  phase3Prediction: Prediction;
  variantBHome: number | null;
  variantBAway: number | null;
  drawExperiment: DrawExperimentResult;
  marketAssessment: MarketAbstainAssessment;
  calibrationStatus: CalibrationStateLabel;
  calibrationSampleCount: number;
}): ExplanationPayload {
  const {
    match,
    stats,
    phase3Prediction,
    variantBHome,
    variantBAway,
    drawExperiment,
    marketAssessment,
    calibrationStatus,
    calibrationSampleCount,
  } = params;

  const hName = match.homeTeam.shortName;
  const aName = match.awayTeam.shortName;
  const hStats = stats.homeTeamStats;
  const aStats = stats.awayTeamStats;

  const factors: ExplanationFactor[] = [];

  // 1. Expected Goal Intensity (Phase 3 vs Phase 4 Variant-B)
  if (
    stats.homeExpectedGoals !== null &&
    stats.awayExpectedGoals !== null &&
    variantBHome !== null &&
    variantBAway !== null
  ) {
    factors.push({
      key: 'expected_goals',
      labelEn: 'Pre-Match Goal Intensity (Lambda)',
      labelAr: 'كثافة الأهداف المتوقعة قبل المباراة (Lambda)',
      value: `P3: ${stats.homeExpectedGoals.toFixed(2)} - ${stats.awayExpectedGoals.toFixed(2)} | P4: ${variantBHome.toFixed(2)} - ${variantBAway.toFixed(2)}`,
      impactEn: `${variantBHome > variantBAway ? hName : aName} holds higher pooled pre-match scoring intensity.`,
      impactAr: `يمتلك ${variantBHome > variantBAway ? hName : aName} معدل تهديف متوقع أعلى بناءً على التجميع الهرمي.`,
      available: true,
    });
  } else {
    factors.push({
      key: 'expected_goals',
      labelEn: 'Pre-Match Goal Intensity (Lambda)',
      labelAr: 'كثافة الأهداف المتوقعة قبل المباراة (Lambda)',
      value: 'Not available',
      impactEn: 'Insufficient prior match evidence (< 5 verified prior matches or < 10 league priors).',
      impactAr: 'أدلة المباريات السابقة غير كافية (< 5 مباريات موثقة أو < 10 في الدوري).',
      available: false,
    });
  }

  // 2. Empirical Elo Rating Differential
  if (typeof hStats.eloRating === 'number' && typeof aStats.eloRating === 'number') {
    const diff = hStats.eloRating - aStats.eloRating;
    factors.push({
      key: 'elo_diff',
      labelEn: 'Pre-Match Elo Differential',
      labelAr: 'فارق تصنيف إيلو قبل المباراة',
      value: `${hStats.eloRating} vs ${aStats.eloRating} (${diff >= 0 ? '+' : ''}${diff})`,
      impactEn:
        Math.abs(diff) <= 45
          ? `Balanced long-term Elo parity (Draw parity score: ${drawExperiment.parityScore ?? 'N/A'}).`
          : `${diff > 0 ? hName : aName} holds an empirical Elo strength advantage.`,
      impactAr:
        Math.abs(diff) <= 45
          ? `تكافؤ طويل المدى في تصنيف إيلو (مؤشر التعادل: ${drawExperiment.parityScore ?? 'غير متاح'}).`
          : `يتفوق ${diff > 0 ? hName : aName} تاريخياً وفق تصنيف إيلو التراكمي.`,
      available: true,
    });
  } else {
    factors.push({
      key: 'elo_diff',
      labelEn: 'Pre-Match Elo Differential',
      labelAr: 'فارق تصنيف إيلو قبل المباراة',
      value: 'Not available',
      impactEn: 'Empirical Elo omitted because team history is below 5 completed matches.',
      impactAr: 'تصنيف إيلو غير متاح لأن سجل الفريق يقل عن 5 مباريات مكتملة.',
      available: false,
    });
  }

  // 3. Verified Pre-Match xG Tracking
  const hasXG =
    typeof hStats.overall.avgXG === 'number' && typeof aStats.overall.avgXG === 'number';
  factors.push({
    key: 'prematch_xg',
    labelEn: 'Rolling Pre-Match xG / xGA',
    labelAr: 'متوسط الأهداف المتوقعة xG / xGA قبل المباراة',
    value: hasXG
      ? `${hName}: ${hStats.overall.avgXG} / ${hStats.overall.avgXGA} · ${aName}: ${aStats.overall.avgXG} / ${aStats.overall.avgXGA}`
      : 'Not available',
    impactEn: hasXG
      ? 'Shot-quality xG priors from completed matches strictly before kickoff.'
      : 'Provider only supplies final match scores; goal-intensity priors rely strictly on verified goals.',
    impactAr: hasXG
      ? 'مؤشرات جودة التسديد xG مستخرجة حصرياً من مباريات مكتملة قبل ضربة البداية.'
      : 'المزوّد يوفر النتائج النهائية فقط؛ تعتمد التقديرات على الأهداف الموثقة دون اختلاق xG.',
    available: hasXG,
  });

  // 4. Venue Split & Rolling Goal Rates
  factors.push({
    key: 'venue_form',
    labelEn: 'Venue Split & Sample Depth',
    labelAr: 'الأداء حسب الملعب وحجم العينة',
    value: `${hName} (H): ${hStats.homeOrAwaySplit.matchesPlayed}m (${hStats.homeOrAwaySplit.avgGoalsScored} GF) · ${aName} (A): ${aStats.homeOrAwaySplit.matchesPlayed}m (${aStats.homeOrAwaySplit.avgGoalsScored} GF)`,
    impactEn: `Overall samples: ${hStats.overall.matchesPlayed} (Home) & ${aStats.overall.matchesPlayed} (Away) prior matches.`,
    impactAr: `حجم العينة الكلي: ${hStats.overall.matchesPlayed} للمستضيف و${aStats.overall.matchesPlayed} للضيف قبل المباراة.`,
    available: hStats.overall.matchesPlayed > 0 || aStats.overall.matchesPlayed > 0,
  });

  // 5. Rest Days & Fixture Congestion
  const hasRest = hStats.restDays !== null && aStats.restDays !== null;
  factors.push({
    key: 'rest_congestion',
    labelEn: 'Rest Days & Schedule Load',
    labelAr: 'أيام الراحة وضغط الجدول',
    value: hasRest ? `${hName}: ${hStats.restDays}d · ${aName}: ${aStats.restDays}d` : 'Not available',
    impactEn: hasRest
      ? 'Measured strictly from interval between last completed fixture and target kickoff.'
      : 'Prior kickoff interval unavailable for one or both teams.',
    impactAr: hasRest
      ? 'مُقاسة بدقة من الفاصل الزمني بين آخر مباراة مكتملة وضربة البداية.'
      : 'الفاصل الزمني قبل المباراة غير متاح لأحد الفريقين أو كليهما.',
    available: hasRest,
  });

  // 6. Head-to-Head Evidence
  const h2hCount = stats.headToHeadSummary.totalMatches;
  factors.push({
    key: 'h2h',
    labelEn: 'Head-to-Head History',
    labelAr: 'سجل المواجهات المباشرة',
    value:
      h2hCount > 0
        ? `${h2hCount} prior (${stats.headToHeadSummary.homeWins}W-${stats.headToHeadSummary.draws}D-${stats.headToHeadSummary.awayWins}L)`
        : 'Not available',
    impactEn:
      h2hCount > 0
        ? `Prior direct meetings before kickoff; avg goals: ${stats.headToHeadSummary.avgGoals ?? 'Not available'}.`
        : 'No prior direct meetings recorded in this dataset before kickoff.',
    impactAr:
      h2hCount > 0
        ? `مواجهات مباشرة سابقة قبل ضربة البداية بمعدل أهداف: ${stats.headToHeadSummary.avgGoals ?? 'غير متاح'}.`
        : 'لا توجد مواجهات مباشرة مسجلة مسبقاً في هذه البيانات قبل المباراة.',
    available: h2hCount > 0,
  });

  // 7. Untracked Team Sheet / Injuries Transparency
  const hasLineups =
    hStats.confirmedLineupAvailable === true && aStats.confirmedLineupAvailable === true;
  factors.push({
    key: 'lineups_injuries',
    labelEn: 'Lineups & Injury Feed',
    labelAr: 'التشكيلات الرسمية والإصابات',
    value: hasLineups
      ? `Injuries: ${hStats.injuriesCount ?? 0} vs ${aStats.injuriesCount ?? 0}`
      : 'Not available',
    impactEn: hasLineups
      ? 'Pre-match availability tracked.'
      : 'Live injury/lineup feeds are not supplied by free historical/community endpoints.',
    impactAr: hasLineups
      ? 'بيانات التشكيلات والإصابات مرصودة.'
      : 'واجهات البيانات المجانية الحالية لا توفر قوائم الإصابات أو التشكيلات الرسمية.',
    available: hasLineups,
  });

  const isMatchAbstain = marketAssessment.abstainScope === 'MATCH_ABSTAIN';
  const isMarketAbstain = marketAssessment.abstainScope === 'MARKET_ONLY';

  const matchSummaryEn = isMatchAbstain
    ? `Prediction abstained for ${match.homeTeam.shortName} vs ${match.awayTeam.shortName}: ${marketAssessment.summaryReason}`
    : `${match.homeTeam.shortName} vs ${match.awayTeam.shortName} clears pre-match checks (${hStats.overall.matchesPlayed}/${aStats.overall.matchesPlayed} prior fixtures). Phase 4 calibration: ${calibrationStatus} (${calibrationSampleCount} prior samples).`;

  const matchSummaryAr = isMatchAbstain
    ? `تم الامتناع عن التوقع لمباراة ${match.homeTeam.shortName} ضد ${match.awayTeam.shortName} لعدم استيفاء متطلبات الثقة أو حجم العينة.`
    : `اجتازت مباراة ${match.homeTeam.shortName} ضد ${match.awayTeam.shortName} فحوصات ما قبل المباراة (${hStats.overall.matchesPlayed}/${aStats.overall.matchesPlayed} مباراة سابقة). حالة المعايرة: ${calibrationStatus === 'CALIBRATED' ? 'معاير سببياً' : 'غير مدرب (< 100 عينة)'}.`;

  const confidenceNoteEn = isMatchAbstain
    ? 'Global MATCH ABSTAIN preserves integrity when sample size < 5 or data completeness < 50/100.'
    : `Data Reliability: ${phase3Prediction.confidencePillars.dataReliability ?? 'N/A'}/100 · Model Consensus: ${phase3Prediction.confidencePillars.modelAgreement ?? 'N/A'}% · Calibration: ${calibrationStatus}.`;

  const confidenceNoteAr = isMatchAbstain
    ? 'الامتناع الكلي عن المباراة يحفظ موثوقية النظام عند نقص العينة عن 5 مباريات أو انخفاض موثوقية البيانات دون 50/100.'
    : `موثوقية البيانات: ${phase3Prediction.confidencePillars.dataReliability ?? 'غير متاح'}/100 · توافق النماذج: ${phase3Prediction.confidencePillars.modelAgreement ?? 'غير متاح'}% · المعايرة: ${calibrationStatus}.`;

  return {
    matchSummaryEn,
    matchSummaryAr,
    factors,
    confidenceNoteEn,
    confidenceNoteAr,
    abstainExplanationEn: isMatchAbstain || isMarketAbstain ? marketAssessment.summaryReason || null : null,
    abstainExplanationAr: isMatchAbstain
      ? 'امتنعت جميع الأسواق لعدم كفاية الأدلة الموثقة قبل ضربة البداية.'
      : isMarketAbstain
      ? 'تم تطبيق امتناع انتقائي على سوق محدد نظراً لارتفاع تباين التقدير أو غياب بعض المؤشرات.'
      : null,
    limitationsEn:
      'Estimates reflect strictly pre-kickoff statistical distributions from verified scores. Single-match outcomes carry irreducible variance; no probabilities are guaranteed.',
    limitationsAr:
      'تعتمد التقديرات حصرياً على التوزيعات الإحصائية قبل ضربة البداية من النتائج الموثقة. نتائج المباريات الفردية تخضع للتباين الطبيعي ولا توجد توقعات مضمونة.',
  };
}
