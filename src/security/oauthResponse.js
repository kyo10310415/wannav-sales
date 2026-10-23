function responsePage(payload, origin) {
  // JSON serialization alone does not prevent an HTML </script> breakout.
  const safeJSON = value => JSON.stringify(value).replace(/[<>&\u2028\u2029]/g,
    ch => `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`);
  return `<!doctype html><html><head><meta charset="utf-8"></head><body>
    <p>Google連携の処理が終了しました。このウィンドウを閉じてください。</p>
    <script>window.opener && window.opener.postMessage(${safeJSON(payload)}, ${safeJSON(origin)});
    setTimeout(() => window.close(), 1500);</script></body></html>`;
}
module.exports = { responsePage };
