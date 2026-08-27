'use strict';

const { normalizeEmail, normalizeName } = require('./reportMetrics');

function addIndexValue(index, lookup, applicantKey) {
  if (!lookup || !applicantKey) return;
  if (!index.has(lookup)) index.set(lookup, new Set());
  index.get(lookup).add(applicantKey);
}

function buildApplicantIndexes(sheetApplicants, existingRows) {
  const email = new Map();
  const name = new Map();

  for (const applicant of sheetApplicants || []) {
    const key = String(applicant.email || '').trim() || String(applicant.full_name || '').trim();
    addIndexValue(email, normalizeEmail(applicant.email), key);
    addIndexValue(name, normalizeName(applicant.full_name), key);
  }

  for (const row of existingRows || []) {
    const key = String(row.applicant_key || '').trim();
    if (!key) continue;
    if (key.includes('@')) addIndexValue(email, normalizeEmail(key), key);
    else addIndexValue(name, normalizeName(key), key);
  }

  return { email, name };
}

function uniqueMatch(index, lookup) {
  const values = index.get(lookup);
  if (!values || values.size === 0) return { key: null, ambiguous: false };
  if (values.size > 1) return { key: null, ambiguous: true, candidates: [...values] };
  return { key: [...values][0], ambiguous: false, candidates: [...values] };
}

function matchCalendarEvent(event, indexes) {
  const email = normalizeEmail(event?.guestEmail);
  if (email) {
    const match = uniqueMatch(indexes.email, email);
    if (match.key || match.ambiguous) return { ...match, method: 'email' };
  }

  const name = normalizeName(event?.guestName);
  if (name) {
    const match = uniqueMatch(indexes.name, name);
    if (match.key || match.ambiguous) return { ...match, method: 'name' };
  }

  return { key: null, ambiguous: false, method: null };
}

function calendarDate(startDt) {
  const match = String(startDt || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  const value = `${match[1]}-${match[2]}-${match[3]}`;
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) return null;
  return value;
}

function upsertCalendarInterviewDate(db, key, date) {
  const existing = db.prepare(`
    SELECT interview_date, source
    FROM applicant_interview_dates
    WHERE applicant_key = ?
  `).get(key);

  if (existing && existing.source && existing.source !== 'calendar') {
    return { changed: false, protected: true, source: existing.source };
  }

  db.prepare(`
    INSERT INTO applicant_interview_dates
      (applicant_key, interview_date, source, updated_at)
    VALUES (?, ?, 'calendar', CURRENT_TIMESTAMP)
    ON CONFLICT(applicant_key) DO UPDATE SET
      interview_date = excluded.interview_date,
      source         = 'calendar',
      updated_at     = CURRENT_TIMESTAMP
  `).run(key, date);

  return { changed: true, protected: false, source: 'calendar' };
}

function syncCalendarEvents(db, events, sheetApplicants) {
  const existingRows = db.prepare(`
    SELECT applicant_key, interview_date, source
    FROM applicant_interview_dates
  `).all();
  const indexes = buildApplicantIndexes(sheetApplicants, existingRows);
  const grouped = new Map();
  const results = [];
  const matchedKeys = new Set();

  for (const event of events || []) {
    const date = calendarDate(event.startDt);
    const match = matchCalendarEvent(event, indexes);
    const base = {
      guestName: event.guestName || '(氏名なし)',
      guestEmail: event.guestEmail || null,
      startDt: event.startDt || null,
      interviewDate: date,
      matchMethod: match.method,
    };

    if (!date || !match.key) {
      if (match.ambiguous) {
        for (const key of (match.candidates || [])) matchedKeys.add(key);
      }
      results.push({
        ...base,
        matched: false,
        ambiguous: match.ambiguous,
        reason: !date ? 'invalid_date' : (match.ambiguous ? 'ambiguous_applicant' : 'not_found'),
      });
      continue;
    }

    if (!grouped.has(match.key)) grouped.set(match.key, []);
    grouped.get(match.key).push({ event, date, base });
  }

  for (const [key, candidates] of grouped) {
    const dates = [...new Set(candidates.map(candidate => candidate.date))];
    matchedKeys.add(key);

    if (dates.length !== 1) {
      for (const candidate of candidates) {
        results.push({
          ...candidate.base,
          applicantKey: key,
          matched: false,
          ambiguous: true,
          reason: 'multiple_event_dates',
        });
      }
      continue;
    }

    const saved = upsertCalendarInterviewDate(db, key, dates[0]);
    for (const candidate of candidates) {
      results.push({
        ...candidate.base,
        applicantKey: key,
        matched: true,
        protected: saved.protected,
        source: saved.source,
      });
    }
  }

  return { results, matchedKeys };
}

module.exports = {
  buildApplicantIndexes,
  matchCalendarEvent,
  calendarDate,
  upsertCalendarInterviewDate,
  syncCalendarEvents,
};
