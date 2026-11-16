const catalog = require("./catalog.json");
const {
  sqlMetricDate,
  sqlEventKey,
  CONTRACT_RESULTS,
  RESULT_NOSHOW,
  RESULT_COOLING_OFF,
  RESULT_AI_RECOMMEND,
} = require("../src/services/reportMetrics");
const contract = CONTRACT_RESULTS.map((r) => "'" + r + "'").join(",");
const base = `(SELECT sr.*,COALESCE(root.created_at,sr.created_at) AS first_created_at FROM sales_reports sr LEFT JOIN sales_reports root ON root.id=sr.parent_id) sr`;
catalog.events.sql = `SELECT MIN(sr.id) AS id,
 CASE WHEN COUNT(DISTINCT NULLIF(TRIM(sr.student_number),''))=1 THEN MIN(NULLIF(TRIM(sr.student_number),'')) END AS student_id,
 MIN(sr.applicant_full_name) AS name,${sqlMetricDate()} AS metric_date,
 CASE WHEN COUNT(DISTINCT sr.interviewer_name)=1 THEN MIN(sr.interviewer_name) END AS interviewer_name,
 MAX(CASE WHEN sr.result NOT IN ('${RESULT_NOSHOW}','${RESULT_AI_RECOMMEND}') THEN 1 ELSE 0 END) AS interviews,
 MAX(CASE WHEN sr.result IN (${contract}) THEN 1 ELSE 0 END) AS contracts,
 MAX(CASE WHEN sr.result='${RESULT_COOLING_OFF}' THEN 1 ELSE 0 END) AS cooling_off,
 MAX(CASE WHEN sr.result='${RESULT_NOSHOW}' THEN 1 ELSE 0 END) AS no_shows,
 MAX(CASE WHEN sr.result='${RESULT_AI_RECOMMEND}' THEN 1 ELSE 0 END) AS ai_recommend,
 MAX(CASE WHEN sr.result<>'${RESULT_COOLING_OFF}' THEN 1 ELSE 0 END) AS reservations
 FROM ${base} GROUP BY ${sqlEventKey()}`;
module.exports = catalog;
