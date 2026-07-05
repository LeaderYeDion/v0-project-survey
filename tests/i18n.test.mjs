import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

import {
  formatDate,
  formatDecimal,
  formatInteger,
  formatPercentage,
  normalizeLocale,
  resolveLocale,
} from "../lib/i18n/locale.ts"
import { messages } from "../lib/i18n/messages.ts"

const readSource = (path) =>
  readFile(new URL(path, import.meta.url), "utf8")

const stripComments = (source) => {
  let result = ""
  let index = 0
  let quote = null

  while (index < source.length) {
    const current = source[index]
    const next = source[index + 1]

    if (quote) {
      result += current
      if (current === "\\") {
        result += next ?? ""
        index += 2
        continue
      }
      if (current === quote) quote = null
      index += 1
      continue
    }

    if (current === '"' || current === "'" || current === "`") {
      quote = current
      result += current
      index += 1
      continue
    }

    if (current === "/" && next === "/") {
      index += 2
      while (index < source.length && source[index] !== "\n") index += 1
      continue
    }

    if (current === "/" && next === "*") {
      index += 2
      while (
        index < source.length &&
        !(source[index] === "*" && source[index + 1] === "/")
      ) {
        index += 1
      }
      index += 2
      continue
    }

    result += current
    index += 1
  }

  return result
}

test("normalizes supported and language-family locale values", () => {
  assert.equal(normalizeLocale("zh-CN"), "zh-CN")
  assert.equal(normalizeLocale("zh-TW,zh;q=0.9"), "zh-CN")
  assert.equal(normalizeLocale("en-GB,en;q=0.9"), "en-US")
})

test("prefers a valid locale cookie and otherwise normalizes the header", () => {
  assert.equal(resolveLocale("en-US", "zh-CN"), "en-US")
  assert.equal(resolveLocale("invalid", "zh-CN"), "zh-CN")
  assert.equal(resolveLocale(undefined, "fr-FR"), "en-US")
})

test("formats dates deterministically for both locales", () => {
  const timestamp = "2024-01-02T15:04:05Z"
  const options = {
    timeZone: "UTC",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }

  assert.equal(formatDate("zh-CN", timestamp, options), "2024/01/02")
  assert.equal(formatDate("en-US", timestamp, options), "01/02/2024")
})

test("formats grouped integers for both locales", () => {
  assert.equal(formatInteger("zh-CN", 1_234_567), "1,234,567")
  assert.equal(formatInteger("en-US", 1_234_567), "1,234,567")
})

test("formats decimals with exact locale-aware precision", () => {
  assert.equal(formatDecimal("zh-CN", 1_234.5, 2), "1,234.50")
  assert.equal(formatDecimal("en-US", 1_234.5, 2), "1,234.50")
  assert.equal(formatDecimal("en-US", 1.26, 1), "1.3")
})

test("formats ratio inputs as percentages for both locales", () => {
  assert.equal(formatPercentage("zh-CN", 0.625), "63%")
  assert.equal(formatPercentage("en-US", 0.625), "63%")
})

test("percentage formatting cannot be changed to a non-percent style", () => {
  assert.equal(
    formatPercentage("en-US", 0.625, { style: "decimal" }),
    "63%",
  )
})

function assertMatchingMessageShape(reference, candidate, path = "messages") {
  assert.equal(
    typeof candidate,
    typeof reference,
    `${path} must have the same value type`,
  )

  if (typeof reference === "function") {
    return
  }

  if (reference && typeof reference === "object") {
    assert.deepEqual(
      Object.keys(candidate).sort(),
      Object.keys(reference).sort(),
      `${path} must have the same nested keys`,
    )
    for (const key of Object.keys(reference)) {
      assertMatchingMessageShape(reference[key], candidate[key], `${path}.${key}`)
    }
  }
}

test("Chinese and English catalogs have matching nested keys and functions", () => {
  assertMatchingMessageShape(messages["zh-CN"], messages["en-US"])
})

test("catalogs provide localized language switcher labels", () => {
  assert.equal(messages["zh-CN"].common.selectLanguage, "选择语言")
  assert.equal(messages["en-US"].common.selectLanguage, "Select language")
})

test("dynamic catalog messages compose already-formatted values", () => {
  assert.equal(messages["zh-CN"].survey.completionRate("63%"), "完成率约 63%")
  assert.equal(
    messages["en-US"].survey.completionRate("63%"),
    "Completion rate: 63%",
  )
  assert.equal(
    messages["zh-CN"].interview.respondentSummary(10, 4),
    "10 位受访者 / 4 已完成",
  )
  assert.equal(messages["en-US"].survey.responsePosition(2, 8), "2 of 8")
  assert.equal(
    messages["en-US"].analytics.filteredRespondents(3, 10),
    "Showing 3 of 10 respondents",
  )
  assert.equal(messages["zh-CN"].analytics.groupCount(2), "2 个分组")
  assert.equal(messages["en-US"].common.people(1), "1 person")
  assert.equal(messages["en-US"].common.people("2"), "2 people")
  assert.equal(messages["en-US"].common.responses("1"), "1 response")
  assert.equal(messages["en-US"].common.responses(2), "2 responses")
  assert.equal(messages["en-US"].analytics.groupCount(1), "1 group")
  assert.equal(messages["en-US"].analytics.groupCount("2"), "2 groups")
  assert.equal(
    messages["en-US"].interview.questionProgress(3, "-"),
    "Question progress: 3 / -",
  )
})

test("server locale resolution awaits cookies and headers together", async () => {
  const source = await readSource("../lib/i18n/server.ts")

  assert.match(source, /await Promise\.all\(\[\s*cookies\(\),\s*headers\(\),?\s*\]\)/)
  assert.match(source, /resolveLocale\(/)
  assert.match(source, /cookieStore\.get\(LOCALE_COOKIE\)\?\.value/)
  assert.match(source, /requestHeaders\.get\(["']accept-language["']\)/)
})

test("root layout synchronizes the resolved locale with html and the provider", async () => {
  const source = await readSource("../app/layout.tsx")

  assert.match(source, /export default async function RootLayout/)
  assert.match(source, /const locale = await getRequestLocale\(\)/)
  assert.match(source, /<html lang=\{locale\}/)
  assert.match(source, /<LocaleProvider initialLocale=\{locale\}>/)
})

test("localized metadata comes from the resolved message catalog", async () => {
  const source = await readSource("../app/layout.tsx")

  assert.match(source, /export async function generateMetadata/)
  assert.match(source, /messages\[locale\]\.metadata/)
})

test("browser locale synchronization updates document state for both locales", async () => {
  const { syncDocumentLocale } = await import("../lib/i18n/browser.ts")
  const description = {
    content: "",
    setAttribute(name, value) {
      assert.equal(name, "content")
      this.content = value
    },
  }
  const fakeDocument = {
    documentElement: { lang: "" },
    cookie: "",
    title: "",
    querySelector(selector) {
      assert.equal(selector, 'meta[name="description"]')
      return description
    },
  }

  for (const locale of ["zh-CN", "en-US"]) {
    syncDocumentLocale(
      fakeDocument,
      locale,
      messages[locale].metadata,
      "survey_locale",
    )

    assert.equal(fakeDocument.documentElement.lang, locale)
    assert.equal(
      fakeDocument.cookie,
      `survey_locale=${locale}; Path=/; Max-Age=31536000; SameSite=Lax`,
    )
    assert.equal(fakeDocument.title, messages[locale].metadata.title)
    assert.equal(description.content, messages[locale].metadata.description)
  }
})

test("locale provider delegates synchronous document updates to the browser helper", async () => {
  const source = await readSource("../components/locale-provider.tsx")

  assert.match(source, /setLocaleState\(locale\)/)
  assert.match(source, /syncDocumentLocale\(\s*document,\s*locale,/)
  assert.doesNotMatch(source, /router\.refresh/)
})

test("language switcher exposes both language options with a catalog label", async () => {
  const source = await readSource("../components/language-switcher.tsx")

  assert.match(source, /<Button[\s\S]*?lang="zh-CN"[\s\S]*?>中文<\/Button>/)
  assert.match(source, /<Button[\s\S]*?lang="en-US"[\s\S]*?>English<\/Button>/)
  assert.match(source, /aria-label=\{messages\.common\.selectLanguage\}/)
  assert.doesNotMatch(source, /aria-label=\{messages\.common\.productName\}/)
})

test("dashboard and survey configuration use the locale catalog at the UI boundary", async () => {
  const dashboard = await readSource("../app/page.tsx")
  const configuration = await readSource(
    "../components/survey-config-panel.tsx",
  )

  assert.match(dashboard, /const \{ locale, messages \} = useI18n\(\)/)
  assert.match(dashboard, /<LanguageSwitcher \/>/)
  assert.match(configuration, /const \{ messages \} = useI18n\(\)/)
})

test("initial mode chooser is a mandatory modal with an in-dialog language switcher", async () => {
  const source = await readSource("../app/page.tsx")
  const chooser = source.match(
    /<AlertDialog open=\{!modeSelected\}>[\s\S]*?<\/AlertDialog>/,
  )?.[0]

  assert.ok(chooser, "mode chooser must use the controlled AlertDialog")
  const contentClass = chooser.match(
    /<AlertDialogContent[\s\S]*?\sclassName="([^"]+)"/,
  )?.[1]
  assert.ok(contentClass)
  assert.match(contentClass, /(?:^|\s)sm:max-w-\[380px\](?:\s|$)/)
  assert.doesNotMatch(
    contentClass,
    /(?:^|\s)(?:w-full|max-w-\[380px\])(?:\s|$)/,
    "base AlertDialogContent must retain its shared mobile gutters",
  )
  assert.match(
    chooser,
    /<AlertDialogContent[\s\S]*?overlayClassName="bg-background\/95 backdrop-blur-xl"/,
  )
  assert.match(chooser, /<AlertDialogTitle/)
  assert.match(chooser, /<AlertDialogDescription/)
  assert.match(chooser, /<LanguageSwitcher \/>/)
  assert.match(chooser, /handleModeSelection\("survey"\)/)
  assert.match(chooser, /handleModeSelection\("interview"\)/)
  assert.doesNotMatch(
    chooser,
    /AlertDialog(?:Action|Cancel)|onOpenChange|DialogClose/,
    "mode selection must be the only way to dismiss the chooser",
  )
})

test("alert dialog content supports a scoped overlay appearance", async () => {
  const source = await readSource("../components/ui/alert-dialog.tsx")

  assert.match(source, /overlayClassName\?: string/)
  assert.match(
    source,
    /<AlertDialogOverlay className=\{overlayClassName\} \/>/,
  )
})

test("persistent mode selector is a localized pressed-button group", async () => {
  const source = await readSource("../app/page.tsx")
  const group = source.match(
    /<div[\s\S]*?role="group"[\s\S]*?aria-label=\{messages\.dashboard\.chooseMode\}[\s\S]*?<\/div>/,
  )?.[0]

  assert.ok(group, "persistent mode controls must form a labelled group")
  assert.match(group, /aria-pressed=\{mode === "interview"\}/)
  assert.match(group, /aria-pressed=\{mode === "survey"\}/)
})

test("survey configuration resolves JSON errors from the current locale", async () => {
  const source = await readSource("../components/survey-config-panel.tsx")

  assert.match(source, /useState\(false\)/)
  assert.match(source, /setJsonError\(true\)/)
  assert.match(
    source,
    /\{jsonError && \([\s\S]*?\{messages\.errors\.invalidJson\}[\s\S]*?\)\}/,
  )
  assert.doesNotMatch(source, /setJsonError\(messages\.errors\.invalidJson\)/)
})

test("JSON configuration editor exposes its label and validation error", async () => {
  const source = await readSource("../components/survey-config-panel.tsx")

  assert.match(source, /<Label\s+htmlFor="survey-config-json"/)
  assert.match(source, /<Textarea[\s\S]*?id="survey-config-json"/)
  assert.match(source, /aria-invalid=\{jsonError\}/)
  assert.match(
    source,
    /aria-describedby=\{\s*jsonError \? "survey-config-json-error" : undefined\s*\}/,
  )
  assert.match(
    source,
    /<p[\s\S]*?id="survey-config-json-error"[\s\S]*?role="alert"/,
  )
})

test("respondent group delete controls include their localized group index", async () => {
  const source = await readSource("../components/survey-config-panel.tsx")

  assert.equal(
    messages["zh-CN"].config.deleteConfigurationGroup(1),
    "删除配置组 1",
  )
  assert.equal(
    messages["en-US"].config.deleteConfigurationGroup(1),
    "Delete respondent group 1",
  )
  assert.match(
    source,
    /aria-label=\{messages\.config\.deleteConfigurationGroup\(\s*index \+ 1,\s*\)\}/,
  )
})

test("dashboard and survey configuration contain no fixed Han-script UI literals", async () => {
  const dashboard = await readSource("../app/page.tsx")
  const configuration = await readSource(
    "../components/survey-config-panel.tsx",
  )
  const configurationWithoutProtocolValue = stripComments(configuration).replace(
    /gender:\s*"不限"/,
    'gender: "__ANY_GENDER_PROTOCOL_VALUE__"',
  )

  assert.doesNotMatch(
    stripComments(dashboard),
    /[\u3400-\u9fff]/u,
    "app/page.tsx must source visible and ARIA copy from the catalog",
  )
  assert.doesNotMatch(
    configurationWithoutProtocolValue,
    /[\u3400-\u9fff]/u,
    "survey-config-panel.tsx may retain only the stored protocol value 不限",
  )
  assert.match(configuration, /gender:\s*"不限"/)
})

test("survey result panels use the locale catalog at the UI boundary", async () => {
  const chat = await readSource("../components/chat-simulation-panel.tsx")
  const bulk = await readSource("../components/bulk-survey-panel.tsx")

  assert.match(chat, /const \{ locale, messages \} = useI18n\(\)/)
  assert.match(bulk, /const \{ locale, messages \} = useI18n\(\)/)
  assert.match(bulk, /formatPercentage\(locale,\s*completedCount \/ total\)/)
  assert.match(bulk, /formatDecimal\(locale,\s*value,\s*digits\)/)
  assert.match(bulk, /formatDecimal\(locale,\s*qa\.averageScore,\s*1\)/)
  assert.doesNotMatch(bulk, /\.toFixed\(/)
})

test("survey result panels preserve representative backend-provided content", async () => {
  const chat = await readSource("../components/chat-simulation-panel.tsx")
  const bulk = await readSource("../components/bulk-survey-panel.tsx")

  assert.match(chat, /\{message\.content\}/)
  assert.match(chat, /\{respondent\.name\}/)
  assert.match(chat, /\{selectedRespondent\.name\}/)
  assert.match(bulk, /\{qa\.questionText\}/)
  assert.match(bulk, /\{q\.question\}/)
  assert.match(bulk, /\(props\?\.payload as any\)\?\.label/)

  assert.match(chat, /messages\.common\.completed/)
  assert.match(chat, /messages\.interview\.conversationDetails/)
  assert.match(bulk, /messages\.survey\.responseDetails/)
  assert.match(bulk, /messages\.common\.respondentTerminated/)
})

test("bulk result disclosure controls identify the regions they control", async () => {
  const bulk = await readSource("../components/bulk-survey-panel.tsx")

  assert.match(
    bulk,
    /aria-controls="survey-question-statistics-content"[\s\S]*?aria-expanded=\{showQuestionStats\}/,
  )
  assert.match(bulk, /id="survey-question-statistics-content"/)
  assert.match(
    bulk,
    /aria-controls="survey-response-details-content"[\s\S]*?aria-expanded=\{showResponseDetail\}/,
  )
  assert.match(bulk, /id="survey-response-details-content"/)
})

test("survey result panels contain no fixed Han-script UI literals", async () => {
  for (const path of [
    "../components/chat-simulation-panel.tsx",
    "../components/bulk-survey-panel.tsx",
  ]) {
    const source = stripComments(await readSource(path))

    assert.doesNotMatch(
      source,
      /[\u3400-\u9fff]/u,
      `${path} must keep backend data dynamic and source visible and ARIA copy from the catalog`,
    )
  }
})

test("survey result panel state is not keyed or reset when locale changes", async () => {
  const chat = await readSource("../components/chat-simulation-panel.tsx")
  const bulk = await readSource("../components/bulk-survey-panel.tsx")

  assert.match(
    chat,
    /\[selectedRespondentId,\s*setSelectedRespondentId\] = useState<string \| null>\(null\)/,
  )
  assert.match(
    chat,
    /\[mobileView,\s*setMobileView\] =\s*useState<MobileInterviewView>\("respondents"\)/,
  )
  assert.match(
    bulk,
    /\[currentResponseIndex,\s*setCurrentResponseIndex\] = useState\(0\)/,
  )
  assert.match(
    bulk,
    /\[showQuestionStats,\s*setShowQuestionStats\] = useState\(true\)/,
  )
  assert.match(
    bulk,
    /\[showResponseDetail,\s*setShowResponseDetail\] = useState\(true\)/,
  )
  assert.doesNotMatch(chat, /key=\{locale\}|setSelectedRespondentId\(null\)/)
  assert.doesNotMatch(bulk, /key=\{locale\}|setCurrentResponseIndex\(0\)/)

  for (const source of [chat, bulk]) {
    const localeEffects = source.match(
      /useEffect\(\(\) => \{[\s\S]*?\}, \[[^\]]*\blocale\b[^\]]*\]\)/g,
    ) ?? []
    for (const effect of localeEffects) {
      assert.doesNotMatch(
        effect,
        /setSelectedRespondentId|setCurrentResponseIndex|setMobileView|setShowQuestionStats|setShowResponseDetail/,
      )
    }
  }
})

test("analytics and history use the locale catalog and presentation formatters", async () => {
  const analytics = await readSource("../components/analytics-panel.tsx")

  assert.match(analytics, /const \{ locale, messages \} = useI18n\(\)/)
  assert.match(
    analytics,
    /formatDate\(\s*locale,\s*viewingHistoryRecord\.savedAt,/,
  )
  assert.match(analytics, /formatDate\(\s*locale,\s*record\.savedAt,/)
  assert.match(analytics, /formatInteger\(locale,\s*progress\.totalRespondents\)/)
  assert.match(analytics, /formatPercentage\(\s*locale,/)
  assert.match(
    analytics,
    /const completionPercentage = Math\.round\(completionRatio \* 100\)/,
  )
  assert.match(
    analytics,
    /<Progress value=\{completionPercentage\} className="h-2 bg-secondary" \/>/,
  )
  assert.match(
    analytics,
    /formatDecimal\(\s*locale,\s*globalQuestionAnalysis\.averageScore,\s*1,\s*\)/,
  )
  assert.doesNotMatch(analytics, /\.toFixed\(/)
})

test("analytics API calls propagate the current locale", async () => {
  const analytics = await readSource("../components/analytics-panel.tsx")

  assert.match(
    analytics,
    /apiQueryRunAnalytics\(locale,\s*source\.id,\s*query\)/,
  )
  assert.match(
    analytics,
    /apiQueryHistoryAnalytics\(locale,\s*source\.id,\s*query\)/,
  )
  assert.match(analytics, /apiFetchSurveyHistory\(locale\)/)
  assert.match(analytics, /apiSaveRunToHistory\(locale,\s*source\.id\)/)
  assert.match(
    analytics,
    /\[[^\]]*source\?\.type[\s\S]*?\blocale\b[^\]]*\]\)/,
  )
})

test("analytics queries clear stale results and expose localized request state", async () => {
  const analytics = await readSource("../components/analytics-panel.tsx")

  assert.match(
    analytics,
    /\[isLoadingAnalytics,\s*setIsLoadingAnalytics\] = useState\(false\)/,
  )
  assert.match(
    analytics,
    /\[analyticsError,\s*setAnalyticsError\] = useState\(false\)/,
  )
  assert.match(
    analytics,
    /setAnalyticsResultState\(null\)[\s\S]*?setAnalyticsError\(false\)[\s\S]*?setIsLoadingAnalytics\(true\)[\s\S]*?window\.setTimeout/,
  )
  assert.match(
    analytics,
    /catch \(error\) \{[\s\S]*?setAnalyticsResultState\(null\)[\s\S]*?setAnalyticsError\(true\)/,
  )
  assert.match(
    analytics,
    /role="status"[\s\S]*?messages\.analytics\.loadingAnalytics/,
  )
  assert.match(
    analytics,
    /role="alert"[\s\S]*?messages\.errors\.analyticsQuery/,
  )
})

test("analytics retains dimension metadata across query transitions and resets it for a new source", async () => {
  const analytics = await readSource("../components/analytics-panel.tsx")

  assert.match(
    analytics,
    /\[dimensionMetadataState,\s*setDimensionMetadataState\] = useState<SourceDimensionMetadata \| null>\(null\)/,
  )
  assert.match(
    analytics,
    /dimensionMetadataState\?\.sourceKey === currentSourceKey[\s\S]*?dimensionMetadataState\.items[\s\S]*?: \[\]/,
  )
  assert.match(
    analytics,
    /setAnalyticsResultState\(\{ key: queryKey, result \}\)[\s\S]*?setDimensionMetadataState\(\{[\s\S]*?sourceKey,[\s\S]*?items: result\.dimensionMetadata/,
  )
  assert.match(
    analytics,
    /setDimensionMetadataState\(null\)[\s\S]*?setDimensionFilters\(\{\}\)[\s\S]*?setGroupByDimensions\(\[\]\)/,
  )

  const queryStart = analytics.match(
    /setAnalyticsResultState\(null\)[\s\S]*?const timer = window\.setTimeout/,
  )?.[0]
  assert.ok(queryStart)
  assert.doesNotMatch(queryStart, /setDimensionMetadataState/)

  const queryFailure = analytics.match(
    /catch \(error\) \{[\s\S]*?setAnalyticsError\(true\)[\s\S]*?\}/,
  )?.[0]
  assert.ok(queryFailure)
  assert.doesNotMatch(queryFailure, /setDimensionMetadataState/)
})

test("analytics loading and errors replace query results without hiding controls", async () => {
  const analytics = await readSource("../components/analytics-panel.tsx")

  assert.match(
    analytics,
    /const analyticsResult =\s*analyticsResultState\?\.key === currentQueryKey[\s\S]*?\? analyticsResultState\.result[\s\S]*?: null/,
  )
  assert.match(
    analytics,
    /const showAnalyticsResults =\s*analyticsResult !== null &&\s*!isLoadingAnalytics &&\s*!analyticsError/,
  )
  assert.match(
    analytics,
    /\{dimensionMetadata\.map\(meta => \([\s\S]*?handleDimensionFilterChange/,
  )
  assert.match(
    analytics,
    /\{showAnalyticsResults && \([\s\S]*?messages\.analytics\.filteredRespondents/,
  )
  assert.match(
    analytics,
    /\{showAnalyticsResults && \([\s\S]*?globalQuestionAnalysis[\s\S]*?groupedQuestionSummaries/,
  )
})

test("analytics results and metadata are synchronously keyed to query and source identity", async () => {
  const analytics = await readSource("../components/analytics-panel.tsx")

  assert.match(
    analytics,
    /const currentSourceKey = createAnalyticsSourceKey\(source\)/,
  )
  assert.match(
    analytics,
    /const currentQueryKey = createAnalyticsQueryKey\(\{[\s\S]*?sourceKey: currentSourceKey,[\s\S]*?questionId: effectiveQuestionId,[\s\S]*?locale,[\s\S]*?filters: dimensionFilters,[\s\S]*?groupBy: groupByDimensions/,
  )
  assert.match(
    analytics,
    /\[analyticsResultState,\s*setAnalyticsResultState\] =\s*useState<KeyedAnalyticsResult \| null>\(null\)/,
  )
  assert.match(analytics, /const queryKey = currentQueryKey/)
  assert.match(analytics, /const sourceKey = currentSourceKey/)
  assert.match(
    analytics,
    /setAnalyticsResultState\(\{ key: queryKey, result \}\)/,
  )
})

test("history and save failures are localized, visible, and latest-request guarded", async () => {
  const analytics = await readSource("../components/analytics-panel.tsx")

  assert.match(analytics, /createLatestRequestTracker/)
  assert.match(
    analytics,
    /const requestId = historyRequestTracker\.begin\(\)/,
  )
  assert.match(
    analytics,
    /historyRequestTracker\.isLatest\(requestId\)/,
  )
  assert.match(
    analytics,
    /catch \(error\) \{[\s\S]*?setHistoryError\(true\)/,
  )
  assert.match(
    analytics,
    /catch \(error\) \{[\s\S]*?setSaveError\(true\)/,
  )
  assert.match(
    analytics,
    /role="status"[\s\S]*?messages\.analytics\.loadingHistory/,
  )
  assert.match(
    analytics,
    /role="alert"[\s\S]*?messages\.errors\.historyLoad/,
  )
  assert.match(
    analytics,
    /role="alert"[\s\S]*?messages\.errors\.historySave/,
  )
  assert.match(
    analytics,
    /\{historyError && \([\s\S]*?messages\.errors\.historyLoad[\s\S]*?\)\}[\s\S]*?<ScrollArea/,
  )
  assert.match(analytics, /isSaving[\s\S]*?messages\.analytics\.savingSurvey/)
})

test("analytics preserves backend-provided labels, questions, groups, and answers", async () => {
  const analytics = await readSource("../components/analytics-panel.tsx")

  assert.match(analytics, /<span[^>]*>\{meta\.label\}<\/span>/)
  assert.match(analytics, /\{option\}/)
  assert.match(analytics, /\{q\.question\.length/)
  assert.match(analytics, /\{group\.label\}/)
  assert.match(analytics, /\{data\.tagName\}/)
  assert.match(analytics, /\{data\.fullAnswer\}/)
  assert.match(analytics, /\{answer\}/)
  assert.match(analytics, /tagName\.startsWith\("收入:"\)/)
})

test("analytics contains no fixed Han-script UI literals beyond its backend protocol marker", async () => {
  const analytics = stripComments(
    await readSource("../components/analytics-panel.tsx"),
  )
  const withoutIncomeProtocol = analytics.replaceAll(
    '"收入:"',
    '"__INCOME_PROTOCOL_PREFIX__"',
  )

  assert.doesNotMatch(
    withoutIncomeProtocol,
    /[\u3400-\u9fff]/u,
    "analytics-panel.tsx must source visible and ARIA copy from the catalog",
  )
  assert.equal(
    analytics.match(/"收入:"/g)?.length,
    2,
    "only the exact income tag protocol checks may remain",
  )
})

test("analytics dialogs and charts use their accessibility wrappers correctly", async () => {
  const analytics = await readSource("../components/analytics-panel.tsx")

  assert.match(analytics, /DialogDescription/)
  assert.match(
    analytics,
    /<DialogDescription[^>]*>[\s\S]*?messages\.analytics\.historyDescription[\s\S]*?<\/DialogDescription>/,
  )
  assert.doesNotMatch(
    analytics,
    /<ChartContainer[\s\S]*?<ResponsiveContainer[\s\S]*?<\/ResponsiveContainer>[\s\S]*?<\/ChartContainer>/,
    "ChartContainer already supplies a ResponsiveContainer",
  )
})

test("analytics state is not keyed or reset when locale changes", async () => {
  const analytics = await readSource("../components/analytics-panel.tsx")

  for (const initializer of [
    /\[selectedQuestion,\s*setSelectedQuestion\] = useState<string>/,
    /\[selectedDemographic,\s*setSelectedDemographic\] = useState<string>\("city"\)/,
    /\[historyDialogOpen,\s*setHistoryDialogOpen\] = useState\(false\)/,
    /\[dimensionFilters,\s*setDimensionFilters\] = useState<DimensionFilters>\(\{\}\)/,
    /\[groupByDimensions,\s*setGroupByDimensions\] = useState<RespondentDimensionKey\[]>\(\[\]\)/,
  ]) {
    assert.match(analytics, initializer)
  }
  assert.doesNotMatch(analytics, /key=\{locale\}/)

  const localeEffects = analytics
    .split("useEffect(")
    .filter(effect => /\}, \[[^\]]*\blocale\b[^\]]*\]\)/.test(effect))
  for (const effect of localeEffects) {
    assert.doesNotMatch(
      effect,
      /setSelectedQuestion|setSelectedDemographic|setHistoryDialogOpen|setDimensionFilters|setGroupByDimensions|onReturnToCurrent/,
    )
  }
})

test("analytics validates question selection before rendering and querying", async () => {
  const analytics = await readSource("../components/analytics-panel.tsx")

  assert.match(
    analytics,
    /useState<string>\(\(\) =>\s*selectValidQuestionId\("", questions\),?\s*\)/,
  )
  assert.match(
    analytics,
    /const effectiveQuestionId = selectValidQuestionId\(selectedQuestion, questions\)/,
  )
  assert.match(
    analytics,
    /setSelectedQuestion\(current =>\s*selectValidQuestionId\(current, questions\),?\s*\)/,
  )
  assert.match(analytics, /questionId: effectiveQuestionId/)
  assert.match(
    analytics,
    /useEffect\(\(\) => \{[\s\S]*?effectiveQuestionId[\s\S]*?\}, \[[^\]]*effectiveQuestionId[^\]]*\]\)/,
  )
  assert.equal(
    analytics.match(
      /<Select value=\{effectiveQuestionId\} onValueChange=\{setSelectedQuestion\}>/g,
    )?.length,
    2,
  )
})

test("login page keeps redirect sanitization on the server and delegates localized UI", async () => {
  const source = await readSource("../app/login/page.tsx")

  assert.match(source, /export default async function LoginPage/)
  assert.match(source, /getSafeRedirectPath\(requestedNext\)/)
  assert.match(source, /return <LoginPageContent nextPath=\{nextPath\} \/>/)
  assert.doesNotMatch(source, /LoginForm/)
})

test("login content and form use the locale catalog without fixed Chinese UI copy", async () => {
  const page = await readSource("../app/login/page.tsx")
  const content = await readSource("../app/login/login-page-content.tsx")
  const form = await readSource("../app/login/login-form.tsx")

  assert.match(content, /^"use client"/)
  assert.match(content, /useI18n\(\)/)
  assert.match(content, /<LanguageSwitcher \/>/)
  assert.match(content, /<LoginForm nextPath=\{nextPath\} \/>/)
  assert.match(form, /const \{ locale, messages \} = useI18n\(\)/)
  assert.match(form, /"Accept-Language": locale/)

  for (const [name, source] of [
    ["page.tsx", page],
    ["login-page-content.tsx", content],
    ["login-form.tsx", form],
  ]) {
    assert.doesNotMatch(
      source,
      /[\u3400-\u9fff]/u,
      `${name} must not contain fixed Chinese UI literals`,
    )
  }
})

async function loadLoginErrorState() {
  return import("../app/login/login-error-state.ts").catch(() => ({}))
}

test("login errors are visible only in the locale that produced them", async () => {
  const { getVisibleLoginError } = await loadLoginErrorState()

  assert.equal(typeof getVisibleLoginError, "function")
  const error = {
    locale: "en-US",
    message: "The username or password is incorrect.",
  }

  assert.equal(
    getVisibleLoginError(error, "en-US"),
    "The username or password is incorrect.",
  )
  assert.equal(getVisibleLoginError(error, "zh-CN"), null)
  assert.equal(getVisibleLoginError(null, "en-US"), null)
})

test("superseded login requests stay invalid after switching back to their locale", async () => {
  const { isCurrentLoginRequest } = await loadLoginErrorState()

  assert.equal(typeof isCurrentLoginRequest, "function")
  const englishRequest = { locale: "en-US", epoch: 1 }

  assert.equal(isCurrentLoginRequest(englishRequest, "en-US", 1), true)
  assert.equal(isCurrentLoginRequest(englishRequest, "zh-CN", 2), false)
  assert.equal(isCurrentLoginRequest(englishRequest, "en-US", 3), false)
})

test("login form clears and invalidates errors on locale changes without clearing credentials", async () => {
  const source = await readSource("../app/login/login-form.tsx")

  assert.match(source, /useState<LoginErrorState \| null>\(null\)/)
  assert.match(source, /getVisibleLoginError\(error, locale\)/)
  assert.match(source, /currentLocaleRef\.current = locale/)
  assert.match(source, /requestEpoch\.current \+= 1/)
  assert.match(source, /isCurrentLoginRequest\(/)
  assert.match(
    source,
    /setError\(\{\s*locale:\s*request\.locale,\s*message:\s*result\.error/,
  )

  const localeEffect = source.match(
    /useEffect\(\(\) => \{[\s\S]*?\}, \[locale\]\)/,
  )?.[0]
  assert.ok(localeEffect)
  assert.match(localeEffect, /setError\(null\)/)
  assert.doesNotMatch(localeEffect, /setUsername|setPassword/)
})
