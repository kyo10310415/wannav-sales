'use strict';

function applicantKey(email, fullName) {
  const normalizedEmail = String(email || '').trim();
  if (normalizedEmail) return normalizedEmail;
  return String(fullName || '').trim();
}

function syncInterviewDateFromReport(db, report, previousDate = null) {
  const date = String(report?.interview_date || '').trim();
  const key = applicantKey(report?.applicant_email, report?.applicant_full_name);
  if (!key || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return { changed: false, key, reason: 'missing_key_or_date' };
  }

  const existing = db.prepare(`
    SELECT applicant_key, interview_date, source
    FROM applicant_interview_dates
    WHERE applicant_key = ?
  `).get(key);

  if (!existing) {
    db.prepare(`
      INSERT INTO applicant_interview_dates
        (applicant_key, interview_date, source, updated_at)
      VALUES (?, ?, 'report', CURRENT_TIMESTAMP)
    `).run(key, date);
    return { changed: true, key, reason: 'inserted' };
  }

  const currentDate = String(existing.interview_date || '').trim();
  const wasDerivedFromThisReport = existing.source === 'report' &&
    previousDate && currentDate === previousDate;

  if (!currentDate || wasDerivedFromThisReport) {
    db.prepare(`
      UPDATE applicant_interview_dates
      SET interview_date = ?, source = 'report', updated_at = CURRENT_TIMESTAMP
      WHERE applicant_key = ?
    `).run(date, key);
    return { changed: true, key, reason: currentDate ? 'updated_report_date' : 'filled_blank' };
  }

  return { changed: false, key, reason: 'existing_date_preserved' };
}

function reconcileInterviewDateAfterDelete(db, deletedReport) {
  const key = applicantKey(deletedReport?.applicant_email, deletedReport?.applicant_full_name);
  if (!key) return { changed: false, reason: 'missing_key' };

  const existing = db.prepare(`
    SELECT interview_date, source
    FROM applicant_interview_dates
    WHERE applicant_key = ?
  `).get(key);

  if (!existing || existing.source !== 'report' || existing.interview_date !== deletedReport.interview_date) {
    return { changed: false, reason: 'not_derived_from_deleted_report' };
  }

  const replacement = db.prepare(`
    SELECT interview_date
    FROM sales_reports
    WHERE COALESCE(NULLIF(TRIM(applicant_email), ''), TRIM(applicant_full_name)) = ?
      AND interview_date IS NOT NULL
      AND interview_date != ''
    ORDER BY datetime(created_at) DESC, id DESC
    LIMIT 1
  `).get(key);

  db.prepare(`
    UPDATE applicant_interview_dates
    SET interview_date = ?, source = 'report', updated_at = CURRENT_TIMESTAMP
    WHERE applicant_key = ? AND source = 'report'
  `).run(replacement?.interview_date || null, key);

  return { changed: true, replacement: replacement?.interview_date || null };
}

module.exports = {
  applicantKey,
  syncInterviewDateFromReport,
  reconcileInterviewDateAfterDelete,
};
