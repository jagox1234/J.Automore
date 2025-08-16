/* eslint-disable no-undef */
class ProgressReporter {
  onRunStart(aggregatedResults) {
    this.total = aggregatedResults.numTotalTests || 0;
    this.done = 0;
    if (this.total > 0) {
      process.stdout.write(`[progress] 0/${this.total} (0%)\n`);
    }
  }
  onTestResult(_context, testResult) {
    if (!this.total) return;
    const finishedInFile = (testResult.testResults || []).length;
    this.done += finishedInFile;
    if (this.done > this.total) this.done = this.total;
    const pct = ((this.done / this.total) * 100).toFixed(1);
    process.stdout.write(`[progress] ${this.done}/${this.total} (${pct}%) ${testResult.testFilePath}\n`);
  }
  onRunComplete() {
    if (this.total) {
      process.stdout.write(`[progress] done (${this.total} tests)\n`);
    }
  }
}

module.exports = ProgressReporter;
