'use strict';

const CONTRACT_RESULTS = [
  '契約',
  '契約＆職業案内',
  '契約＆職業案内（CP）',
];

const RESULT_NOSHOW       = '飛び';
const RESULT_COOLING_OFF  = 'クーリングオフ';
const RESULT_AI_RECOMMEND = 'AIレコメン';

function normalizeName(value) {
  return String(value || '')
    .replace(/[\s\u3000]/g, '')
    .toLowerCase();
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function reportPersonKey(report) {
  const email = normalizeEmail(report?.applicant_email);
  if (email) return `email:${email}`;

  const name = normalizeName(report?.applicant_full_name);
  if (name) return `name:${name}`;

  return `report:${report?.id ?? 'unknown'}`;
}

function reportMetricDate(report) {
  const interviewDate = String(report?.interview_date || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(interviewDate)) return interviewDate;

  const createdAt = String(report?.first_created_at || report?.created_at || '');
  const match = createdAt.match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : 'unknown-date';
}

function reportEventKey(report) {
  return `${reportPersonKey(report)}|${reportMetricDate(report)}`;
}

function isContractResult(result) {
  return CONTRACT_RESULTS.includes(result);
}

function isInterviewResult(result) {
  return result !== RESULT_NOSHOW && result !== RESULT_AI_RECOMMEND;
}

/**
 * Same person + same interview date + same result is one business event for
 * aggregation. Raw sales_reports rows remain untouched and available as history.
 */
function dedupeReportResults(reports) {
  const seen = new Set();
  const deduped = [];

  for (const report of reports || []) {
    // 追記報告も面接日が異なれば別イベントとして扱う。
    // 同一人物・同一面接日・同一結果の重複だけを1件にまとめる。
    const key = `${reportEventKey(report)}|result:${report?.result || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(report);
  }
  return deduped;
}

function summarizeReportEvents(reports) {
  const deduped = dedupeReportResults(reports);
  const interviews = new Set();
  const contracts = new Set();
  const coolingOff = new Set();
  const noShows = new Set();
  const aiRecommend = new Set();
  const reservations = new Set();

  for (const report of deduped) {
    const key = reportEventKey(report);
    const result = report?.result || '';

    if (isInterviewResult(result)) interviews.add(key);
    if (isContractResult(result)) contracts.add(key);
    if (result === RESULT_COOLING_OFF) coolingOff.add(key);
    if (result === RESULT_NOSHOW) noShows.add(key);
    if (result === RESULT_AI_RECOMMEND) aiRecommend.add(key);

    if (result !== RESULT_COOLING_OFF) reservations.add(key);
  }

  const totalInterviews = interviews.size;
  const totalContracts = contracts.size;

  return {
    deduped,
    total_interviews: totalInterviews,
    total_contracts: totalContracts,
    total_coolingoff: coolingOff.size,
    total_noshow: noShows.size,
    total_ai_recommend: aiRecommend.size,
    total_reservations: reservations.size,
    cvr_interview: totalInterviews > 0
      ? ((totalContracts / totalInterviews) * 100).toFixed(1)
      : '0.0',
  };
}

function sqlMetricDate(alias = 'sr') {
  return `COALESCE(NULLIF(${alias}.interview_date,''), date(${alias}.first_created_at, '+9 hours'))`;
}

function sqlPersonKey(alias = 'sr') {
  return `(CASE
    WHEN NULLIF(TRIM(${alias}.applicant_email), '') IS NOT NULL
      THEN 'email:' || LOWER(TRIM(${alias}.applicant_email))
    WHEN NULLIF(TRIM(${alias}.applicant_full_name), '') IS NOT NULL
      THEN 'name:' || LOWER(REPLACE(REPLACE(TRIM(${alias}.applicant_full_name), ' ', ''), '　', ''))
    ELSE 'report:' || CAST(${alias}.id AS TEXT)
  END)`;
}

function sqlEventKey(alias = 'sr') {
  return `(${sqlPersonKey(alias)} || '|' || ${sqlMetricDate(alias)})`;
}

module.exports = {
  CONTRACT_RESULTS,
  RESULT_NOSHOW,
  RESULT_COOLING_OFF,
  RESULT_AI_RECOMMEND,
  normalizeName,
  normalizeEmail,
  reportPersonKey,
  reportMetricDate,
  reportEventKey,
  isContractResult,
  isInterviewResult,
  dedupeReportResults,
  summarizeReportEvents,
  sqlMetricDate,
  sqlPersonKey,
  sqlEventKey,
};
