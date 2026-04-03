const express = require('express');
const router = express.Router();
const { google } = require('googleapis');
const { authenticateToken } = require('../middleware/auth');

const SPREADSHEET_ID = '1H0CctpkCJ4PVZ5cf1YYI7_elNwUu0uIcHIHMNTHYHW4';
const SHEET_NAME = 'アススタ';
const RANGE = `${SHEET_NAME}!A1:AA`;

async function getGoogleSheetsClient() {
  const credentials = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  
  if (credentials) {
    // Use service account credentials from environment
    const auth = new google.auth.GoogleAuth({
      credentials: JSON.parse(credentials),
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });
    return google.sheets({ version: 'v4', auth });
  } else if (process.env.GOOGLE_API_KEY) {
    // Use API key (read-only public sheets)
    return google.sheets({ version: 'v4', auth: process.env.GOOGLE_API_KEY });
  } else {
    throw new Error('Google認証情報が設定されていません。環境変数 GOOGLE_SERVICE_ACCOUNT_JSON または GOOGLE_API_KEY を設定してください。');
  }
}

// GET /api/spreadsheet/applicants - 応募者一覧取得
router.get('/applicants', authenticateToken, async (req, res) => {
  try {
    const sheets = await getGoogleSheetsClient();

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: RANGE,
    });

    const rows = response.data.values;
    if (!rows || rows.length < 2) {
      return res.json({ applicants: [], headers: [] });
    }

    // Row 1 is header (index 0)
    const headers = rows[0];
    const dataRows = rows.slice(1);

    // Column indices (A=0, B=1, ..., D=3, E=4, F=5)
    const COL_LAST_NAME = 3;   // D列: 性
    const COL_FIRST_NAME = 4;  // E列: 名
    const COL_EMAIL = 5;       // F列: メールアドレス

    // Remove duplicates based on D, E, F columns
    const seen = new Set();
    const uniqueApplicants = [];

    dataRows.forEach((row, rowIndex) => {
      // Pad row to at least 27 columns (A-AA = 27)
      while (row.length < 27) row.push('');

      const lastName = (row[COL_LAST_NAME] || '').trim();
      const firstName = (row[COL_FIRST_NAME] || '').trim();
      const email = (row[COL_EMAIL] || '').trim();

      // Skip rows with all empty key fields
      if (!lastName && !firstName && !email) return;

      const key = `${lastName}|${firstName}|${email}`;
      if (!seen.has(key)) {
        seen.add(key);
        uniqueApplicants.push({
          row_index: rowIndex + 2, // +2 because header is row 1, data starts at row 2
          columns: {
            A: row[0] || '',
            B: row[1] || '',
            C: row[2] || '',
            D: row[3] || '',
            E: row[4] || '',
            F: row[5] || '',
            G: row[6] || '',
            H: row[7] || '',
            I: row[8] || '',
            J: row[9] || '',
            K: row[10] || '',
            L: row[11] || '',
            M: row[12] || '',
            N: row[13] || '',
            O: row[14] || '',
            P: row[15] || '',
            Q: row[16] || '',
            R: row[17] || '',
            S: row[18] || '',
            T: row[19] || '',
            U: row[20] || '',
            V: row[21] || '',
            W: row[22] || '',
            X: row[23] || '',
            Y: row[24] || '',
            Z: row[25] || '',
            AA: row[26] || '',
          },
          // Convenience fields
          last_name: lastName,
          first_name: firstName,
          full_name: `${lastName} ${firstName}`.trim(),
          email: email,
        });
      }
    });

    res.json({
      applicants: uniqueApplicants,
      headers: headers,
      total: uniqueApplicants.length
    });

  } catch (err) {
    console.error('Spreadsheet error:', err);
    res.status(500).json({
      error: 'スプレッドシートの取得に失敗しました: ' + err.message,
      details: err.toString()
    });
  }
});

module.exports = router;
