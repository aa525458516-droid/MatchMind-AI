export type Language = 'ar' | 'en';

export interface Translations {
  common: {
    brandName: string;
    vs: string;
    home: string;
    away: string;
    draw: string;
    winShort: string;
    drawShort: string;
    lossShort: string;
    winFull: string;
    drawFull: string;
    lossFull: string;
    available: string;
    abstain: string;
    pending: string;
    statusAbstain: string;
    notAvailable: string;
    na: string;
    calculating: string;
    loading: string;
    retryConnection: string;
    retryRequest: string;
    retryLoad: string;
    cached: string;
    retrieved: string;
    fresh: string;
    calculatedAt: string;
    dataLabel: string;
    providerLabel: string;
    sampleLabel: string;
    matchesUnit: string;
    preMatchUnit: string;
    preMatchXGAvailable: string;
    preMatchXGUnavailable: string;
    historicalValidationAvailable: string;
    historicalValidationUnavailable: string;
    fullTimePrefix: string;
    languageName: string;
    switchToLanguageLabel: string;
    abstainDefaultMessage: string;
    insufficientPreMatchMin5: string;
  };
  nav: {
    dashboard: string;
    analysis: string;
    predictions: string;
    validation: string;
    history: string;
    settings: string;
    newAnalysis: string;
    dataSource: string;
    toggleNavigation: string;
  };
  footer: {
    subtitle: string;
    poisson: string;
    expectedGoals: string;
    gemini: string;
    nonGambling: string;
    rights: string;
  };
  disclaimer: {
    title: string;
    bodyBeforeStrong: string;
    strongText: string;
    bodyAfterStrong: string;
  };
  badge: {
    demoLabel: string;
    demoTitle: string;
    openLigaHistorical: string;
    openLigaLive: string;
    openLigaTitlePrefix: string;
    statsBombLabel: string;
    statsBombTitlePrefix: string;
    unifiedLabel: string;
    unifiedTitle: string;
    atTime: string;
  };
  dashboard: {
    platformTag: string;
    quantitativeTag: string;
    heroTitle: string;
    heroDesc: string;
    activeProvider: string;
    kpiBacktestTitle: string;
    kpiBrierIndex: string;
    kpiNoCompletedBacktest: string;
    kpiMeasuredOnBacktest: string;
    kpiCompetitionsTitle: string;
    leagueSingular: string;
    leaguePlural: string;
    discovering: string;
    noneLoaded: string;
    kpiGoalMatrixTitle: string;
    kpiGoalMatrixValue: string;
    kpiGoalMatrixSub: string;
    kpiAiEngineTitle: string;
    kpiAiEngineValue: string;
    kpiAiEngineSub: string;
    fixturesSectionTitle: string;
    fixturesSubtitleStatsBomb: string;
    fixturesSubtitleDefault: string;
    viewAllMarkets: string;
    fetchingFixtures: string;
    providerUnavailableTitle: string;
    noFixturesTitle: string;
    noFixturesDesc: string;
    xScoreLabel: string;
    fullAnalysis: string;
    homeWinTitle: string;
    drawTitle: string;
    awayWinTitle: string;
    backtestSamplesTitle: string;
    recordsCount: string;
    ofWord: string;
    backtestSamplesDesc: string;
    openLigaNoArchive: string;
    noBacktestRecords: string;
    modelLabel: string;
    brierLabel: string;
    connectorsTitle: string;
    connectorsDesc: string;
    configureInSettings: string;
  };
  predictions: {
    engineTag: string;
    marketEstimatesTag: string;
    pageTitle: string;
    pageDesc: string;
    marketFilterLabel: string;
    marketAll: string;
    marketDoubleChance: string;
    market1X2: string;
    marketOverUnder: string;
    marketBtts: string;
    marketFirstHalf: string;
    leagueFilterLabel: string;
    defaultFeed: string;
    sortLabel: string;
    sortDate: string;
    sortConfidence: string;
    sortHomeProb: string;
    loadingFixtures: string;
    unableToLoad: string;
    noMatchesFound: string;
    xScore: string;
    computingProbs: string;
    doubleChanceTitle: string;
    homeOrDraw: string;
    awayOrDraw: string;
    winner1X2Title: string;
    homeWinBar: string;
    drawBar: string;
    awayWinBar: string;
    overUnderTitle: string;
    over15: string;
    over25: string;
    over35: string;
    underPrefix: string;
    bttsTitle: string;
    bttsYes: string;
    noPrefix: string;
    firstHalfTitle: string;
    firstHalfOver05: string;
    firstHalfOver15: string;
    preMatchSample: string;
    launchFullAnalysis: string;
    computingBatch: string;
    loadNextPrefix: string;
    fixturesOf: string;
  };
  analysis: {
    selectorTitle: string;
    selectorDesc: string;
    competitionLabel: string;
    discoveredSuffix: string;
    noCompetitionsLoaded: string;
    fixtureLabel: string;
    availableSuffix: string;
    noFixturesAvailable: string;
    scheduledTag: string;
    quickSelect: string;
    computingFeatures: string;
    matchDataUnavailable: string;
    noFixturesActive: string;
    kickoff: string;
    homeTeam: string;
    awayTeam: string;
    eloLabel: string;
    eloInsufficient: string;
    recentForm: string;
    nonePrior: string;
    preMatchXGTitle: string;
    modeScore: string;
    observedPostMatchXG: string;
    subTabModels: string;
    subTabProbs: string;
    subTabForm: string;
    subTabH2H: string;
    subTabAI: string;
    abstainProbsDesc: string;
    winner1X2CardTitle: string;
    winner1X2CardDesc: string;
    homeWinSuffix: string;
    matchDrawLabel: string;
    equalGoals: string;
    doubleChanceCardTitle: string;
    doubleChanceCardDesc: string;
    homeOrDrawLabel: string;
    awayOrDrawLabel: string;
    homeOrAwayLabel: string;
    goalTotalsTitle: string;
    goalTotalsDesc: string;
    over15Goals: string;
    over25Goals: string;
    over35Goals: string;
    under15Prefix: string;
    under25Prefix: string;
    under35Prefix: string;
    bttsYesFull: string;
    topScorelinesTitle: string;
    topScorelinesDesc: string;
    avgXGTitle: string;
    avgGoalsTitle: string;
    diffPrefix: string;
    xgNotTracked: string;
    cleanSheets: string;
    restAndCongestion: string;
    daysUnit: string;
    congestion21d: string;
    congestionNA: string;
    preMatchXGGoalLog: string;
    preMatchResultsLog: string;
    priorMatchesSuffix: string;
    noCompletedPrior: string;
    goalsPrefix: string;
    h2hTitle: string;
    h2hDesc: string;
    drawsLabel: string;
    noH2HRecorded: string;
  };
  modelComparison: {
    title: string;
    desc: string;
    systemAbstain: string;
    highConviction: string;
    moderateSignal: string;
    abstainPolicyNote: string;
    pillar1Title: string;
    pillar1Sub: string;
    pillar2Title: string;
    pillar2SubVerified: string;
    pillar2SubUnavailable: string;
    unavailableText: string;
    pillar3Title: string;
    pillar3Sub: string;
    pillar4Title: string;
    pillar4Sub: string;
    signalClassification: string;
    tableTitle: string;
    tableDesc: string;
    noModelTable: string;
    colEngine: string;
    colDraw: string;
    colOver25: string;
    colBtts: string;
    colNotes: string;
    scientificNoteLabel: string;
    scientificNoteBody: string;
  };
  scorelineMatrix: {
    mostLikely: string;
    outcomePrefix: string;
  };
  aiCard: {
    title: string;
    liveBadge: string;
    awaitingBadge: string;
    subtitle: string;
    zeroHallucination: string;
    synthesizingBtn: string;
    runBtn: string;
    loadingTitle: string;
    loadingDesc: string;
    offlineTitle: string;
    scientificIntegrityNote: string;
    execSummary: string;
    expectedScore: string;
    modelConfidence: string;
    keyFactors: string;
    teamProfileSuffix: string;
    keyStrengths: string;
    vulnerabilities: string;
    tacticalRationale: string;
    dataProvenanceLabel: string;
    matchesWord: string;
    qualityScoreLabel: string;
    emptyPrompt: string;
  };
  validation: {
    loadingText: string;
    unavailableTitle: string;
    unavailableFallback: string;
    retryBtn: string;
    tag: string;
    subTag: string;
    pageTitle: string;
    sourceLabel: string;
    evaluatedLabel: string;
    temporalConstraintDesc: string;
    competitionLabel: string;
    defaultCompetition: string;
    noHistoricalCompetitions: string;
    fullSeasonScope: string;
    scopeLabel: string;
    coverageLabel: string;
    trackerTitle: string;
    trackerDesc: string;
    abstainedInRun: string;
    measuredDcHitRate: string;
    noTestableSample: string;
    benchmarkMet: string;
    researchInProgress: string;
    availabilityNotice: string;
    kpiBrierTitle: string;
    testedMatchesSuffix: string;
    noCompletedSample: string;
    kpiLogLossTitle: string;
    kpiLogLossSub: string;
    kpiLeakageTitle: string;
    zeroLeakage: string;
    unverified: string;
    kpiLeakageSub: string;
    kpiWindowTitle: string;
    abstainedWord: string;
    tableTitle: string;
    tableDesc: string;
    colMarket: string;
    colTested: string;
    colAccuracy: string;
    colBrier: string;
    colBaseRate: string;
    colAdvantage: string;
    colBenchmark: string;
    validated80: string;
    highVarianceMarket: string;
    calibrationTitle: string;
    calibrationDesc: string;
    noCalibrationBins: string;
    predictedLabel: string;
    observedLabel: string;
    calibrationDelta: string;
    emptyBin: string;
    noSamples: string;
    optimalCalibration: string;
    withinTolerance: string;
    safeguardsTitle: string;
    safeguardsIntro: string;
    safeguard1Title: string;
    safeguard1Body: string;
    safeguard2Title: string;
    safeguard2Body: string;
    safeguard3Title: string;
    safeguard3Body: string;
    researchPolicyLabel: string;
    researchPolicyBody: string;
  };
  history: {
    tag: string;
    subTag: string;
    pageTitle: string;
    pageDesc: string;
    competitionLabel: string;
    evaluateFullSeason: string;
    loadingText: string;
    unableToLoad: string;
    noHistoryTitle: string;
    openLigaNoHistory: string;
    noCompletedRecords: string;
    kpiAvgBrier: string;
    measuredNonAbstained: string;
    requires1NonAbstained: string;
    kpiEvaluatedVsAbstained: string;
    abstainedCoverage: string;
    kpi1X2Accuracy: string;
    excludesAbstentions: string;
    kpiOver25Accuracy: string;
    measuredAgainstFT: string;
    listTitle: string;
    showingRecordsPrefix: string;
    recordsWord: string;
    playedLabel: string;
    actualFT: string;
    abstainExcludedNote: string;
    modelTopScore: string;
    probPrefix: string;
    prediction1X2: string;
    outcomePrefix: string;
    over25Label: string;
    overWord: string;
    actualPrefix: string;
    over25Value: string;
    under25Value: string;
    calibrationFinding: string;
  };
  settings: {
    tag: string;
    subTag: string;
    pageTitle: string;
    pageDesc: string;
    languageSectionTitle: string;
    languageSectionDesc: string;
    arabicOption: string;
    arabicOptionDesc: string;
    englishOption: string;
    englishOptionDesc: string;
    connectorsTitle: string;
    connectorsDesc: string;
    unifiedName: string;
    unifiedBadge: string;
    unifiedDesc: string;
    openLigaName: string;
    openLigaBadge: string;
    openLigaDesc: string;
    statsBombName: string;
    statsBombBadge: string;
    statsBombDesc: string;
    demoName: string;
    demoBadge: string;
    demoDesc: string;
    attributionTitle: string;
    openLigaAttribution: string;
    statsBombAttributionPrefix: string;
    statsBombAttributionLink: string;
    statsBombAttributionSuffix: string;
    poissonSectionTitle: string;
    homeAdvantageLabel: string;
    homeAdvantageHint: string;
    formDecayLabel: string;
    formDecayHint: string;
    geminiSectionTitle: string;
    activeLlmLabel: string;
    activeLlmSub: string;
    schemaContractLabel: string;
    schemaContractSub: string;
    schemaEnforced: string;
    geminiKeyNotePrefix: string;
    geminiKeyNoteSuffix: string;
    ethicsTitle: string;
    ethicsBody: string;
    savedToast: string;
    saveButton: string;
  };
}

export const translations: Record<Language, Translations> = {
  ar: {
    common: {
      brandName: 'MatchMind AI',
      vs: 'ضد',
      home: 'المستضيف',
      away: 'الضيف',
      draw: 'تعادل',
      winShort: 'ف',
      drawShort: 'ت',
      lossShort: 'خ',
      winFull: 'فوز',
      drawFull: 'تعادل',
      lossFull: 'خسارة',
      available: 'متاح',
      abstain: 'امتناع',
      pending: 'قيد الانتظار',
      statusAbstain: 'الحالة: امتناع',
      notAvailable: 'غير متاح',
      na: 'غير متوفر',
      calculating: 'جارٍ الحساب...',
      loading: 'جارٍ التحميل...',
      retryConnection: 'إعادة المحاولة',
      retryRequest: 'إعادة الطلب',
      retryLoad: 'إعادة التحميل',
      cached: 'مخزّن مؤقتاً',
      retrieved: 'مُسترجع',
      fresh: 'مباشر',
      calculatedAt: 'تاريخ الحساب',
      dataLabel: 'البيانات',
      providerLabel: 'المزود',
      sampleLabel: 'العينة',
      matchesUnit: 'مباراة',
      preMatchUnit: 'قبل المباراة',
      preMatchXGAvailable: 'بيانات xG قبل المباراة متاحة',
      preMatchXGUnavailable: 'بيانات xG قبل المباراة غير متاحة',
      historicalValidationAvailable: 'التحقق التاريخي متاح',
      historicalValidationUnavailable: 'التحقق التاريخي غير متاح',
      fullTimePrefix: 'النتيجة',
      languageName: 'العربية',
      switchToLanguageLabel: 'EN',
      abstainDefaultMessage: 'التوقع غير متاح لعدم كفاية البيانات الموثقة قبل المباراة.',
      insufficientPreMatchMin5: 'يتطلب الأمر ما لا يقل عن 5 مباريات سابقة موثقة لكل فريق قبل احتساب الاحتمالات.',
    },
    nav: {
      dashboard: 'لوحة التحكم',
      analysis: 'تحليل المباراة',
      predictions: 'التوقعات',
      validation: 'مركز التحقق',
      history: 'السجل التاريخي',
      settings: 'الإعدادات',
      newAnalysis: 'تحليل جديد',
      dataSource: 'مصدر البيانات',
      toggleNavigation: 'تبديل قائمة التنقل',
    },
    footer: {
      subtitle: 'منصة تحليل رياضي ونمذجة احتمالية متقدمة',
      poisson: 'توزيع بواسون',
      expectedGoals: 'الأهداف المتوقعة (xG)',
      gemini: 'ذكاء Gemini',
      nonGambling: 'تحليلات بحثية غير مراهنية',
      rights: 'جميع الحقوق محفوظة.',
    },
    disclaimer: {
      title: 'إشعار بحثي وتحليلي:',
      bodyBeforeStrong: 'جميع الأرقام المعروضة هي احتمالات إحصائية وتقديرات تعلم آلي مشتقة من الأداء التاريخي ونماذج الأهداف المتوقعة الكمية (xG).',
      strongText: 'لا توجد أي نتيجة مضمونة.',
      bodyAfterStrong: 'منصة MatchMind AI لا تسهّل ولا تشجّع ولا تقدّم خدمات مراهنات رياضية.',
    },
    badge: {
      demoLabel: 'تجريبي · بيانات محاكاة',
      demoTitle: 'بيانات تجريبية معزولة لمعاينة الواجهة دون اتصال.',
      openLigaHistorical: 'تاريخي · OPENLIGADB',
      openLigaLive: 'مباشر / قادم · OPENLIGADB',
      openLigaTitlePrefix: 'بيانات من واجهة OpenLigaDB المجتمعية (api.openligadb.de).',
      statsBombLabel: 'تاريخي · STATSBOMB',
      statsBombTitlePrefix: 'بيانات أحداث تاريخية من StatsBomb Open Data بموجب رخصة CC BY 4.0.',
      unifiedLabel: 'موحد · OPENLIGADB + STATSBOMB',
      unifiedTitle: 'الوضع الموحد: مباريات مباشرة/قادمة من OpenLigaDB واختبار تاريخي من StatsBomb Open Data.',
      atTime: 'عند',
    },
    dashboard: {
      platformTag: 'منصة ذكاء المباريات',
      quantitativeTag: 'النمذجة الكميّة لكرة القدم',
      heroTitle: 'تشخيص مباريات كرة القدم والاحتمالات الإحصائية',
      heroDesc: 'نماذج توزيع بواسون الموضوعية والذكاء التكتيكي المدعوم بـ Gemini والمبني حصرياً على إحصاءات موثقة ما قبل المباراة.',
      activeProvider: 'المزوّد النشط',
      kpiBacktestTitle: 'معايرة الاختبار التاريخي',
      kpiBrierIndex: 'مؤشر براير',
      kpiNoCompletedBacktest: 'لا يوجد اختبار مكتمل في الوضع النشط',
      kpiMeasuredOnBacktest: 'مُقاس على الاختبار التاريخي المكتمل',
      kpiCompetitionsTitle: 'البطولات المكتشفة',
      leagueSingular: 'بطولة',
      leaguePlural: 'بطولات',
      discovering: 'جارٍ الاكتشاف تلقائياً...',
      noneLoaded: 'لم يتم تحميل بطولات',
      kpiGoalMatrixTitle: 'محرك مصفوفة الأهداف',
      kpiGoalMatrixValue: 'ديكسون-كولز',
      kpiGoalMatrixSub: 'بواسون ثنائي المتغيرات + إيلو التجريبي',
      kpiAiEngineTitle: 'محرك التحليل التكتيكي',
      kpiAiEngineValue: 'Gemini 3.8',
      kpiAiEngineSub: 'مخطط بيانات خادم مهيكل',
      fixturesSectionTitle: 'المباريات والتقديرات الاحتمالية التحليلية',
      fixturesSubtitleStatsBomb: 'مباريات بحثية تاريخية بتوقعات مقتصرة على بيانات ما قبل ضربة البداية',
      fixturesSubtitleDefault: 'مباريات البطولات الموثقة مع فحوصات عينة ما قبل المباراة',
      viewAllMarkets: 'عرض جميع الأسواق',
      fetchingFixtures: 'جارٍ جلب المباريات الموثقة من',
      providerUnavailableTitle: 'مزوّد البيانات غير متاح حالياً',
      noFixturesTitle: 'لا توجد مباريات متاحة للاختيار الحالي',
      noFixturesDesc: 'جرّب تبديل البطولة في صفحة تحليل المباراة أو تغيير المزوّد من الإعدادات.',
      xScoreLabel: 'النتيجة المتوقعة:',
      fullAnalysis: 'التحليل الكامل',
      homeWinTitle: 'فوز المستضيف',
      drawTitle: 'تعادل',
      awayWinTitle: 'فوز الضيف',
      backtestSamplesTitle: 'عيّنات الاختبار التاريخي',
      recordsCount: 'سجلات',
      ofWord: 'من',
      backtestSamplesDesc: 'مراجعات تاريخية صارمة ما قبل ضربة البداية تقارن توقعات بواسون وإيلو بالنتائج الرسمية الموثقة.',
      openLigaNoArchive: 'لا يوفّر OpenLigaDB أرشيف أحداث تاريخية متعددة المواسم. انتقل إلى وضع StatsBomb أو الوضع الموحد لعرض التقييمات التاريخية.',
      noBacktestRecords: 'لم يتم تحميل سجلات اختبار تاريخية للمزوّد الحالي.',
      modelLabel: 'النموذج:',
      brierLabel: 'براير:',
      connectorsTitle: 'موصّلات بيانات كرة القدم المجانية',
      connectorsDesc: 'تتكامل MatchMind AI مع OpenLigaDB (مباريات مباشرة وقادمة) وStatsBomb Open Data (أحداث تاريخية وبيانات xG بموجب CC BY 4.0) دون مفاتيح مدفوعة أو بيانات مصطنعة.',
      configureInSettings: 'إعداد مصدر البيانات في الإعدادات',
    },
    predictions: {
      engineTag: 'محرك التحليلات التنبؤية',
      marketEstimatesTag: 'تقديرات احتمالات الأسواق',
      pageTitle: 'مستكشف الاحتمالات التحليلية لكرة القدم',
      pageDesc: 'استكشف التوزيعات الاحتمالية الرياضية لنتيجة المباراة (1X2)، الفرصة المزدوجة، إجمالي الأهداف (أكثر/أقل)، وتسجيل كلا الفريقين. تمتنع المباريات التي تفتقر لعينة تاريخية كافية تلقائياً.',
      marketFilterLabel: 'السوق:',
      marketAll: 'كل الأسواق',
      marketDoubleChance: 'الفرصة المزدوجة',
      market1X2: 'الفائز 1X2',
      marketOverUnder: 'أكثر / أقل',
      marketBtts: 'تسجيل الفريقين',
      marketFirstHalf: 'الشوط الأول',
      leagueFilterLabel: 'البطولة:',
      defaultFeed: 'التدفق الافتراضي',
      sortLabel: 'الترتيب:',
      sortDate: 'تاريخ المباراة',
      sortConfidence: 'ثقة النموذج',
      sortHomeProb: 'احتمال فوز المستضيف',
      loadingFixtures: 'جارٍ تحميل المباريات من',
      unableToLoad: 'تعذّر تحميل التوقعات',
      noMatchesFound: 'لم يتم العثور على مباريات للبطولة والمزوّد المحددين.',
      xScore: 'النتيجة المتوقعة',
      computingProbs: 'جارٍ حساب احتمالات ما قبل المباراة...',
      doubleChanceTitle: 'الفرصة المزدوجة',
      homeOrDraw: 'المستضيف أو التعادل',
      awayOrDraw: 'الضيف أو التعادل',
      winner1X2Title: 'احتمالات الفائز 1X2',
      homeWinBar: 'فوز',
      drawBar: 'تعادل (X)',
      awayWinBar: 'فوز',
      overUnderTitle: 'حدود إجمالي الأهداف (أكثر / أقل)',
      over15: 'أكثر من 1.5 هدف',
      over25: 'أكثر من 2.5 هدف',
      over35: 'أكثر من 3.5 هدف',
      underPrefix: 'أقل:',
      bttsTitle: 'تسجيل كلا الفريقين (BTTS)',
      bttsYes: 'كلا الفريقين يسجل - نعم',
      noPrefix: 'لا:',
      firstHalfTitle: 'أسواق الشوط الأول',
      firstHalfOver05: 'الشوط الأول أكثر من 0.5',
      firstHalfOver15: 'الشوط الأول أكثر من 1.5',
      preMatchSample: 'عينة ما قبل المباراة:',
      launchFullAnalysis: 'فتح التحليل الكامل للمباراة',
      computingBatch: 'جارٍ حساب الدفعة...',
      loadNextPrefix: 'تحميل',
      fixturesOf: 'مباراة تالية',
    },
    analysis: {
      selectorTitle: 'اختر البطولة والمباراة الموثقة',
      selectorDesc: 'بطولات ومباريات حقيقية مكتشفة تلقائياً من مزوّد البيانات النشط.',
      competitionLabel: 'البطولة',
      discoveredSuffix: 'مكتشفة',
      noCompetitionsLoaded: 'لا توجد بطولات محمّلة',
      fixtureLabel: 'المباراة',
      availableSuffix: 'متاحة',
      noFixturesAvailable: 'لا توجد مباريات متاحة',
      scheduledTag: 'مجدولة',
      quickSelect: 'اختيار سريع للمباريات:',
      computingFeatures: 'جارٍ احتساب خصائص ما قبل المباراة والمعايرة متعددة النماذج...',
      matchDataUnavailable: 'بيانات المباراة غير متاحة',
      noFixturesActive: 'لا توجد مباريات متاحة للمزوّد أو البطولة النشطة. اختر بطولة أخرى أعلاه أو غيّر مصدر البيانات من الإعدادات.',
      kickoff: 'ضربة البداية:',
      homeTeam: 'الفريق المستضيف',
      awayTeam: 'الفريق الضيف',
      eloLabel: 'إيلو',
      eloInsufficient: 'غير كافٍ (<5)',
      recentForm: 'المستوى الأخير:',
      nonePrior: 'لا توجد مباريات سابقة',
      preMatchXGTitle: 'الأهداف المتوقعة ما قبل المباراة',
      modeScore: 'النتيجة الأكثر ترجيحاً:',
      observedPostMatchXG: 'xG المرصود بعد المباراة من StatsBomb:',
      subTabModels: 'مقارنة النماذج والركائز الأربع',
      subTabProbs: 'الاحتمالات التحليلية',
      subTabForm: 'سجل الأداء قبل المباراة',
      subTabH2H: 'المواجهات المباشرة',
      subTabAI: 'التشخيص التكتيكي بالذكاء الاصطناعي',
      abstainProbsDesc: 'يحتاج كلا الفريقين إلى 5 مباريات مكتملة على الأقل قبل ضربة البداية لإنتاج تقديرات احتمالية.',
      winner1X2CardTitle: 'احتمالات الفائز بالمباراة 1X2',
      winner1X2CardDesc: 'توزيع ديكسون-كولز المطبّع ثنائي المتغيرات للأهداف.',
      homeWinSuffix: 'فوز',
      matchDrawLabel: 'تعادل المباراة',
      equalGoals: 'أهداف متساوية',
      doubleChanceCardTitle: 'احتمالات الفرصة المزدوجة',
      doubleChanceCardDesc: 'احتمالات نتائج مركّبة مشتقة بدقة من التوزيع المطبّع 1X2.',
      homeOrDrawLabel: 'المستضيف أو التعادل',
      awayOrDrawLabel: 'الضيف أو التعادل',
      homeOrAwayLabel: 'المستضيف أو الضيف (12 - دون تعادل)',
      goalTotalsTitle: 'احتمالات إجمالي الأهداف (أكثر / أقل)',
      goalTotalsDesc: 'توزيعات بواسون التراكمية المحدودة مع مراعاة الكتلة الاحتمالية الطرفية.',
      over15Goals: 'أكثر من 1.5 هدف',
      over25Goals: 'أكثر من 2.5 هدف',
      over35Goals: 'أكثر من 3.5 هدف',
      under15Prefix: 'أقل من 1.5:',
      under25Prefix: 'أقل من 2.5:',
      under35Prefix: 'أقل من 3.5:',
      bttsYesFull: 'تسجيل كلا الفريقين (BTTS - نعم)',
      topScorelinesTitle: 'أعلى النتائج المتوقعة احتمالاً',
      topScorelinesDesc: 'كثافة بواسون المشتركة لأبرز النتائج الرقمية المحتملة.',
      avgXGTitle: 'متوسط xG / xGA',
      avgGoalsTitle: 'متوسط الأهداف المسجلة / المستقبلة',
      diffPrefix: 'الفارق:',
      xgNotTracked: 'xG: غير مرصود قبل المباراة',
      cleanSheets: 'الشباك النظيفة',
      restAndCongestion: 'الراحة وضغط الجدول',
      daysUnit: 'يوم',
      congestion21d: 'مؤشر 21 يوم:',
      congestionNA: 'الضغط: غير متاح',
      preMatchXGGoalLog: 'سجل الأهداف والأهداف المتوقعة قبل المباراة',
      preMatchResultsLog: 'سجل النتائج قبل المباراة',
      priorMatchesSuffix: 'مباراة سابقة',
      noCompletedPrior: 'لا توجد مباريات مكتملة مسجلة قبل ضربة البداية',
      goalsPrefix: 'الأهداف:',
      h2hTitle: 'المواجهات المباشرة السابقة',
      h2hDesc: 'المواجهات الرسمية التي لُعبت قبل ضربة البداية بين',
      drawsLabel: 'التعادلات:',
      noH2HRecorded: 'لم يتم تسجيل مواجهات مباشرة سابقة ضمن نطاق هذه البطولة قبل ضربة البداية.',
    },
    modelComparison: {
      title: 'محرك الثقة الذكي والامتناع (4 ركائز)',
      desc: 'يفصل بين الاحتمال الرياضي المجرد وموثوقية البيانات التجريبية وتوافق النماذج المتعددة.',
      systemAbstain: 'امتناع النظام (لا توصية)',
      highConviction: 'تحليل عالي الإقناع',
      moderateSignal: 'إشارة متوسطة',
      abstainPolicyNote: 'سياسة النزاهة العلمية: يمتنع النموذج عن إصدار احتمالات عندما يكون حجم العينة غير كافٍ أو يتجاوز التباين بين النماذج حدود الأمان.',
      pillar1Title: '1. احتمال النموذج',
      pillar1Sub: 'الاحتمالية الرياضية المجردة',
      pillar2Title: '2. الدقة التاريخية',
      pillar2SubVerified: 'مرجع اختبار تاريخي تجريبي',
      pillar2SubUnavailable: 'التحقق التاريخي غير متاح',
      unavailableText: 'غير متاح',
      pillar3Title: '3. موثوقية البيانات',
      pillar3Sub: 'حجم العينة واكتمال المقاييس',
      pillar4Title: '4. توافق النماذج',
      pillar4Sub: 'الإجماع بين المحركات النشطة',
      signalClassification: 'تصنيف الإشارة:',
      tableTitle: 'مقارنة تقييمات النماذج المستقلة متعددة المصادر',
      tableDesc: 'تقييم التوافق والتباين عبر بواسون، ديكسون-كولز، إيلو (عند توفر 5 مباريات فأكثر)، ومونت كارلو (عند تفعيله).',
      noModelTable: 'لم يتم إنشاء جدول النماذج الكمية لعدم استيفاء متطلبات بيانات ما قبل المباراة.',
      colEngine: 'محرك النموذج',
      colDraw: 'تعادل (X)',
      colOver25: 'أكثر من 2.5',
      colBtts: 'كلاهما يسجل',
      colNotes: 'ملاحظات المنهجية',
      scientificNoteLabel: 'ملاحظة علمية:',
      scientificNoteBody: 'لا تفترض MatchMind AI أبداً أن مجرد أخذ متوسط النماذج يحسّن الصلاحية التنبؤية. يلتقط كل خوارزمية بُعداً مختلفاً في كرة القدم: بواسون ينمذج توزيع الأهداف، ديكسون-كولز يعاير الارتباط بالنتائج المنخفضة، إيلو يقيس القوة طويلة المدى، ومونت كارلو يرسم التباين غير الخطي.',
    },
    scorelineMatrix: {
      mostLikely: 'الأكثر احتمالاً',
      outcomePrefix: 'الاحتمال #',
    },
    aiCard: {
      title: 'الذكاء التكتيكي للمباراة من Gemini',
      liveBadge: 'مباشر GEMINI 3.8 FLASH',
      awaitingBadge: 'بانتظار التحليل',
      subtitle: 'تركيب تكتيكي مبني حصرياً على بيانات xG وxGA وسجل الأداء الموثق.',
      zeroHallucination: 'سياسة انعدام الاختلاق',
      synthesizingBtn: 'جارٍ تحليل البيانات الموثقة...',
      runBtn: 'تشغيل التشخيص المباشر من Gemini',
      loadingTitle: 'جارٍ استعلام محرك Gemini 3.8 Flash التكتيكي...',
      loadingDesc: 'تحليل المؤشرات الموثقة، مصائد الضغط، نقاط ضعف التحولات، والأهداف المتوقعة لمباراة',
      offlineTitle: 'حالة التحليل المباشر لـ Gemini: غير متصل / بانتظار المفتاح',
      scientificIntegrityNote: 'قاعدة النزاهة العلمية: لا تختلق MatchMind AI أبداً ردود ذكاء اصطناعي وهمية أو مكتوبة مسبقاً. إذا تعذّر الاتصال بالنموذج الحي أو لم يُضبط مفتاح API، نكتفي بعرض نماذج بواسون وإيلو ومونت كارلو الرياضية الصرفة.',
      execSummary: 'الملخص التكتيكي التنفيذي',
      expectedScore: 'النتيجة المتوقعة من النموذج',
      modelConfidence: 'ثقة النموذج:',
      keyFactors: 'العوامل التكتيكية الحاسمة',
      teamProfileSuffix: '— ملف الفريق',
      keyStrengths: 'نقاط القوة الرئيسية',
      vulnerabilities: 'الثغرات التكتيكية',
      tacticalRationale: 'التفسير التكتيكي والملاحظات',
      dataProvenanceLabel: 'مصدر البيانات:',
      matchesWord: 'مباراة',
      qualityScoreLabel: 'درجة الجودة:',
      emptyPrompt: 'اضغط على "تشغيل التشخيص المباشر من Gemini" لتوليد رؤية تكتيكية من الإحصاءات المهيكلة الموثقة.',
    },
    validation: {
      loadingText: 'جارٍ تنفيذ التحقق الزمني التدريجي دون تسريب مستقبلي...',
      unavailableTitle: 'تشغيل التحقق غير متاح',
      unavailableFallback: 'تعذّر احتساب مقاييس الاختبار التاريخي للمزوّد النشط.',
      retryBtn: 'إعادة تشغيل التحقق',
      tag: 'التحقق العلمي والمعايرة',
      subTag: 'تقييم صارم مفصول زمنياً',
      pageTitle: 'مركز التحقق والاختبار التاريخي التجريبي',
      sourceLabel: 'المصدر:',
      evaluatedLabel: 'تاريخ التقييم:',
      temporalConstraintDesc: 'يتم إدخال إحصاءات ونتائج ما قبل ضربة البداية السابقة للحظة T فقط.',
      competitionLabel: 'البطولة:',
      defaultCompetition: 'البطولة الافتراضية',
      noHistoricalCompetitions: 'لا توجد بطولات تاريخية',
      fullSeasonScope: 'نطاق الموسم الكامل',
      scopeLabel: 'النطاق:',
      coverageLabel: 'التغطية:',
      trackerTitle: 'متتبّع الفرصة المزدوجة التجريبية ومعايرة الأسواق',
      trackerDesc: 'تمثل دقة 80% هدفاً بحثياً طموحاً يُقاس بشكل مستقل لكل سوق عبر المباريات غير الممتنع عنها — وليست ضماناً مطلقاً. تمتنع المباريات التي تفتقر لبيانات ما قبل المباراة بوضوح',
      abstainedInRun: 'امتناعاً في هذا التشغيل',
      measuredDcHitRate: 'معدل إصابة الفرصة المزدوجة المُقاس',
      noTestableSample: 'لا توجد عيّنة قابلة للاختبار',
      benchmarkMet: 'تحقق المعيار >= 80%',
      researchInProgress: 'البحث قيد التقدم',
      availabilityNotice: 'إشعار توفر الاختبار التاريخي',
      kpiBrierTitle: 'متوسط مؤشر براير الكلي',
      testedMatchesSuffix: 'مباراة مختبرة',
      noCompletedSample: 'لا توجد عيّنة اختبار مكتملة',
      kpiLogLossTitle: 'متوسط خسارة اللوغاريتم (Log Loss)',
      kpiLogLossSub: 'مقياس معايرة الإنتروبيا المتقاطعة',
      kpiLeakageTitle: 'التحقق من عدم تسريب البيانات',
      zeroLeakage: 'انعدام التسريب (0)',
      unverified: 'غير متحقق منه',
      kpiLeakageSub: 'انقسام زمني صارم قبل ضربة البداية (< T)',
      kpiWindowTitle: 'نافذة التحقق',
      abstainedWord: 'ممتنع عنها',
      tableTitle: 'الدقة التجريبية للأسواق والمقارنة بالخط الأساسي',
      tableDesc: 'مُقاسة بشكل مستقل لكل سوق تنبؤي مقابل المعدلات الأساسية المرصودة في مجموعة البيانات.',
      colMarket: 'سوق التوقع',
      colTested: 'المباريات المختبرة',
      colAccuracy: 'دقة النموذج',
      colBrier: 'مؤشر براير',
      colBaseRate: 'المعدل الأساسي بالبيانات',
      colAdvantage: 'الأفضلية عن الأساس',
      colBenchmark: 'المعيار البحثي',
      validated80: 'موثق >= 80%',
      highVarianceMarket: 'سوق عالي التباين',
      calibrationTitle: 'منحنى المعايرة (مخطط الموثوقية)',
      calibrationDesc: 'التكرار الفعلي المرصود مقابل الاحتمال المتوقع عبر فئات الثقة المعبأة.',
      noCalibrationBins: 'لا توجد فئات معايرة متاحة لتشغيل هذا المزوّد.',
      predictedLabel: 'المتوقع:',
      observedLabel: 'المرصود:',
      calibrationDelta: 'فارق المعايرة:',
      emptyBin: 'فئة فارغة',
      noSamples: 'لا توجد عينات',
      optimalCalibration: 'معايرة مثالية',
      withinTolerance: 'ضمن الهامش المقبول',
      safeguardsTitle: 'ضمانات الاختبار التاريخي العلمي',
      safeguardsIntro: 'تفرض MatchMind AI بروتوكولات بحثية صارمة غير قابلة للتنازل في جميع الاختبارات التاريخية:',
      safeguard1Title: '1. فصل زمني صارم بين التدريب والاختبار',
      safeguard1Body: 'لكل مباراة تاريخية تُختبر عند ضربة البداية T، تُستخدم النتائج المكتملة قبل T فقط. لا تتسرب أبداً قيم xG أو النتائج النهائية للمباراة نفسها إلى التوقع.',
      safeguard2Title: '2. الامتناع الصريح عند نقص البيانات',
      safeguard2Body: 'تمتنع مباريات الجولات المبكرة التي تقل فيها المباريات السابقة الموثقة عن 5 مباريات بدلاً من التخمين بقيم افتراضية ثابتة.',
      safeguard3Title: '3. منع تلوث البيانات الاحتياطية',
      safeguard3Body: 'لا تدخل أي سجلات تجريبية مصطنعة في تشغيلات التحقق الحقيقية الخاصة بـ OpenLigaDB أو StatsBomb.',
      researchPolicyLabel: 'السياسة البحثية:',
      researchPolicyBody: 'MatchMind AI أداة بحثية لتحليل البيانات الرياضية. لا يوجد أي توقع مضمون النتائج.',
    },
    history: {
      tag: 'تقييم النماذج والمعايرة',
      subTag: 'تدقيق الأداء التجريبي',
      pageTitle: 'السجل التحليلي وسجل التحقق التاريخي',
      pageDesc: 'مراجعات استرجاعية شفافة تقارن توزيعات النموذج قبل ضربة البداية بالنتائج الرسمية الموثقة.',
      competitionLabel: 'البطولة:',
      evaluateFullSeason: 'تقييم الموسم الكامل (إزالة النافذة الافتراضية)',
      loadingText: 'جارٍ تقييم السجلات التاريخية بترتيب زمني...',
      unableToLoad: 'تعذّر تحميل سجل التاريخ',
      noHistoryTitle: 'لا يوجد سجل اختبار تاريخي متاح',
      openLigaNoHistory: 'يوفر OpenLigaDB جداول الموسم الحالي ولا يقدم أرشيفات تاريخية متعددة المواسم. انتقل إلى StatsBomb Open Data أو الوضع الموحد في الإعدادات لاستعراض التقييمات الاسترجاعية.',
      noCompletedRecords: 'لم تُرجع سجلات تاريخية مكتملة للبطولة المحددة.',
      kpiAvgBrier: 'متوسط مؤشر براير 1X2',
      measuredNonAbstained: 'مُقاس عبر المباريات غير الممتنع عنها',
      requires1NonAbstained: 'يتطلب تقييماً واحداً غير ممتنع على الأقل',
      kpiEvaluatedVsAbstained: 'المُقيّمة مقابل الممتنع عنها',
      abstainedCoverage: 'ممتنع عنها (التغطية:',
      kpi1X2Accuracy: 'الدقة التجريبية لـ 1X2',
      excludesAbstentions: 'يستبعد حالات الامتناع · LogLoss:',
      kpiOver25Accuracy: 'دقة أكثر/أقل من 2.5 هدف',
      measuredAgainstFT: 'مُقاسة بدقة مقابل الأهداف النهائية الموثقة',
      listTitle: 'التقييمات التاريخية للمباريات',
      showingRecordsPrefix: 'عرض',
      recordsWord: 'سجل',
      playedLabel: 'أُقيمت:',
      actualFT: 'النتيجة الفعلية',
      abstainExcludedNote: 'التوقع غير متاح لعدم كفاية البيانات الموثقة قبل المباراة (مستبعد من متوسطات الدقة ومؤشر براير).',
      modelTopScore: 'أعلى نتيجة للنموذج',
      probPrefix: 'الاحتمال:',
      prediction1X2: 'توقع 1X2',
      outcomePrefix: 'النتيجة:',
      over25Label: 'أكثر/أقل 2.5',
      overWord: 'أكثر',
      actualPrefix: 'الفعلي:',
      over25Value: 'أكثر من 2.5',
      under25Value: 'أقل من 2.5',
      calibrationFinding: 'خلاصة المعايرة:',
    },
    settings: {
      tag: 'مزوّدو بيانات كرة القدم المجانيون',
      subTag: 'تهيئة البنية والمنظومة',
      pageTitle: 'مزوّدو البيانات والمعاملات الكمّية',
      pageDesc: 'تتكامل MatchMind AI مع مصادر بيانات كرة قدم مجانية 100% ومفتوحة. دون اشتراكات، دون مفاتيح مدفوعة، ودون قيود حظر.',
      languageSectionTitle: 'لغة الواجهة واتجاه العرض (RTL / LTR)',
      languageSectionDesc: 'اختر لغة العرض المفضلة لكامل المنصة. يتم حفظ اختيارك تلقائياً وتطبيق اتجاه الكتابة المناسب وتحليل Gemini باللغة المختارة.',
      arabicOption: 'العربية (RTL)',
      arabicOptionDesc: 'واجهة عربية كاملة من اليمين إلى اليسار مع تقارير Gemini باللغة العربية.',
      englishOption: 'English (LTR)',
      englishOptionDesc: 'Full English interface from left to right with English Gemini tactical synthesis.',
      connectorsTitle: 'موصّلات بيانات كرة القدم المجانية المعتمدة',
      connectorsDesc: 'اختر محرك البيانات النشط (يُحفظ تلقائياً في المتصفح). تفرض MatchMind AI قاعدة صارمة لمنع التراجع الصامت: لا تعود المزوّدات الحقيقية أبداً إلى البيانات التجريبية.',
      unifiedName: 'المحرك الموحد متعدد المصادر',
      unifiedBadge: 'موصى به · الافتراضي',
      unifiedDesc: 'يجمع بين مباريات OpenLigaDB المباشرة وأرشيف StatsBomb البحثي التاريخي للاختبار الاسترجاعي.',
      openLigaName: 'واجهة OpenLigaDB المباشرة',
      openLigaBadge: 'مجتمعي · مجاني 100%',
      openLigaDesc: 'مباريات وجداول ونتائج ألمانية حقيقية ومباشرة (البوندسليغا 1/2/3 وكأس ألمانيا). لا يتطلب مفتاحاً.',
      statsBombName: 'بيانات StatsBomb المفتوحة',
      statsBombBadge: 'CC BY 4.0 · بحثي',
      statsBombDesc: 'مباريات بطولات تاريخية موثقة وبيانات تسديدات statsbomb_xg للاختبار التاريخي المتسلسل زمنياً.',
      demoName: 'بيانات المعايرة التجريبية المعزولة',
      demoBadge: 'للمعاينة دون اتصال فقط',
      demoDesc: 'مباريات معايرة مسبقاً لاستعراض الواجهة دون اتصال. معزولة تماماً عن أوضاع المزوّدات الحقيقية.',
      attributionTitle: 'الإسناد القانوني وشروط الاستخدام المجانية',
      openLigaAttribution: 'واجهة بيانات كرة قدم مجتمعية عامة. البيانات مُحدّثة مجتمعياً ومخزنة مؤقتاً على الخادم (TTL 5 دقائق). المقاييس المتقدمة غير المرصودة (مثل xG والتشكيلات) تُوسم بوضوح بأنها غير متاحة.',
      statsBombAttributionPrefix: 'منشورة بموجب رخصة',
      statsBombAttributionLink: 'المشاع الإبداعي النسبة 4.0 الدولية (CC BY 4.0)',
      statsBombAttributionSuffix: '. تُستخدم حصرياً للبحث التاريخي، تحليل xG الفعلي للتسديدات، والتحقق خارج العيّنة.',
      poissonSectionTitle: 'معاملات محرك بواسون الإحصائي',
      homeAdvantageLabel: 'معامل أفضلية الأرض للمستضيف',
      homeAdvantageHint: 'تعزيز أهداف المستضيف المعاير تاريخياً للدوريات الأوروبية (~1.10x–1.20x).',
      formDecayLabel: 'معدل اضمحلال المستوى الأخير',
      formDecayHint: 'اضمحلال الوزن الأسي المطبّق على آخر 5 مباريات.',
      geminiSectionTitle: 'تهيئة محرك التحليل الاستراتيجي Gemini AI',
      activeLlmLabel: 'نموذج اللغة النشط',
      activeLlmSub: 'استدلال عالي الإنتاجية من جهة الخادم',
      schemaContractLabel: 'عقد المخطط المهيكل (Schema)',
      schemaContractSub: 'استجابة JSON آمنة الأنواع تشمل العوامل الحاسمة ونقاط القوة والضعف والاحتمالات',
      schemaEnforced: 'مفروض (Type.OBJECT)',
      geminiKeyNotePrefix: 'تُدار مفاتيح Gemini API بأمان عبر متغير البيئة في الخادم',
      geminiKeyNoteSuffix: '. لا يتم إرسال أو تخزين أي مفاتيح مطلقاً في حزمة المتصفح.',
      ethicsTitle: 'سياسة التحليل المسؤول وأخلاقيات المنصة',
      ethicsBody: 'بُنيت MatchMind AI حصرياً كمنصة لعلوم البيانات الرياضية وأبحاث التعلم الآلي. نحن لا نقدّم خدمات مراهنات رياضية أو قسائم رهان أو معاملات مالية أو توصيات مراهنة مضمونة. جميع المخرجات احتمالات إحصائية تخضع للتباين الرياضي الطبيعي.',
      savedToast: 'تم حفظ التفضيلات بنجاح.',
      saveButton: 'حفظ الإعدادات',
    },
  },
  en: {
    common: {
      brandName: 'MatchMind AI',
      vs: 'vs',
      home: 'Home',
      away: 'Away',
      draw: 'Draw',
      winShort: 'W',
      drawShort: 'D',
      lossShort: 'L',
      winFull: 'Win',
      drawFull: 'Draw',
      lossFull: 'Loss',
      available: 'AVAILABLE',
      abstain: 'ABSTAIN',
      pending: 'PENDING',
      statusAbstain: 'STATUS: ABSTAIN',
      notAvailable: 'Not available',
      na: 'N/A',
      calculating: 'Calculating...',
      loading: 'Loading...',
      retryConnection: 'Retry Connection',
      retryRequest: 'Retry Request',
      retryLoad: 'Retry Load',
      cached: 'Cached',
      retrieved: 'Retrieved',
      fresh: 'Fresh',
      calculatedAt: 'Calculated',
      dataLabel: 'Data',
      providerLabel: 'Provider',
      sampleLabel: 'Sample',
      matchesUnit: 'matches',
      preMatchUnit: 'pre-match',
      preMatchXGAvailable: 'Pre-match xG available',
      preMatchXGUnavailable: 'Pre-match xG unavailable',
      historicalValidationAvailable: 'Historical validation available',
      historicalValidationUnavailable: 'Historical validation unavailable',
      fullTimePrefix: 'FT',
      languageName: 'English',
      switchToLanguageLabel: 'العربية',
      abstainDefaultMessage: 'Prediction unavailable due to insufficient verified pre-match data.',
      insufficientPreMatchMin5: 'Minimum 5 pre-match fixtures per club required before estimating probabilities.',
    },
    nav: {
      dashboard: 'Dashboard',
      analysis: 'Match Analysis',
      predictions: 'Predictions',
      validation: 'Validation Hub',
      history: 'History',
      settings: 'Settings',
      newAnalysis: 'New Analysis',
      dataSource: 'Data Source',
      toggleNavigation: 'Toggle navigation',
    },
    footer: {
      subtitle: 'Sports Analytics & Probabilistic Modeling Platform',
      poisson: 'Poisson Distribution',
      expectedGoals: 'Expected Goals (xG)',
      gemini: 'Gemini Intelligence',
      nonGambling: 'Non-Gambling Analytics',
      rights: 'All rights reserved.',
    },
    disclaimer: {
      title: 'Analytical Research Notice:',
      bodyBeforeStrong: 'All figures displayed are statistical probabilities and machine learning estimates derived from historical form and quantitative expected goal (xG) models.',
      strongText: 'No outcome is guaranteed.',
      bodyAfterStrong: 'MatchMind AI does not facilitate, encourage, or offer sports betting.',
    },
    badge: {
      demoLabel: 'DEMO · BENCHMARK',
      demoTitle: 'Isolated benchmark demo data for offline UI evaluation.',
      openLigaHistorical: 'HISTORICAL · OPENLIGADB',
      openLigaLive: 'LIVE / UPCOMING · OPENLIGADB',
      openLigaTitlePrefix: 'Data sourced from OpenLigaDB community API (api.openligadb.de).',
      statsBombLabel: 'HISTORICAL · STATSBOMB',
      statsBombTitlePrefix: 'Historical event research data from StatsBomb Open Data under CC BY 4.0.',
      unifiedLabel: 'UNIFIED · OPENLIGADB + STATSBOMB',
      unifiedTitle: 'Unified Mode: Live/Upcoming from OpenLigaDB and Historical Backtesting from StatsBomb Open Data.',
      atTime: 'at',
    },
    dashboard: {
      platformTag: 'Match Intelligence Platform',
      quantitativeTag: 'Quantitative Football Modeling',
      heroTitle: 'Football Match Diagnostics & Probabilities',
      heroDesc: 'Objective Poisson goal distribution models and Gemini-powered tactical intelligence grounded strictly in verified pre-match statistics.',
      activeProvider: 'Active Provider',
      kpiBacktestTitle: 'Backtest Calibration',
      kpiBrierIndex: 'Brier Index',
      kpiNoCompletedBacktest: 'No completed backtest in active mode',
      kpiMeasuredOnBacktest: 'Measured on completed backtest',
      kpiCompetitionsTitle: 'Discovered Competitions',
      leagueSingular: 'League',
      leaguePlural: 'Leagues',
      discovering: 'Discovering dynamically...',
      noneLoaded: 'None loaded',
      kpiGoalMatrixTitle: 'Goal Matrix Engine',
      kpiGoalMatrixValue: 'Dixon-Coles',
      kpiGoalMatrixSub: 'Bivariate Poisson + Empirical Elo',
      kpiAiEngineTitle: 'Tactical AI Engine',
      kpiAiEngineValue: 'Gemini 3.8',
      kpiAiEngineSub: 'Structured Server Schema',
      fixturesSectionTitle: 'Fixtures & Analytical Probability Estimates',
      fixturesSubtitleStatsBomb: 'Historical research matches with strictly pre-kickoff predictions',
      fixturesSubtitleDefault: 'Verified competition fixtures with pre-match sample checks',
      viewAllMarkets: 'View All Markets',
      fetchingFixtures: 'Fetching verified fixtures from',
      providerUnavailableTitle: 'Data Provider Unavailable',
      noFixturesTitle: 'No fixtures available for current selection',
      noFixturesDesc: 'Try switching competitions in Match Analysis or changing providers in Settings.',
      xScoreLabel: 'xScore:',
      fullAnalysis: 'Full Analysis',
      homeWinTitle: 'Home Win',
      drawTitle: 'Draw',
      awayWinTitle: 'Away Win',
      backtestSamplesTitle: 'Historical Backtest Samples',
      recordsCount: 'Records',
      ofWord: 'of',
      backtestSamplesDesc: 'Strictly pre-kickoff historical reviews comparing Poisson/Elo predictions against verified match scorelines.',
      openLigaNoArchive: 'OpenLigaDB does not provide multi-season backtest event archives. Switch to StatsBomb or Unified mode to view historical evaluations.',
      noBacktestRecords: 'No historical backtest records loaded for the current provider.',
      modelLabel: 'Model:',
      brierLabel: 'Brier:',
      connectorsTitle: 'Free Football Data Connectors',
      connectorsDesc: 'MatchMind AI integrates OpenLigaDB (community live/upcoming feeds) and StatsBomb Open Data (CC BY 4.0 historical events & shot xG) without paid API keys or synthetic fallbacks.',
      configureInSettings: 'Configure Data Source in Settings',
    },
    predictions: {
      engineTag: 'Predictive Analytics Engine',
      marketEstimatesTag: 'Market Probability Estimates',
      pageTitle: 'Analytical Football Probability Explorer',
      pageDesc: 'Explore mathematical probability distributions across Match Winner (1X2), Double Chance, Over/Under Goal Totals, and BTTS. Fixtures lacking sufficient historical samples abstain automatically.',
      marketFilterLabel: 'Market:',
      marketAll: 'All Markets',
      marketDoubleChance: 'Double Chance',
      market1X2: '1X2 Winner',
      marketOverUnder: 'Over / Under',
      marketBtts: 'BTTS',
      marketFirstHalf: '1st Half',
      leagueFilterLabel: 'League:',
      defaultFeed: 'Default Feed',
      sortLabel: 'Sort:',
      sortDate: 'Kickoff Date',
      sortConfidence: 'Model Confidence',
      sortHomeProb: 'Home Win Probability',
      loadingFixtures: 'Loading fixtures from',
      unableToLoad: 'Unable to Load Predictions',
      noMatchesFound: 'No matches found for the selected competition and provider.',
      xScore: 'xScore',
      computingProbs: 'Computing pre-match probabilities...',
      doubleChanceTitle: 'Double Chance',
      homeOrDraw: 'Home or Draw',
      awayOrDraw: 'Away or Draw',
      winner1X2Title: 'Match Winner 1X2 Probabilities',
      homeWinBar: 'Win',
      drawBar: 'Draw (X)',
      awayWinBar: 'Win',
      overUnderTitle: 'Over / Under Goal Total Thresholds',
      over15: 'Over 1.5 Goals',
      over25: 'Over 2.5 Goals',
      over35: 'Over 3.5 Goals',
      underPrefix: 'Under:',
      bttsTitle: 'Both Teams To Score (BTTS)',
      bttsYes: 'BTTS - Yes',
      noPrefix: 'No:',
      firstHalfTitle: 'First Half Intervals',
      firstHalfOver05: '1st Half Over 0.5',
      firstHalfOver15: '1st Half Over 1.5',
      preMatchSample: 'Pre-match Sample:',
      launchFullAnalysis: 'Launch Full Match Analysis',
      computingBatch: 'Computing Batch...',
      loadNextPrefix: 'Load Next',
      fixturesOf: 'Fixtures',
    },
    analysis: {
      selectorTitle: 'Select Competition & Verified Fixture',
      selectorDesc: 'Dynamically discovered competitions and real fixtures from the active data provider.',
      competitionLabel: 'Competition',
      discoveredSuffix: 'Discovered',
      noCompetitionsLoaded: 'No competitions loaded',
      fixtureLabel: 'Match Fixture',
      availableSuffix: 'Available',
      noFixturesAvailable: 'No fixtures available',
      scheduledTag: 'Scheduled',
      quickSelect: 'Quick Fixture Select:',
      computingFeatures: 'Computing strictly pre-match features and multi-model calibration...',
      matchDataUnavailable: 'Match Data Unavailable',
      noFixturesActive: 'No fixtures available for the active provider or competition. Select another competition above or switch data source in Settings.',
      kickoff: 'Kickoff:',
      homeTeam: 'Home Team',
      awayTeam: 'Away Team',
      eloLabel: 'Elo',
      eloInsufficient: 'Insufficient (<5)',
      recentForm: 'Recent Form:',
      nonePrior: 'None prior',
      preMatchXGTitle: 'Pre-Match Expected Goals',
      modeScore: 'Mode Score:',
      observedPostMatchXG: 'Observed Post-Match StatsBomb xG:',
      subTabModels: 'Model Comparison & 4 Pillars',
      subTabProbs: 'Analytical Probabilities',
      subTabForm: 'Pre-Match Form Log',
      subTabH2H: 'Head-to-Head',
      subTabAI: 'AI Tactical Diagnosis',
      abstainProbsDesc: 'Both teams require at least 5 completed pre-match fixtures before goal probabilities can be estimated.',
      winner1X2CardTitle: '1X2 Match Winner Probabilities',
      winner1X2CardDesc: 'Normalized Dixon-Coles bivariate goal distribution.',
      homeWinSuffix: 'Win',
      matchDrawLabel: 'Match Draw',
      equalGoals: 'Equal Goals',
      doubleChanceCardTitle: 'Double Chance Probabilities',
      doubleChanceCardDesc: 'Two-way composite outcome probabilities derived strictly from the normalized 1X2 distribution.',
      homeOrDrawLabel: 'Home or Draw',
      awayOrDrawLabel: 'Away or Draw',
      homeOrAwayLabel: 'Home or Away (12 - No Draw)',
      goalTotalsTitle: 'Goal Total Probabilities (Over / Under)',
      goalTotalsDesc: 'Bounded Poisson cumulative distributions accounting for tail probability mass.',
      over15Goals: 'Over 1.5 Goals',
      over25Goals: 'Over 2.5 Goals',
      over35Goals: 'Over 3.5 Goals',
      under15Prefix: 'Under 1.5:',
      under25Prefix: 'Under 2.5:',
      under35Prefix: 'Under 3.5:',
      bttsYesFull: 'Both Teams To Score (BTTS - Yes)',
      topScorelinesTitle: 'Top Projected Scorelines',
      topScorelinesDesc: 'Joint Poisson density for top discrete score outcomes.',
      avgXGTitle: 'Average xG / xGA',
      avgGoalsTitle: 'Avg Goals / Conceded',
      diffPrefix: 'Diff:',
      xgNotTracked: 'xG: Not tracked pre-match',
      cleanSheets: 'Clean Sheets',
      restAndCongestion: 'Rest & Congestion',
      daysUnit: 'Days',
      congestion21d: '21d Index:',
      congestionNA: 'Congestion: N/A',
      preMatchXGGoalLog: 'Pre-Match xG & Goal Log',
      preMatchResultsLog: 'Pre-Match Results Log',
      priorMatchesSuffix: 'prior matches',
      noCompletedPrior: 'No completed matches recorded prior to kickoff',
      goalsPrefix: 'Goals:',
      h2hTitle: 'Head-to-Head Prior Meetings',
      h2hDesc: 'Competitive meetings played prior to kickoff between',
      drawsLabel: 'Draws:',
      noH2HRecorded: 'No prior head-to-head meetings recorded in this competition window before kickoff.',
    },
    modelComparison: {
      title: '4-Pillar Smart Confidence & Abstention Engine',
      desc: 'Separates raw mathematical probability from empirical data reliability and multi-model agreement.',
      systemAbstain: 'SYSTEM ABSTAIN (NO CALL)',
      highConviction: 'HIGH-CONVICTION ANALYSIS',
      moderateSignal: 'MODERATE SIGNAL',
      abstainPolicyNote: 'Scientific integrity policy: The model refuses to issue probabilities when data sample size is insufficient or cross-model variance exceeds safety bounds.',
      pillar1Title: '1. Model Probability',
      pillar1Sub: 'Raw mathematical likelihood',
      pillar2Title: '2. Historical Accuracy',
      pillar2SubVerified: 'Empirical backtest reference',
      pillar2SubUnavailable: 'Historical validation unavailable',
      unavailableText: 'Unavailable',
      pillar3Title: '3. Data Reliability',
      pillar3Sub: 'Sample size & metric completeness',
      pillar4Title: '4. Model Agreement',
      pillar4Sub: 'Consensus across active engines',
      signalClassification: 'Signal Classification:',
      tableTitle: 'Independent Multi-Model Evaluation Comparison',
      tableDesc: 'Evaluating agreement and divergence across Poisson, Dixon-Coles, Elo (when >= 5 matches exist), and Monte Carlo (when enabled).',
      noModelTable: 'No quantitative model table generated because pre-match data requirements were not met.',
      colEngine: 'Model Engine',
      colDraw: 'Draw (X)',
      colOver25: 'Over 2.5',
      colBtts: 'BTTS',
      colNotes: 'Methodology Notes',
      scientificNoteLabel: 'Scientific Note:',
      scientificNoteBody: 'MatchMind AI never assumes that simply averaging models improves predictive validity. Each algorithm captures a distinct football domain: Poisson models goal count distributions, Dixon-Coles calibrates low-score dependency, Elo measures long-term team strength, and Monte Carlo maps non-linear variance.',
    },
    scorelineMatrix: {
      mostLikely: 'Most Likely',
      outcomePrefix: 'Outcome #',
    },
    aiCard: {
      title: 'Gemini Tactical Match Intelligence',
      liveBadge: 'LIVE GEMINI 3.8 FLASH',
      awaitingBadge: 'AWAITING SYNTHESIS',
      subtitle: 'Tactical synthesis grounded strictly on verified xG, xGA, and rolling form.',
      zeroHallucination: 'Zero Hallucination Policy',
      synthesizingBtn: 'Synthesizing Verified Data...',
      runBtn: 'Run Live Gemini Diagnosis',
      loadingTitle: 'Querying Gemini 3.8 Flash Tactical Engine...',
      loadingDesc: 'Analyzing verified metrics, pressing traps, transition vulnerabilities, and expected goals for',
      offlineTitle: 'Live Gemini Analysis Status: Offline / Key Pending',
      scientificIntegrityNote: 'Scientific Integrity Rule: MatchMind AI never fabricates or hardcodes fake AI responses. If the live model call fails or an API key is not configured, we display pure mathematical Poisson, Elo, and Monte Carlo models without synthetic text.',
      execSummary: 'Executive Tactical Synthesis',
      expectedScore: 'Model Expected Score',
      modelConfidence: 'Model Confidence:',
      keyFactors: 'Key Tactical Factors',
      teamProfileSuffix: 'Profile',
      keyStrengths: 'Key Strengths',
      vulnerabilities: 'Tactical Vulnerabilities',
      tacticalRationale: 'Tactical Rationale & Observations',
      dataProvenanceLabel: 'Data Provenance:',
      matchesWord: 'Matches',
      qualityScoreLabel: 'Quality Score:',
      emptyPrompt: 'Click "Run Live Gemini Diagnosis" to synthesize tactical intelligence from verified structured statistics.',
    },
    validation: {
      loadingText: 'Executing time-separated walk-forward validation...',
      unavailableTitle: 'Validation Run Unavailable',
      unavailableFallback: 'Backtest metrics could not be computed for the active provider.',
      retryBtn: 'Retry Validation Run',
      tag: 'Scientific Verification & Calibration',
      subTag: 'Strict Time-Separated Evaluation',
      pageTitle: 'Validation & Empirical Backtesting Hub',
      sourceLabel: 'Source:',
      evaluatedLabel: 'Evaluated:',
      temporalConstraintDesc: 'Only pre-kickoff statistics and outcomes prior to T are ingested.',
      competitionLabel: 'Competition:',
      defaultCompetition: 'Default Competition',
      noHistoricalCompetitions: 'No Historical Competitions',
      fullSeasonScope: 'Full Season Scope',
      scopeLabel: 'Scope:',
      coverageLabel: 'Coverage:',
      trackerTitle: 'Empirical Double Chance & Market Calibration Tracker',
      trackerDesc: '80% accuracy is an ambitious research target measured independently per market over non-abstained matches—never a blanket guarantee. Matches with insufficient pre-match data abstain cleanly',
      abstainedInRun: 'abstained in this run',
      measuredDcHitRate: 'Measured Double Chance Hit Rate',
      noTestableSample: 'NO TESTABLE SAMPLE',
      benchmarkMet: 'BENCHMARK >= 80% MET',
      researchInProgress: 'RESEARCH IN PROGRESS',
      availabilityNotice: 'Backtest Availability Notice',
      kpiBrierTitle: 'Overall Brier Score',
      testedMatchesSuffix: 'tested matches',
      noCompletedSample: 'No completed backtest sample',
      kpiLogLossTitle: 'Overall Log Loss',
      kpiLogLossSub: 'Cross-entropy calibration measure',
      kpiLeakageTitle: 'Data Leakage Verification',
      zeroLeakage: 'Zero Leakage',
      unverified: 'Unverified',
      kpiLeakageSub: 'Strict pre-kickoff temporal split (< T)',
      kpiWindowTitle: 'Validation Window',
      abstainedWord: 'abstained',
      tableTitle: 'Empirical Market Accuracy & Baseline Benchmark Comparison',
      tableDesc: 'Measured independently by prediction market against observed dataset base rates.',
      colMarket: 'Prediction Market',
      colTested: 'Tested Matches',
      colAccuracy: 'Model Accuracy',
      colBrier: 'Brier Score',
      colBaseRate: 'Dataset Base Rate',
      colAdvantage: 'Advantage vs Base',
      colBenchmark: 'Research Benchmark',
      validated80: '>= 80% Validated',
      highVarianceMarket: 'High Variance Market',
      calibrationTitle: 'Calibration Curve (Reliability Diagram)',
      calibrationDesc: 'Observed frequency vs predicted probability across populated confidence bins.',
      noCalibrationBins: 'No calibration bins available for this provider run.',
      predictedLabel: 'Predicted:',
      observedLabel: 'Observed:',
      calibrationDelta: 'Calibration Delta:',
      emptyBin: 'Empty bin',
      noSamples: 'No samples',
      optimalCalibration: 'Optimal Calibration',
      withinTolerance: 'Within Tolerance',
      safeguardsTitle: 'Scientific Backtesting Safeguards',
      safeguardsIntro: 'MatchMind AI enforces strict non-negotiable research protocols across all historical runs:',
      safeguard1Title: '1. Strict Time-Based Train/Test Separation',
      safeguard1Body: 'For every historical match tested at kickoff T, only completed results strictly before T are ingested. Post-match event xG and target scores never leak into predictions.',
      safeguard2Title: '2. Genuine Abstention Under Data Deficit',
      safeguard2Body: 'Early-round fixtures with fewer than 5 prior verified team matches abstain cleanly instead of guessing with hardcoded baselines.',
      safeguard3Title: '3. No Fallback Contamination',
      safeguard3Body: 'Synthetic demo records never enter real OpenLigaDB or StatsBomb validation runs.',
      researchPolicyLabel: 'Research Policy:',
      researchPolicyBody: 'MatchMind AI is an analytical sports research tool. No prediction is guaranteed.',
    },
    history: {
      tag: 'Model Evaluation & Calibration',
      subTag: 'Empirical Performance Audit',
      pageTitle: 'Analytical History & Validation Log',
      pageDesc: 'Transparent retrospective reviews comparing strictly pre-kickoff model distributions against verified match scorelines.',
      competitionLabel: 'Competition:',
      evaluateFullSeason: 'Evaluate Full Season (remove default window)',
      loadingText: 'Evaluating chronological historical logs...',
      unableToLoad: 'Unable to Load History Log',
      noHistoryTitle: 'No Historical Backtest Log Available',
      openLigaNoHistory: 'OpenLigaDB provides current-season community schedules and does not supply multi-season historical archives. Switch to StatsBomb Open Data or Unified mode in Settings to inspect retrospective evaluations.',
      noCompletedRecords: 'No completed historical records were returned for the selected competition.',
      kpiAvgBrier: 'Average 1X2 Brier Score',
      measuredNonAbstained: 'Measured across non-abstained matches',
      requires1NonAbstained: 'Requires at least 1 non-abstained evaluation',
      kpiEvaluatedVsAbstained: 'Evaluated vs Abstained',
      abstainedCoverage: 'abstained (coverage:',
      kpi1X2Accuracy: '1X2 Empirical Accuracy',
      excludesAbstentions: 'Excludes abstentions · LogLoss:',
      kpiOver25Accuracy: 'Over/Under 2.5 Accuracy',
      measuredAgainstFT: 'Measured strictly against verified FT totals',
      listTitle: 'Historical Match Evaluations',
      showingRecordsPrefix: 'Showing',
      recordsWord: 'records',
      playedLabel: 'Played:',
      actualFT: 'Actual FT',
      abstainExcludedNote: 'Prediction unavailable due to insufficient verified pre-match data (excluded from accuracy & Brier averages).',
      modelTopScore: 'Model Top Score',
      probPrefix: 'Prob:',
      prediction1X2: '1X2 Prediction',
      outcomePrefix: 'Outcome:',
      over25Label: 'Over/Under 2.5',
      overWord: 'Over',
      actualPrefix: 'Actual:',
      over25Value: 'Over 2.5',
      under25Value: 'Under 2.5',
      calibrationFinding: 'Calibration Finding:',
    },
    settings: {
      tag: 'Free Football Data Providers',
      subTag: 'Architecture Configuration',
      pageTitle: 'Data Providers & Quantitative Parameters',
      pageDesc: 'MatchMind AI integrates 100% free, un-monetized football data sources. Zero subscriptions, zero paid API keys, zero rate-wall lockouts.',
      languageSectionTitle: 'Interface Language & Direction (RTL / LTR)',
      languageSectionDesc: 'Select your preferred display language across the entire platform. Your preference is saved automatically and applies RTL/LTR layout and Gemini analysis language.',
      arabicOption: 'العربية (RTL)',
      arabicOptionDesc: 'Full right-to-left Arabic interface with Arabic Gemini tactical reports.',
      englishOption: 'English (LTR)',
      englishOptionDesc: 'Full left-to-right English interface with English Gemini tactical synthesis.',
      connectorsTitle: 'Approved Free Football Data Connectors',
      connectorsDesc: 'Select the active data engine (saved automatically in browser storage). MatchMind AI enforces a strict no-fallback rule: real providers never silently revert to synthetic demo data.',
      unifiedName: 'Unified Multi-Source Engine',
      unifiedBadge: 'Recommended · Default',
      unifiedDesc: 'Combines live OpenLigaDB matches with StatsBomb historical research archives for backtesting.',
      openLigaName: 'OpenLigaDB Live REST API',
      openLigaBadge: 'Community · 100% Free',
      openLigaDesc: 'Real live German fixtures, standings, and results (Bundesliga 1/2/3, DFB Pokal). No key needed.',
      statsBombName: 'StatsBomb Open Data',
      statsBombBadge: 'CC BY 4.0 · Research',
      statsBombDesc: 'Verified historical competition matches and shot-level statsbomb_xg for chronological backtesting.',
      demoName: 'Isolated Benchmark Demo Data',
      demoBadge: 'Offline Preview Only',
      demoDesc: 'Pre-calibrated benchmark fixtures for offline UI preview. Strictly isolated from real provider modes.',
      attributionTitle: 'Free Source Attribution & Usage Terms',
      openLigaAttribution: 'Public community football API. Data is community-maintained and cached server-side (5m TTL). Advanced metrics (xG, lineups) are not tracked and are honestly labeled N/A.',
      statsBombAttributionPrefix: 'Released under',
      statsBombAttributionLink: 'Creative Commons Attribution 4.0 International (CC BY 4.0)',
      statsBombAttributionSuffix: '. Used strictly for historical research, actual shot event xG parsing, and out-of-sample backtest validation.',
      poissonSectionTitle: 'Poisson Statistical Engine Parameters',
      homeAdvantageLabel: 'Home Field Advantage Factor',
      homeAdvantageHint: 'Historically calibrated European leagues home goal boost (~1.10x–1.20x).',
      formDecayLabel: 'Recent Form Decay Rate',
      formDecayHint: 'Exponential weight decay applied to the last 5 matches.',
      geminiSectionTitle: 'Gemini AI Strategic Analysis Engine',
      activeLlmLabel: 'Active LLM Model',
      activeLlmSub: 'Server-side high-throughput reasoning',
      schemaContractLabel: 'Structured Schema Contract',
      schemaContractSub: 'Type-safe JSON response with key factors, strengths, weaknesses & probabilities',
      schemaEnforced: 'ENFORCED (Type.OBJECT)',
      geminiKeyNotePrefix: 'Gemini API keys are securely managed via the server environment variable',
      geminiKeyNoteSuffix: '. No keys are ever transmitted to or stored in client-side bundles.',
      ethicsTitle: 'Responsible Analytics & Ethics Policy',
      ethicsBody: 'MatchMind AI is built strictly as a sports data science and machine learning research platform. We do not provide sports betting services, betting slips, financial transactions, or guaranteed wagering recommendations. All outputs are statistical probabilities subject to inherent sporting variance.',
      savedToast: 'Preferences successfully saved.',
      saveButton: 'Save Configuration',
    },
  },
};

export function translateConfidenceTier(
  confidence: 'HIGH' | 'MEDIUM' | 'MODERATE' | null | undefined,
  lang: Language
): string {
  if (!confidence) return lang === 'ar' ? 'امتناع' : 'ABSTAIN';
  if (lang === 'en') return confidence;
  switch (confidence) {
    case 'HIGH':
      return 'عالية';
    case 'MEDIUM':
      return 'متوسطة';
    case 'MODERATE':
      return 'معتدلة';
  }
}

export function translateTargetTier(tier: string | undefined, lang: Language): string {
  if (!tier || lang === 'en') return tier || '';
  if (tier.includes('Double Chance')) return 'إشارة عالية — الفرصة المزدوجة (1X/X2)';
  if (tier.includes('Goal / Match Outcome')) return 'إشارة عالية — الأهداف / نتيجة المباراة';
  return tier;
}

export function translateMarketKey(
  marketKey: 'HOME_WIN' | 'OVER_15' | 'OVER_25' | 'BTTS' | 'DOUBLE_CHANCE',
  fallbackLabel: string,
  lang: Language
): string {
  if (lang === 'en') return fallbackLabel;
  switch (marketKey) {
    case 'DOUBLE_CHANCE':
      return 'الفرصة المزدوجة (1X / X2 الأرجح)';
    case 'OVER_15':
      return 'سقف الأهداف (أكثر من 1.5 هدف)';
    case 'OVER_25':
      return 'أكثر من 2.5 هدف في المباراة';
    case 'HOME_WIN':
      return 'الفائز بالمباراة 1X2 (فوز المستضيف)';
    case 'BTTS':
      return 'تسجيل كلا الفريقين (BTTS)';
  }
}

export function translateEvaluationScope(
  scope: 'FULL_SEASON' | 'WINDOWED' | 'UNSUPPORTED',
  lang: Language
): string {
  if (lang === 'en') return scope;
  switch (scope) {
    case 'FULL_SEASON':
      return 'الموسم الكامل';
    case 'WINDOWED':
      return 'نافذة زمنية محددة';
    case 'UNSUPPORTED':
      return 'غير مدعوم';
  }
}

export function translateWinnerLabel(winner: 'HOME' | 'AWAY' | 'DRAW', lang: Language): string {
  if (lang === 'en') return winner;
  switch (winner) {
    case 'HOME':
      return 'فوز المستضيف';
    case 'AWAY':
      return 'فوز الضيف';
    case 'DRAW':
      return 'تعادل';
  }
}

export function translateModelName(name: string, lang: Language): string {
  if (lang === 'en') return name;
  switch (name) {
    case 'Poisson':
      return 'بواسون (Poisson)';
    case 'Dixon-Coles':
      return 'ديكسون-كولز (Dixon-Coles)';
    case 'Elo':
      return 'تقييم إيلو (Elo)';
    case 'Monte Carlo':
      return 'مونت كارلو (Monte Carlo)';
    case 'xG Regression':
      return 'انحدار الأهداف المتوقعة (xG)';
    default:
      return name;
  }
}

export function translateProviderMessage(msg: string | undefined | null, lang: Language): string {
  if (!msg || lang === 'en') return msg || '';

  // Pattern: Insufficient verified pre-match sample size (home: X, away: Y; minimum required: 5).
  const sampleMatch = msg.match(
    /Insufficient verified pre-match sample size \(home:\s*(\d+),\s*away:\s*(\d+);\s*minimum required:\s*(\d+)\)/i
  );
  if (sampleMatch) {
    return `عينة ما قبل المباراة الموثقة غير كافية (المستضيف: ${sampleMatch[1]}، الضيف: ${sampleMatch[2]}؛ الحد الأدنى المطلوب: ${sampleMatch[3]}).`;
  }

  // Pattern: Data completeness below reliability threshold (X/100; minimum 50 required).
  const reliabilityMatch = msg.match(
    /Data completeness below reliability threshold \((\d+)\/100;\s*minimum (\d+) required\)/i
  );
  if (reliabilityMatch) {
    return `اكتمال البيانات دون حد الموثوقية (${reliabilityMatch[1]}/100؛ الحد الأدنى المطلوب ${reliabilityMatch[2]}).`;
  }

  // Pattern: Model divergence exceeds uncertainty threshold (Consensus index: X%).
  const divergenceMatch = msg.match(
    /Model divergence exceeds uncertainty threshold \(Consensus index:\s*(\d+)%\)/i
  );
  if (divergenceMatch) {
    return `يتجاوز تباين النماذج حد عدم اليقين (مؤشر التوافق: ${divergenceMatch[1]}%).`;
  }

  // Pattern: OpenLigaDB backtest archive message
  if (msg.includes('OpenLigaDB') && msg.toLowerCase().includes('archive')) {
    return 'لا توفر واجهة OpenLigaDB أرشيف أحداث تاريخي متعدد المواسم للاختبار الاسترجاعي. استخدم StatsBomb أو الوضع الموحد.';
  }

  // Pattern: Insufficient historical sample messages
  if (msg.toLowerCase().includes('insufficient verified pre-match data')) {
    return 'التوقع غير متاح لعدم كفاية البيانات الموثقة قبل المباراة.';
  }

  // Pattern: Model notes common phrases
  if (msg.includes('Bivariate Poisson')) {
    return 'توزيع بواسون ثنائي المتغيرات مبني على معدلات التهديف والاستقبال ما قبل المباراة.';
  }
  if (msg.includes('Dixon-Coles') && msg.includes('low-score')) {
    return 'تعديل ديكسون-كولز لتصحيح الارتباط في النتائج منخفضة الأهداف.';
  }
  if (msg.includes('Elo') && msg.includes('rating differential')) {
    return 'احتمالات مشتقة من فارق تصنيف إيلو التاريخي قبل ضربة البداية.';
  }
  if (msg.includes('10,000') || msg.includes('Monte Carlo')) {
    return 'محاكاة مونت كارلو (10,000 جولة) لرسم التباين العشوائي لتوزيع الأهداف.';
  }
  if (msg.includes('xG') && msg.includes('regression')) {
    return 'نموذج انحدار مبني على الأهداف المتوقعة (xG) ما قبل المباراة.';
  }

  // History notes patterns
  if (msg.toLowerCase().startsWith('abstained:')) {
    return `امتناع: ${translateProviderMessage(msg.slice('abstained:'.length).trim(), lang)}`;
  }

  return msg;
}
