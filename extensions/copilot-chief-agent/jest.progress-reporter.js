/* eslint-disable no-undef */
class ProgressReporter {
  constructor() {
    this._testStartPatched = false;
  }
  onRunStart(aggregatedResults) {
    this.total = aggregatedResults.numTotalTests || 0;
    this.done = 0;
    this.started = 0;
    if (this.total > 0) {
      process.stdout.write(`[progress] 0/${this.total} (0%)\n`);
    }
    // Monkey patch global describe/test start events (Jest doesn't expose per-test start in custom reporter easily).
    if (!this._testStartPatched && globalThis.jest) {
      this._testStartPatched = true;
      const wrap = (fnName) => {
        const orig = globalThis[fnName];
        if(typeof orig !== 'function') return;
        const self = this;
        const wrapper = function(name, fn, timeout){
          const wrappedFn = fn ? function(done){
            self.started++;
            const pctStart = ((self.started / self.total) * 100).toFixed(1);
            process.stdout.write(`[run] ${self.started}/${self.total} (${pctStart}%) ${name}\n`);
            return fn.length ? fn(done) : fn();
          } : fn;
          return orig.call(this, name, wrappedFn, timeout);
        };
        // Copy modifiers (skip/only)
        ['skip','only','todo','concurrent','each'].forEach(m=>{ if(orig[m]) wrapper[m]=orig[m].bind(orig); });
        globalThis[fnName] = wrapper;
      };
      wrap('it');
      wrap('test');
    }
  }
  onTestResult(_context, testResult) {
    if (!this.total) return;
    const finishedInFile = (testResult.testResults || []).length;
    this.done += finishedInFile;
    if (this.done > this.total) this.done = this.total;
    const pct = ((this.done / this.total) * 100).toFixed(1);
    process.stdout.write(`[progress] ${this.done}/${this.total} (${pct}%) file ${testResult.testFilePath}\n`);
  }
  onRunComplete() {
    if (this.total) {
      process.stdout.write(`[progress] done (${this.total} tests)\n`);
    }
  }
}

module.exports = ProgressReporter;
