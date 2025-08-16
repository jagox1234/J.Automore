function parsePlanSteps(raw) {
  // raw can be array of strings or a single string
  let lines = [];
  if (Array.isArray(raw)) {
    raw.forEach(s => {
      if (typeof s === 'string') lines.push(...s.split(/\r?\n/));
    });
  } else if (typeof raw === 'string') {
    lines = raw.split(/\r?\n/);
  }
  const steps = [];
  const seen = new Set();
  for (let line of lines) {
    line = line.trim();
    if (!line) continue;
    // Skip headings / markdown fences
    if (/^#{1,6}\s/.test(line)) continue; // markdown heading
    if (/^```/.test(line)) continue; // code fence markers
    // Extract list item bullet or numbered pattern
    let m = line.match(/^[-*+]\s+(.*)/);
    if (!m) m = line.match(/^\d+[).:-]?\s+(.*)/);
    if (!m) {
      // Bold item could be a step: **Title**
      m = line.match(/^\*\*(.+?)\*\*/);
    }
    if (m) {
      let text = m[1].trim();
      // Remove trailing markdown formatting or punctuation
      text = text.replace(/[:;,.]+$/,'').trim();
      if (text && !seen.has(text.toLowerCase())) {
        seen.add(text.toLowerCase());
        steps.push(text);
      }
    } else if (/Implementar|Agregar|Refactorizar|Optimizar|Mejorar|Incorporar/i.test(line)) {
      // Likely an imperative step line
      let text = line.replace(/^\*\*/,'').replace(/\*\*$/,'').trim();
      if (text && !seen.has(text.toLowerCase())) { seen.add(text.toLowerCase()); steps.push(text); }
    }
  }
  return steps;
}

module.exports = { parsePlanSteps };
