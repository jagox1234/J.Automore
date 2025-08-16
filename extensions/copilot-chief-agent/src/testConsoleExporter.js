function formatTranscriptMD(entries){
  const lines = ['# Transcript Consola Pruebas',''];
  lines.push('| # | Timestamp | De | A | Tipo | Texto |');
  lines.push('|---|-----------|----|---|------|-------|');
  entries.forEach((e,i)=>{
    const ts = new Date(e.ts).toISOString().slice(11,19);
    const kind = e.from==='AI' ? 'AI' : (e.question?'Q':'Msg');
  const esc = (e.text||'').replace(/\|/g,'\\|').replace(/`/g,'`');
    lines.push(`| ${i+1} | ${ts} | ${e.from} | ${e.to||''} | ${kind} | ${esc} |`);
  });
  lines.push('\n---');
  return lines.join('\n');
}
module.exports = { formatTranscriptMD };
